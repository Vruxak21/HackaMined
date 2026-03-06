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
from pathlib import Path
from typing import List

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)

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

    def split(self, file_path: str) -> List[ChunkMetadata]:
        """
        Read *file_path*, group its paragraphs into chunks not exceeding
        *chars_per_chunk*, and write one temp .txt file per chunk.

        Returns
        -------
        list[ChunkMetadata]
            One entry per chunk (temp files already written).
        """
        config = get_chunk_config("txt")
        chars_per_chunk: int = config["chars_per_chunk"]
        overlap_chars: int = config["overlap_chars"]

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
        tmp_dir = Path("/tmp")

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
