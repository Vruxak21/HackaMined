"""
CSV file chunker and merger.

Splits a CSV file at row boundaries, always including the header row in
every chunk so each chunk is a fully valid standalone CSV file that can
be processed independently by csv_parser.py.

CSV rows are entirely self-contained (a PII value never spans two rows),
so no overlap context is needed.
"""

from __future__ import annotations

import csv
import logging
import math
import os
import uuid
from pathlib import Path
from typing import List

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)


class CSVChunker:
    """Splits large CSV files into row-boundary-aligned chunks."""

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    @staticmethod
    def get_file_id(file_path: str) -> str:
        """
        Return a collision-safe identifier derived from *file_path*.

        If the basename contains a UUID-shaped segment it is reused;
        otherwise a fresh UUID is generated.
        """
        stem = Path(file_path).stem
        # Try to reuse an embedded UUID (e.g. already a temp file)
        parts = stem.replace("-", "").replace("_", "")
        if len(parts) >= 32 and all(c in "0123456789abcdefABCDEF" for c in parts[:32]):
            return parts[:32]
        return uuid.uuid4().hex

    # ------------------------------------------------------------------
    # split
    # ------------------------------------------------------------------

    def split(self, file_path: str) -> List[ChunkMetadata]:
        """
        Read *file_path* and write one temp CSV file per chunk.

        Each chunk file contains the original header row followed by the
        rows for that chunk — making it a valid standalone CSV.

        Returns
        -------
        list[ChunkMetadata]
            One entry per chunk (already written to disk).
        """
        config = get_chunk_config("csv")
        rows_per_chunk: int = config["rows_per_chunk"]

        # ── Step 1: read header + all data rows ──────────────────────────
        with open(file_path, "r", encoding="utf-8", errors="replace", newline="") as fh:
            reader = csv.reader(fh)
            try:
                header = next(reader)
            except StopIteration:
                logger.warning("CSVChunker.split: empty file %s", file_path)
                return []
            all_rows = list(reader)

        total_rows = len(all_rows)
        if total_rows == 0:
            logger.warning("CSVChunker.split: no data rows in %s", file_path)
            return []

        # ── Step 2: calculate chunk count ─────────────────────────────────
        total_chunks = math.ceil(total_rows / rows_per_chunk)

        file_id = self.get_file_id(file_path)
        tmp_dir = Path("/tmp")
        chunk_list: List[ChunkMetadata] = []

        # ── Step 3: write each chunk ──────────────────────────────────────
        for chunk_idx in range(total_chunks):
            start_row = chunk_idx * rows_per_chunk
            end_row = min(start_row + rows_per_chunk, total_rows)
            chunk_rows = all_rows[start_row:end_row]

            temp_input_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}.csv")
            temp_output_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}_out.csv")

            with open(temp_input_path, "w", encoding="utf-8", newline="") as out_fh:
                writer = csv.writer(out_fh)
                writer.writerow(header)      # header always first
                writer.writerows(chunk_rows)

            chunk_list.append(
                ChunkMetadata(
                    chunk_index=chunk_idx,
                    total_chunks=total_chunks,
                    file_type="csv",
                    start_boundary=start_row,
                    end_boundary=end_row,
                    overlap_before=0,   # CSV rows need no overlap
                    overlap_after=0,
                    temp_input_path=temp_input_path,
                    temp_output_path=temp_output_path,
                )
            )

        logger.info(
            "CSVChunker.split: %d rows → %d chunks  (file=%s)",
            total_rows,
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
        Concatenate processed chunk output files into a single CSV at
        *output_path*. The header is written exactly once (from the first
        chunk); subsequent chunks have their header line skipped.

        Parameters
        ----------
        chunk_results:
            One ChunkResult per chunk (used for ordering).
        chunk_output_paths:
            Matching processed output paths (same order as chunk_results).
        output_path:
            Destination path for the merged CSV.
        original_file_path:
            Original CSV — used only for row-count verification.
        """
        # Sort by chunk_index so output order is deterministic
        ordered = sorted(
            zip(chunk_results, chunk_output_paths),
            key=lambda pair: pair[0].chunk_index,
        )

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        # ── Write merged output ───────────────────────────────────────────
        # Read the header from the first chunk output
        first_out_path = ordered[0][1]
        try:
            with open(first_out_path, "r", encoding="utf-8", errors="replace", newline="") as fh:
                header_line = fh.readline()
        except OSError as exc:
            logger.error("CSVChunker.merge: cannot read first chunk output %s: %s", first_out_path, exc)
            raise

        total_data_rows = 0

        with open(output_path, "w", encoding="utf-8", newline="") as out_fh:
            out_fh.write(header_line)  # header written exactly once

            for result, out_path in ordered:
                try:
                    with open(out_path, "r", encoding="utf-8", errors="replace", newline="") as chunk_fh:
                        chunk_fh.readline()  # skip header line
                        for line in chunk_fh:
                            out_fh.write(line)
                            if line.strip():
                                total_data_rows += 1
                except OSError as exc:
                    logger.warning(
                        "CSVChunker.merge: could not read chunk %d output (%s): %s",
                        result.chunk_index,
                        out_path,
                        exc,
                    )

        # ── Integrity verification ────────────────────────────────────────
        try:
            with open(original_file_path, "r", encoding="utf-8", errors="replace", newline="") as fh:
                orig_reader = csv.reader(fh)
                orig_header = next(orig_reader)
                orig_rows = list(orig_reader)
            original_row_count = len(orig_rows)
            original_col_count = len(orig_header)

            with open(output_path, "r", encoding="utf-8", errors="replace", newline="") as fh:
                out_reader = csv.reader(fh)
                out_header = next(out_reader)
                out_rows = list(out_reader)
            output_row_count = len(out_rows)
            output_col_count = len(out_header)

            if original_row_count != output_row_count:
                logger.warning(
                    "CSVChunker.merge: row count mismatch — original=%d, output=%d  (file=%s)",
                    original_row_count,
                    output_row_count,
                    output_path,
                )
            if original_col_count != output_col_count:
                logger.warning(
                    "CSVChunker.merge: column count mismatch — original=%d, output=%d  (file=%s)",
                    original_col_count,
                    output_col_count,
                    output_path,
                )

            logger.info(
                "CSV merged: %d rows, %d columns preserved  (file=%s)",
                output_row_count,
                output_col_count,
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
                    pass  # already gone or never created
