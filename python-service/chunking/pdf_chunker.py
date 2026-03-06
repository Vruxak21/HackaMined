"""
PDF file chunker and merger using PyMuPDF (fitz).

Splits a PDF at page boundaries so each chunk is a fully valid PDF
containing a contiguous subset of pages.  Because PyMuPDF does
character-level search within each page, PII never spans across a page
boundary, so no overlap context is needed.

After the PII pass the chunk output files are merged back into a single
PDF, preserving the original metadata, page dimensions, fonts, images,
and embedded redactions produced by each chunk's processing step.
"""

from __future__ import annotations

import logging
import math
import os
import uuid
import tempfile
from pathlib import Path
from typing import List

import fitz  # PyMuPDF

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)

DEFAULT_CHUNK_SIZE = 15  # pages per chunk


def _get_file_id(file_path: str) -> str:
    stem = Path(file_path).stem.replace("-", "").replace("_", "")
    if len(stem) >= 32 and all(c in "0123456789abcdefABCDEF" for c in stem[:32]):
        return stem[:32]
    return uuid.uuid4().hex


class PDFChunker:
    """Splits large PDF files into page-boundary-aligned chunks."""

    # ------------------------------------------------------------------
    # split
    # ------------------------------------------------------------------

    def split(self, file_path: str, chunk_size: int | None = None) -> List[ChunkMetadata]:
        """
        Open *file_path*, slice it into page groups, and write one temp
        PDF per chunk.

        Parameters
        ----------
        chunk_size:
            Pages per chunk. Falls back to DEFAULT_CHUNK_SIZE if None.
        """
        pages_per_chunk: int = chunk_size or DEFAULT_CHUNK_SIZE

        doc = fitz.open(file_path)
        total_pages: int = doc.page_count

        if total_pages == 0:
            doc.close()
            logger.warning("PDFChunker.split: document has no pages  (file=%s)", file_path)
            return []

        total_chunks = math.ceil(total_pages / pages_per_chunk)
        file_id = _get_file_id(file_path)
        tmp_dir = Path(tempfile.gettempdir())
        chunk_list: List[ChunkMetadata] = []

        for chunk_idx in range(total_chunks):
            start_page = chunk_idx * pages_per_chunk
            end_page = min(start_page + pages_per_chunk, total_pages)

            temp_input_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}.pdf")
            temp_output_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}_out.pdf")

            chunk_doc = fitz.open()
            chunk_doc.insert_pdf(doc, from_page=start_page, to_page=end_page - 1)
            chunk_doc.save(temp_input_path)
            chunk_doc.close()

            chunk_list.append(
                ChunkMetadata(
                    chunk_index=chunk_idx,
                    total_chunks=total_chunks,
                    file_type="pdf",
                    start_boundary=start_page,
                    end_boundary=end_page,
                    overlap_before=0,   # pages are self-contained
                    overlap_after=0,
                    temp_input_path=temp_input_path,
                    temp_output_path=temp_output_path,
                )
            )

        doc.close()

        logger.info(
            "PDFChunker.split: %d pages → %d chunks  (file=%s)",
            total_pages,
            total_chunks,
            file_path,
        )
        return chunk_list

    # ------------------------------------------------------------------
    # merge
    # ------------------------------------------------------------------

    def merge(
        self,
        chunk_results: List[ChunkResult],
        chunk_output_paths: List[str],
        output_path: str,
        original_file_path: str,
        chunk_metadata_list: List[ChunkMetadata],
    ) -> None:
        """
        Concatenate processed chunk PDFs into a single output PDF at
        *output_path*, restoring the original document metadata.

        Parameters
        ----------
        chunk_results:
            One ChunkResult per chunk (used for ordering).
        chunk_output_paths:
            Matching processed output PDF paths (same order as
            *chunk_results*).
        output_path:
            Destination path for the merged PDF.
        original_file_path:
            Original PDF — used to recover metadata and verify page count.
        chunk_metadata_list:
            Chunk metadata list (provides fallback ordering if needed).
        """
        # Sort by chunk_index so page order is always deterministic
        ordered = sorted(
            zip(chunk_results, chunk_output_paths),
            key=lambda pair: pair[0].chunk_index,
        )

        merged_doc = fitz.open()

        for result, chunk_path in ordered:
            try:
                chunk_doc = fitz.open(chunk_path)
                merged_doc.insert_pdf(chunk_doc)
                chunk_doc.close()
            except Exception as exc:
                logger.warning(
                    "PDFChunker.merge: could not insert chunk %d (%s): %s",
                    result.chunk_index,
                    chunk_path,
                    exc,
                )

        # ── Restore original metadata ─────────────────────────────────────
        try:
            original_doc = fitz.open(original_file_path)
            merged_doc.set_metadata(original_doc.metadata)
            original_page_count = original_doc.page_count
            original_doc.close()
        except Exception as exc:
            logger.warning(
                "PDFChunker.merge: could not read original metadata (%s): %s",
                original_file_path,
                exc,
            )
            original_page_count = None

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        merged_doc.save(output_path, garbage=4, deflate=True)
        merged_page_count = merged_doc.page_count
        merged_doc.close()

        # ── Verify page count ─────────────────────────────────────────────
        if original_page_count is not None and merged_page_count != original_page_count:
            logger.warning(
                "PDFChunker.merge: page count mismatch — "
                "original=%d, output=%d  (file=%s)",
                original_page_count,
                merged_page_count,
                output_path,
            )
        else:
            logger.info(
                "PDF merged: %d pages preserved  (file=%s)",
                merged_page_count,
                output_path,
            )

    # ------------------------------------------------------------------
    # cleanup
    # ------------------------------------------------------------------

    def cleanup(self, chunk_metadata_list: List[ChunkMetadata]) -> None:
        """Delete all temporary input and output files created by :meth:`split`."""
        for meta in chunk_metadata_list:
            for path in (meta.temp_input_path, meta.temp_output_path):
                try:
                    os.remove(path)
                except OSError:
                    pass


# ── Module-level chunked processing function ──────────────────────────────────

def _noop_progress(chunk_idx: int, status: str) -> None:  # noqa: ARG001
    pass


def process_pdf_chunked(
    input_path: str,
    output_path: str,
    mode: str = "redact",
    config: dict | None = None,
    progress_cb=_noop_progress,
) -> dict:
    """
    End-to-end chunked PDF processing with the new pipeline.

    1. Open PDF with PyMuPDF and extract text per page.
    2. Group pages into chunks of config["chunk_size"] pages.
    3. Run detect_pii_batch() on page texts (one string per page) within
       each chunk.  Detection runs in parallel across chunks.
    4. Apply redaction annotations SEQUENTIALLY (fitz is not thread-safe
       for write operations).
    5. Save the redacted document.
    """
    import io
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from pathlib import Path

    from pipeline.detector import detect_pii_batch

    if config is None:
        config = {"use_regex": True, "use_spacy": True, "use_bert": False,
                  "spacy_model": "en_core_web_sm", "chunk_size": DEFAULT_CHUNK_SIZE,
                  "workers": 4}

    pages_per_chunk = config.get("chunk_size", DEFAULT_CHUNK_SIZE)
    workers = config.get("workers", 4)

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(input_path)
    page_count = len(doc)

    if page_count == 0:
        doc.save(output_path)
        doc.close()
        return _build_pdf_summary([], 0)

    # ── Extract text per page (main thread — fitz reads not thread-safe) ──
    all_page_texts: list[str] = []
    for page in doc:
        text = page.get_text("text")
        # Also OCR any embedded images
        try:
            import pytesseract
            from PIL import Image as PILImage
            for img_info in page.get_images(full=True):
                xref = img_info[0]
                base_img = doc.extract_image(xref)
                pil_img = PILImage.open(io.BytesIO(base_img["image"]))
                ocr = pytesseract.image_to_string(pil_img)
                if ocr.strip():
                    text += "\n" + ocr
        except Exception:
            pass
        all_page_texts.append(text)

    # ── Group pages into chunks ───────────────────────────────────────
    page_groups: list[list[int]] = [
        list(range(i, min(i + pages_per_chunk, page_count)))
        for i in range(0, max(1, page_count), pages_per_chunk)
    ]
    total = len(page_groups)

    for i in range(total):
        progress_cb(i, "pending")

    # ── Detection: parallel across chunks ─────────────────────────────
    all_detections: list[dict] = []
    all_pii_values: set[str] = set()
    lock = threading.Lock()

    def _detect_group(idx: int, page_indices: list[int]):
        progress_cb(idx, "processing")
        try:
            page_texts = [all_page_texts[pi] for pi in page_indices]
            chunk_dets = detect_pii_batch(page_texts, config)
            # Flatten all page results for this chunk
            flat: list[dict] = []
            for page_dets in chunk_dets:
                flat.extend(page_dets)
            progress_cb(idx, "done")
            return idx, flat
        except Exception:
            progress_cb(idx, "failed")
            raise

    with ThreadPoolExecutor(max_workers=min(workers, total)) as executor:
        futures = {
            executor.submit(_detect_group, i, grp): i
            for i, grp in enumerate(page_groups)
        }
        for future in as_completed(futures):
            idx, flat = future.result()
            with lock:
                all_detections.extend(flat)
                for det in flat:
                    v = det.get("value", "")
                    if v:
                        all_pii_values.add(v)

    # ── Apply redactions SEQUENTIALLY (fitz not thread-safe for writes) ──
    for page in doc:
        for pii_value in all_pii_values:
            for area in page.search_for(pii_value):
                page.add_redact_annot(area, fill=(0, 0, 0))
        page.apply_redactions()

    # Clear metadata
    for field_name in ("author", "creator", "producer", "subject", "title"):
        try:
            doc.set_metadata({field_name: ""})
        except Exception:
            pass

    doc.save(output_path, garbage=4, deflate=True)
    doc.close()

    return _build_pdf_summary(all_detections, total)


def _build_pdf_summary(detections: list[dict], chunk_count: int) -> dict:
    pii_summary: dict[str, int] = {}
    layer_breakdown: dict[str, int] = {"regex": 0, "spacy": 0, "bert": 0}
    high = medium = 0

    for det in detections:
        et = det["entity_type"]
        pii_summary[et] = pii_summary.get(et, 0) + 1
        layer = det.get("layer", "regex")
        if layer in layer_breakdown:
            layer_breakdown[layer] += 1
        else:
            layer_breakdown[layer] = 1
        score = det.get("score", 0)
        if score >= 0.85:
            high += 1
        elif score >= 0.60:
            medium += 1

    return {
        "pii_summary":          pii_summary,
        "total_pii":            len(detections),
        "layer_breakdown":      layer_breakdown,
        "confidence_breakdown": {"high": high, "medium": medium},
        "chunk_count":          chunk_count,
    }
