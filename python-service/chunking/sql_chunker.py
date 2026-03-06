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
import tempfile
import uuid
from pathlib import Path
from typing import List

import sqlparse

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)

DEFAULT_CHUNK_SIZE = 2_000  # statements per chunk
CONTEXT_OVERLAP_STMTS = 2   # statements shared with neighbours

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

    def split(self, file_path: str, chunk_size: int | None = None) -> List[ChunkMetadata]:
        """
        Parse *file_path* into individual SQL statements and group them
        into overlapping chunks.

        Parameters
        ----------
        chunk_size:
            Statements per chunk. Falls back to DEFAULT_CHUNK_SIZE if None.

        Returns
        -------
        list[ChunkMetadata]
            One entry per chunk, with temp file paths already written.
        """
        statements_per_chunk: int = chunk_size or DEFAULT_CHUNK_SIZE
        overlap: int = CONTEXT_OVERLAP_STMTS

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
        tmp_dir = Path(tempfile.gettempdir())

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


# ── Module-level chunked processing function ──────────────────────────────────

def _noop_progress(chunk_idx: int, status: str) -> None:  # noqa: ARG001
    pass


def _split_sql_statements(text: str) -> list[str]:
    """Split SQL into individual statements using sqlparse if available."""
    try:
        raw = sqlparse.split(text)
        return [s for s in raw if s.strip()]
    except Exception:
        # Fallback: split on ";\n" and ";\r\n"
        import re as _re
        parts = _re.split(r"(;)", text)
        statements: list[str] = []
        current = ""
        for part in parts:
            current += part
            if part == ";" and current.strip() not in ("", ";"):
                statements.append(current)
                current = ""
        if current.strip():
            statements.append(current)
        return statements or [text]


def process_sql_chunked(
    input_path: str,
    output_path: str,
    mode: str = "redact",
    config: dict | None = None,
    progress_cb=_noop_progress,
) -> dict:
    """
    End-to-end chunked SQL processing with the new pipeline.

    SQL is ALWAYS Rule A (regex only).  If the incoming config somehow has
    use_spacy=True, it is overridden here as a safety guard.
    """
    from pathlib import Path

    from detection.masker import pii_masker
    from pipeline.detector import detect_pii_batch

    if config is None:
        config = {"use_regex": True, "use_spacy": False, "use_bert": False,
                  "chunk_size": DEFAULT_CHUNK_SIZE, "workers": 8}

    # Safety override: SQL is always regex-only (Rule A)
    if config.get("use_spacy") or config.get("use_bert"):
        logger.warning(
            "sql_chunker: overriding use_spacy=%s, use_bert=%s → False "
            "(SQL is always Rule A: regex only)",
            config.get("use_spacy"),
            config.get("use_bert"),
        )
        config = {**config, "use_spacy": False, "use_bert": False}

    chunk_size = config.get("chunk_size", DEFAULT_CHUNK_SIZE)

    text = Path(input_path).read_text(encoding="utf-8", errors="replace")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    statements = _split_sql_statements(text)
    raw_chunks = [
        "".join(statements[i : i + chunk_size])
        for i in range(0, len(statements), chunk_size)
    ] or [text]
    total = len(raw_chunks)

    for i in range(total):
        progress_cb(i, "pending")

    # ── Detection with context overlap ──────────────────────────────────
    overlap = CONTEXT_OVERLAP_STMTS
    detection_texts: list[str] = []
    for idx, chunk in enumerate(raw_chunks):
        # 2-statement overlap from neighbours (context for boundary PII)
        before_stmts = statements[max(0, idx * chunk_size - overlap) : idx * chunk_size]
        after_start = min((idx + 1) * chunk_size, len(statements))
        after_stmts = statements[after_start : after_start + overlap]
        before = "".join(before_stmts)
        after = "".join(after_stmts)
        detection_texts.append(before + chunk + after)

    all_chunk_detections = detect_pii_batch(detection_texts, config)

    # ── Masking ─────────────────────────────────────────────────────────
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

            masked = chunk
            for original in sorted(replacement_map, key=len, reverse=True):
                masked = masked.replace(original, replacement_map[original])

            masked_chunks.append(masked)
            progress_cb(idx, "done")
        except Exception:
            masked_chunks.append(chunk)
            progress_cb(idx, "failed")
            raise

    # ── Write output ──────────────────────────────────────────────────────
    Path(output_path).write_text("".join(masked_chunks), encoding="utf-8")

    return _build_sql_summary(all_detections, total)


def _build_sql_summary(detections: list[dict], chunk_count: int) -> dict:
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
