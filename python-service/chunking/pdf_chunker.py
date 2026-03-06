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
from pathlib import Path
from typing import List

import fitz  # PyMuPDF

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)


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

    def split(self, file_path: str) -> List[ChunkMetadata]:
        """
        Open *file_path*, slice it into page groups, and write one temp
        PDF per chunk.

        Returns
        -------
        list[ChunkMetadata]
            One entry per chunk (temp PDF files already written).
        """
        config = get_chunk_config("pdf")
        pages_per_chunk: int = config["pages_per_chunk"]

        doc = fitz.open(file_path)
        total_pages: int = doc.page_count

        if total_pages == 0:
            doc.close()
            logger.warning("PDFChunker.split: document has no pages  (file=%s)", file_path)
            return []

        total_chunks = math.ceil(total_pages / pages_per_chunk)
        file_id = _get_file_id(file_path)
        tmp_dir = Path("/tmp")
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
