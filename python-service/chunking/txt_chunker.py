"""
TXT file chunker and merger.

Splits plain-text files at paragraph boundaries (double newlines) so that
sentences and paragraphs are never cut in the middle.  Overlap context
windows from the adjacent chunks are injected as clearly-marked sections
so the PII detector can see cross-boundary context without that text
appearing in the merged output.

Overlap markers
---------------
    {overlap_text_from_prev_chunk}
    ###OVERLAP_BEFORE###
    {main chunk content}
    ###OVERLAP_AFTER###
    {overlap_text_from_next_chunk}
"""

from __future__ import annotations

import logging
import os
import uuid
import tempfile
from pathlib import Path
from typing import List

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)

DEFAULT_CHUNK_SIZE = 100_000  # chars per chunk
CONTEXT_OVERLAP = 500         # chars shared with neighbours

_MARKER_BEFORE = "###OVERLAP_BEFORE###"
_MARKER_AFTER = "###OVERLAP_AFTER###"


def _get_file_id(file_path: str) -> str:
    stem = Path(file_path).stem.replace("-", "").replace("_", "")
    if len(stem) >= 32 and all(c in "0123456789abcdefABCDEF" for c in stem[:32]):
        return stem[:32]
    return uuid.uuid4().hex


def _strip_overlap(content: str) -> str:
    """Remove both overlap sections from a processed chunk file."""
    # Remove everything up to and including ###OVERLAP_BEFORE###
    if _MARKER_BEFORE in content:
        idx = content.index(_MARKER_BEFORE)
        content = content[idx + len(_MARKER_BEFORE):]
        content = content.lstrip("\n")

    # Remove ###OVERLAP_AFTER### and everything after it
    if _MARKER_AFTER in content:
        idx = content.index(_MARKER_AFTER)
        content = content[:idx].rstrip("\n")

    return content


class TXTChunker:
    """Splits large plain-text files into paragraph-boundary-aligned chunks."""

    # ------------------------------------------------------------------
    # split
    # ------------------------------------------------------------------

    def split(self, file_path: str, chunk_size: int | None = None) -> List[ChunkMetadata]:
        """
        Read *file_path*, group its paragraphs into chunks not exceeding
        *chunk_size* chars, and write one temp .txt file per chunk.

        Parameters
        ----------
        chunk_size:
            Characters per chunk. Falls back to DEFAULT_CHUNK_SIZE if not provided.

        Returns
        -------
        list[ChunkMetadata]
            One entry per chunk (temp files already written).
        """
        chars_per_chunk: int = chunk_size or DEFAULT_CHUNK_SIZE
        overlap_chars: int = CONTEXT_OVERLAP

        content = Path(file_path).read_text(encoding="utf-8", errors="replace")

        # Split into paragraphs; preserve non-empty ones
        raw_paras = content.split("\n\n")
        paragraphs = [p for p in raw_paras if p.strip()]

        if not paragraphs:
            logger.warning("TXTChunker.split: no non-empty paragraphs in %s", file_path)
            return []

        # ── Group paragraphs into chunks by character count ───────────────
        chunk_groups: List[List[str]] = []
        current_paras: List[str] = []
        current_chars = 0

        for para in paragraphs:
            para_len = len(para)
            if current_chars + para_len > chars_per_chunk and current_paras:
                chunk_groups.append(current_paras)
                current_paras = [para]
                current_chars = para_len
            else:
                current_paras.append(para)
                current_chars += para_len

        if current_paras:
            chunk_groups.append(current_paras)

        # Pre-compute the main text for each group (needed for overlap slices)
        group_texts = ["\n\n".join(g) for g in chunk_groups]

        total_chunks = len(chunk_groups)
        file_id = _get_file_id(file_path)
        tmp_dir = Path(tempfile.gettempdir())

        # Track approximate character positions in the original file
        char_pos = 0
        chunk_list: List[ChunkMetadata] = []

        for chunk_idx, main_text in enumerate(group_texts):
            temp_input_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}.txt")
            temp_output_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}_out.txt")

            start_boundary = char_pos
            end_boundary = char_pos + len(main_text)

            parts: List[str] = []

            # ── Context from previous chunk ───────────────────────────────
            if chunk_idx > 0 and overlap_chars > 0:
                before_ctx = group_texts[chunk_idx - 1][-overlap_chars:]
                parts.append(before_ctx)
                parts.append(f"\n{_MARKER_BEFORE}\n")

            # ── Main content ──────────────────────────────────────────────
            parts.append(main_text)

            # ── Context from next chunk ───────────────────────────────────
            if chunk_idx < total_chunks - 1 and overlap_chars > 0:
                after_ctx = group_texts[chunk_idx + 1][:overlap_chars]
                parts.append(f"\n{_MARKER_AFTER}\n")
                parts.append(after_ctx)

            Path(temp_input_path).write_text("".join(parts), encoding="utf-8")

            chunk_list.append(
                ChunkMetadata(
                    chunk_index=chunk_idx,
                    total_chunks=total_chunks,
                    file_type="txt",
                    start_boundary=start_boundary,
                    end_boundary=end_boundary,
                    overlap_before=overlap_chars if chunk_idx > 0 else 0,
                    overlap_after=overlap_chars if chunk_idx < total_chunks - 1 else 0,
                    temp_input_path=temp_input_path,
                    temp_output_path=temp_output_path,
                )
            )

            # +2 accounts for the "\n\n" separator between groups
            char_pos = end_boundary + 2

        logger.info(
            "TXTChunker.split: %d paragraphs → %d chunks  (file=%s)",
            len(paragraphs),
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
    ) -> None:
        """
        Strip overlap sections from each processed chunk output and join
        them into a single .txt file at *output_path*.
        """
        ordered = sorted(
            zip(chunk_results, chunk_output_paths),
            key=lambda pair: pair[0].chunk_index,
        )

        cleaned_parts: List[str] = []
        for result, out_path in ordered:
            try:
                raw = Path(out_path).read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                logger.warning(
                    "TXTChunker.merge: cannot read chunk %d output (%s): %s",
                    result.chunk_index,
                    out_path,
                    exc,
                )
                continue
            cleaned_parts.append(_strip_overlap(raw))

        combined = "\n\n".join(cleaned_parts)

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_text(combined + "\n", encoding="utf-8")

        # ── Integrity check: paragraph count ─────────────────────────────
        try:
            original_content = Path(original_file_path).read_text(
                encoding="utf-8", errors="replace"
            )
            orig_para_count = len([p for p in original_content.split("\n\n") if p.strip()])
            out_para_count = len([p for p in combined.split("\n\n") if p.strip()])
            if orig_para_count != out_para_count:
                logger.warning(
                    "TXTChunker.merge: paragraph count mismatch — "
                    "original=%d, output=%d  (file=%s)",
                    orig_para_count,
                    out_para_count,
                    output_path,
                )
            else:
                logger.info(
                    "TXTChunker.merge: %d paragraphs preserved  (file=%s)",
                    out_para_count,
                    output_path,
                )
        except OSError:
            pass

    # ------------------------------------------------------------------
    # cleanup
    # ------------------------------------------------------------------

    def cleanup(self, chunk_metadata_list: List[ChunkMetadata]) -> None:
        """Delete all temporary files created by :meth:`split`."""
        for meta in chunk_metadata_list:
            for path in (meta.temp_input_path, meta.temp_output_path):
                try:
                    os.remove(path)
                except OSError:
                    pass


# ── Module-level chunked processing function ──────────────────────────────────

def _noop_progress(chunk_idx: int, status: str) -> None:  # noqa: ARG001
    pass


def _split_at_paragraphs(text: str, chunk_size: int) -> list[str]:
    """
    Split *text* at paragraph boundaries (\\n\\n) into groups of
    approximately *chunk_size* characters.  If a paragraph exceeds
    chunk_size, split at sentence boundaries (period + space).
    Never split mid-word.
    """
    import re as _re

    parts = _re.split(r"(\n\n+)", text)
    chunks: list[str] = []
    current = ""

    for part in parts:
        # If adding this part exceeds the limit and we have content, flush
        if len(current) + len(part) > chunk_size and current:
            chunks.append(current)
            current = ""

        # If even a single part exceeds chunk_size, split at sentence boundaries
        if len(part) > chunk_size:
            sentences = _re.split(r"(?<=\. )", part)
            for sentence in sentences:
                if len(current) + len(sentence) > chunk_size and current:
                    chunks.append(current)
                    current = ""
                current += sentence
        else:
            current += part

    if current:
        chunks.append(current)

    return chunks or [text]


def process_txt_chunked(
    input_path: str,
    output_path: str,
    mode: str = "redact",
    config: dict | None = None,
    progress_cb=_noop_progress,
) -> dict:
    """
    End-to-end chunked TXT processing with the new pipeline.

    1. Read file.
    2. Split at paragraph boundaries into chunks of config["chunk_size"] chars.
    3. Run detect_pii_batch() on all chunks.
    4. Build replacement maps and apply masking per chunk.
    5. Write output.
    6. Return summary dict.
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from pathlib import Path

    from detection.masker import pii_masker
    from pipeline.detector import detect_pii_batch

    if config is None:
        config = {"use_regex": True, "use_spacy": True, "use_bert": False,
                  "spacy_model": "en_core_web_sm", "chunk_size": DEFAULT_CHUNK_SIZE,
                  "workers": 4}

    chunk_size = config.get("chunk_size", DEFAULT_CHUNK_SIZE)
    workers = config.get("workers", 4)

    text = Path(input_path).read_text(encoding="utf-8", errors="replace")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    raw_chunks = _split_at_paragraphs(text, chunk_size)
    total = len(raw_chunks)

    for i in range(total):
        progress_cb(i, "pending")

    # ── Detection: batch all chunks at once ───────────────────────────────
    # Build detection input with context overlap from neighbours
    detection_texts: list[str] = []
    for idx, chunk in enumerate(raw_chunks):
        before = raw_chunks[idx - 1][-CONTEXT_OVERLAP:] if idx > 0 else ""
        after = raw_chunks[idx + 1][:CONTEXT_OVERLAP] if idx < total - 1 else ""
        detection_texts.append(before + chunk + after)

    all_chunk_detections = detect_pii_batch(detection_texts, config)

    # ── Masking: build replacement map per chunk and apply ───────────────
    all_detections: list[dict] = []
    masked_chunks: list[str] = []

    for idx, chunk in enumerate(raw_chunks):
        progress_cb(idx, "processing")
        try:
            detections = all_chunk_detections[idx]
            all_detections.extend(detections)

            replacement_map: dict[str, str] = {}
            for det in detections:
                val = det["value"]
                if not val or val in replacement_map:
                    continue
                if mode == "redact":
                    replacement_map[val] = "[REDACTED]"
                elif mode == "mask":
                    replacement_map[val] = pii_masker.get_partial_mask(
                        val, det["entity_type"]
                    )
                elif mode == "tokenize":
                    replacement_map[val] = pii_masker.get_token(det["entity_type"])
                else:
                    replacement_map[val] = "[REDACTED]"

            # Apply replacements, longest first to avoid partial matches
            masked = chunk
            for original in sorted(replacement_map, key=len, reverse=True):
                masked = masked.replace(original, replacement_map[original])

            masked_chunks.append(masked)
            progress_cb(idx, "done")
        except Exception:
            masked_chunks.append(chunk)  # preserve original on failure
            progress_cb(idx, "failed")
            raise

    # ── Write output ──────────────────────────────────────────────────────
    Path(output_path).write_text("".join(masked_chunks), encoding="utf-8")

    return _build_txt_summary(all_detections, total)


def _build_txt_summary(detections: list[dict], chunk_count: int) -> dict:
    """Build the standard summary dict from a flat list of detection results."""
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
