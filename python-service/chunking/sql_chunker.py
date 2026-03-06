"""
SQL file chunker and merger.

Splits an SQL file at statement boundaries (semicolons) so no statement
is ever split across chunk boundaries.  Overlap context is injected as
specially-marked SQL comments so the PII detector can see cross-chunk
context without that context appearing twice in the merged output.

Overlap comment markers
-----------------------
Context prepended before the main chunk:
    -- CONTEXT_OVERLAP_START
    <statements from previous chunk>
    -- CONTEXT_OVERLAP_END

Context appended after the main chunk:
    -- CONTEXT_OVERLAP_AFTER_START
    <statements from next chunk>
    -- CONTEXT_OVERLAP_AFTER_END
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from pathlib import Path
from typing import List

import sqlparse

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)

# Regex patterns that strip the overlap sections from chunk output files
_OVERLAP_BEFORE_RE = re.compile(
    r"--\s*CONTEXT_OVERLAP_START.*?--\s*CONTEXT_OVERLAP_END\s*\n?",
    re.DOTALL,
)
_OVERLAP_AFTER_RE = re.compile(
    r"--\s*CONTEXT_OVERLAP_AFTER_START.*?--\s*CONTEXT_OVERLAP_AFTER_END\s*\n?",
    re.DOTALL,
)

# Lines that look like a SQL file header (comment block or SET/USE statements)
_HEADER_LINE_RE = re.compile(r"^\s*(--|#|SET\s|USE\s)", re.IGNORECASE)


class SQLChunker:
    """Splits large SQL files into statement-boundary-aligned chunks."""

    # ------------------------------------------------------------------
    # split
    # ------------------------------------------------------------------

    def split(self, file_path: str) -> List[ChunkMetadata]:
        """
        Parse *file_path* into individual SQL statements and group them
        into overlapping chunks.

        Returns
        -------
        list[ChunkMetadata]
            One entry per chunk, with temp file paths already written.
        """
        config = get_chunk_config("sql")
        statements_per_chunk: int = config["statements_per_chunk"]
        overlap: int = config["overlap_statements"]

        content = Path(file_path).read_text(encoding="utf-8", errors="replace")

        # sqlparse.split() returns raw statement strings including whitespace
        raw_statements = sqlparse.split(content)
        all_statements = [s for s in raw_statements if s.strip()]

        if not all_statements:
            logger.warning("SQLChunker.split: no non-empty statements found in %s", file_path)
            return []

        # Build logical chunk groups (no overlap yet — overlap handled below)
        chunk_groups: List[dict] = []
        i = 0
        while i < len(all_statements):
            batch = all_statements[i : i + statements_per_chunk]
            chunk_groups.append(
                {
                    "start_idx": i,
                    "end_idx": i + len(batch),
                    "statements": batch,
                }
            )
            i += statements_per_chunk

        total_chunks = len(chunk_groups)
        file_id = uuid.uuid4().hex
        tmp_dir = Path("/tmp")

        chunk_metadata_list: List[ChunkMetadata] = []

        for chunk_idx, group in enumerate(chunk_groups):
            temp_input_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}.sql")
            temp_output_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}_out.sql")

            lines: List[str] = []

            # ── Overlap BEFORE (context from previous chunk) ──────────────
            if chunk_idx > 0 and overlap > 0:
                prev_stmts = chunk_groups[chunk_idx - 1]["statements"]
                context_before = prev_stmts[-overlap:]
                lines.append("-- CONTEXT_OVERLAP_START\n")
                for stmt in context_before:
                    lines.append(stmt.strip() + "\n")
                lines.append("-- CONTEXT_OVERLAP_END\n\n")

            # ── Main chunk statements ─────────────────────────────────────
            for stmt in group["statements"]:
                lines.append(stmt.strip() + "\n")

            # ── Overlap AFTER (context from next chunk) ───────────────────
            if chunk_idx < total_chunks - 1 and overlap > 0:
                next_stmts = chunk_groups[chunk_idx + 1]["statements"]
                context_after = next_stmts[:overlap]
                lines.append("\n-- CONTEXT_OVERLAP_AFTER_START\n")
                for stmt in context_after:
                    lines.append(stmt.strip() + "\n")
                lines.append("-- CONTEXT_OVERLAP_AFTER_END\n")

            Path(temp_input_path).write_text("".join(lines), encoding="utf-8")

            chunk_metadata_list.append(
                ChunkMetadata(
                    chunk_index=chunk_idx,
                    total_chunks=total_chunks,
                    file_type="sql",
                    start_boundary=group["start_idx"],
                    end_boundary=group["end_idx"],
                    overlap_before=overlap if chunk_idx > 0 else 0,
                    overlap_after=overlap if chunk_idx < total_chunks - 1 else 0,
                    temp_input_path=temp_input_path,
                    temp_output_path=temp_output_path,
                )
            )

        logger.info(
            "SQLChunker.split: %d statements → %d chunks  (file=%s)",
            len(all_statements),
            total_chunks,
            file_path,
        )
        return chunk_metadata_list

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
        Combine processed chunk output files into a single SQL file at
        *output_path*, stripping all overlap context markers inserted by
        :meth:`split`.

        Parameters
        ----------
        chunk_results:
            ChunkResult objects (used for ordering and success checks).
        chunk_output_paths:
            Paths to the processed output files, one per chunk.  The list
            must be in the same order as *chunk_results*.
        output_path:
            Destination path for the merged SQL file.
        original_file_path:
            Path to the original (pre-processing) SQL file, used to
            extract any header lines and to verify statement count parity.
        """
        # Sort by chunk_index so we always merge in order
        ordered = sorted(
            zip(chunk_results, chunk_output_paths),
            key=lambda pair: pair[0].chunk_index,
        )

        # ── Optional header from original file ───────────────────────────
        header_lines: List[str] = []
        try:
            with open(original_file_path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if _HEADER_LINE_RE.match(line):
                        header_lines.append(line)
                    else:
                        break  # stop at the first non-header line
        except OSError:
            pass

        # ── Collect cleaned chunks ────────────────────────────────────────
        cleaned_parts: List[str] = []
        for result, out_path in ordered:
            try:
                raw = Path(out_path).read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                logger.warning(
                    "SQLChunker.merge: could not read chunk %d output (%s): %s",
                    result.chunk_index,
                    out_path,
                    exc,
                )
                continue

            # Remove overlap context sections injected during split
            cleaned = _OVERLAP_BEFORE_RE.sub("", raw)
            cleaned = _OVERLAP_AFTER_RE.sub("", cleaned)
            cleaned_parts.append(cleaned.strip())

        combined = "\n\n".join(cleaned_parts)

        # Prepend header only if it isn't already present at the top of the
        # combined content (avoids duplication when the first chunk was not
        # modified by the PII pass).
        if header_lines:
            header_block = "".join(header_lines).rstrip()
            if not combined.startswith(header_block):
                combined = header_block + "\n" + combined

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_text(combined + "\n", encoding="utf-8")

        # ── Integrity verification (statement count) ──────────────────────
        try:
            original_content = Path(original_file_path).read_text(
                encoding="utf-8", errors="replace"
            )
            original_count = original_content.count(";")
            output_count = combined.count(";")
            if original_count != output_count:
                logger.warning(
                    "SQLChunker.merge: semicolon count mismatch — "
                    "original=%d, output=%d  (file=%s)",
                    original_count,
                    output_count,
                    output_path,
                )
            else:
                logger.info(
                    "SQLChunker.merge: statement count verified (%d semicolons)  (file=%s)",
                    output_count,
                    output_path,
                )
        except OSError:
            pass

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
                    pass  # already gone or never created — not an error
