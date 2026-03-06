"""
ChunkOrchestrator — main entry point for large-file PII processing.

Decides whether to use chunked or direct processing based on file size:
  • ≤ FILE_SIZE_THRESHOLD_MB  → direct single-pass parser (fast, no split overhead)
  • > FILE_SIZE_THRESHOLD_MB  → split → parallel PII detection → merge
  • > MAX_FILE_SIZE_MB        → rejected immediately with ValueError

All callers should use the module-level ``orchestrator`` singleton rather
than instantiating ChunkOrchestrator directly.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import (
    get_chunk_config,
    get_file_size_mb,
    needs_chunking,
    validate_file_size,
)
from chunking.csv_chunker import CSVChunker
from chunking.docx_chunker import DOCXChunker
from chunking.image_chunker import ImageChunker
from chunking.json_chunker import JSONChunker
from chunking.parallel_processor import parallel_processor
from chunking.pdf_chunker import PDFChunker
from chunking.sql_chunker import SQLChunker
from chunking.txt_chunker import TXTChunker

logger = logging.getLogger(__name__)


class ChunkOrchestrator:
    """Orchestrates PII sanitisation for files of any size."""

    # Map of normalised file-type strings to chunker classes
    CHUNKERS: dict[str, type] = {
        "sql":  SQLChunker,
        "csv":  CSVChunker,
        "txt":  TXTChunker,
        "md":   TXTChunker,
        "json": JSONChunker,
        "pdf":  PDFChunker,
        "docx": DOCXChunker,
        "doc":  DOCXChunker,
        "png":  ImageChunker,
        "jpg":  ImageChunker,
        "jpeg": ImageChunker,
    }

    # ──────────────────────────────────────────────────────────────────────────
    # Public interface
    # ──────────────────────────────────────────────────────────────────────────

    def process(
        self,
        file_path: str,
        output_path: str,
        file_type: str,
        override_mode: Optional[str] = None,
        job_id: Optional[str] = None,  # noqa: ARG002  reserved for future progress tracking
    ) -> dict[str, Any]:
        """
        Sanitise *file_path*, writing results to *output_path*.

        Parameters
        ----------
        file_path:
            Absolute path to the source file.
        output_path:
            Absolute path where the sanitised file will be written.
        file_type:
            Extension without leading dot (e.g. ``"csv"``, ``"pdf"``).
        override_mode:
            Masking mode forwarded to every parser call (e.g. ``"redact"``).
            Defaults to ``"redact"`` when *None*.
        job_id:
            Optional identifier used for progress tracking (reserved; not yet
            wired to a persistence layer).

        Returns
        -------
        dict
            Always contains ``success``, ``pii_summary``, ``total_pii``,
            ``layer_breakdown``, ``strategies_applied``, and
            ``processing_info``.

        Raises
        ------
        ValueError
            If the file exceeds the 100 MB hard limit or the file type is
            unsupported.
        Exception
            If *all* chunks fail during parallel processing.
        """
        ft = file_type.lower().lstrip(".")
        mode = override_mode or "redact"

        # ── Step 1: Validate file size ────────────────────────────────────────
        if not validate_file_size(file_path):
            size_mb = get_file_size_mb(file_path)
            raise ValueError(
                f"File exceeds 100MB limit. "
                f"Size: {size_mb:.1f}MB"
            )

        file_size_mb = get_file_size_mb(file_path)

        # ── Step 2: Decide processing strategy ───────────────────────────────
        if not needs_chunking(file_path):
            return self._direct_process(file_path, output_path, ft, mode)

        # ── Step 3: Large file — chunked processing ───────────────────────────
        logger.info(
            "Large file detected: %.1fMB, using chunked processing",
            file_size_mb,
        )

        # ── Step 4: Get chunker ───────────────────────────────────────────────
        chunker_class = self.CHUNKERS.get(ft)
        if chunker_class is None:
            raise ValueError(f"Unsupported file type: {file_type}")
        chunker = chunker_class()

        # ── Step 5: Split ─────────────────────────────────────────────────────
        logger.info("Splitting file into chunks...")
        chunk_metadata_list: list[ChunkMetadata] = chunker.split(file_path)
        total_chunks = len(chunk_metadata_list)
        logger.info("Created %d chunks", total_chunks)

        # ── Step 7: Process all chunks in parallel ────────────────────────────
        cfg = get_chunk_config(ft)
        max_workers: int = cfg.get("max_workers", 4)

        logger.info(
            "Processing %d chunks with %d parallel workers...",
            total_chunks,
            max_workers,
        )

        chunk_results: list[ChunkResult] = parallel_processor.process_chunks_parallel(
            chunk_metadata_list=chunk_metadata_list,
            file_type=ft,
            override_mode=mode,
            max_workers=max_workers,
        )

        # ── Step 8: Check for failures ────────────────────────────────────────
        failed = [r for r in chunk_results if not r.success]
        if failed:
            logger.warning("%d chunks failed", len(failed))
            if len(failed) == total_chunks:
                raise Exception("All chunks failed processing")

        # ── Step 9: Merge ─────────────────────────────────────────────────────
        logger.info("Merging processed chunks...")

        sorted_results = sorted(chunk_results, key=lambda r: r.chunk_index)
        sorted_output_paths = [
            chunk_metadata_list[r.chunk_index].temp_output_path
            for r in sorted_results
        ]

        self._call_merge(
            chunker,
            ft,
            sorted_results,
            chunk_metadata_list,
            sorted_output_paths,
            output_path,
            file_path,
        )

        logger.info("Merge complete → %s", output_path)

        # ── Step 10: Aggregate ────────────────────────────────────────────────
        aggregated = parallel_processor.aggregate_results(chunk_results)

        # ── Step 11: Cleanup ──────────────────────────────────────────────────
        chunker.cleanup(chunk_metadata_list)

        # ── Step 12: Return ───────────────────────────────────────────────────
        return {
            "success": True,
            "pii_summary": aggregated["pii_summary"],
            "total_pii": aggregated["total_pii"],
            "layer_breakdown": aggregated["layer_breakdown"],
            "strategies_applied": aggregated["strategies_applied"],
            "processing_info": {
                "file_size_mb": round(file_size_mb, 2),
                "total_chunks": total_chunks,
                "completed_chunks": aggregated["completed_chunks"],
                "failed_chunks": aggregated["failed_chunks"],
                "chunked_processing": True,
            },
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Private helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _direct_process(
        self,
        file_path: str,
        output_path: str,
        file_type: str,
        mode: str,
    ) -> dict[str, Any]:
        """
        Process a small file with a single-pass parser (no chunking).

        Returns a result dict shaped identically to the chunked path so
        callers never need to branch on ``chunked_processing``.
        """
        ft = file_type.lower().lstrip(".")

        if ft == "sql":
            from parsers.sql_parser import process_sql
            raw = process_sql(file_path, output_path, mode)
        elif ft == "csv":
            from parsers.csv_parser import process_csv
            raw = process_csv(file_path, output_path, mode)
        elif ft in {"txt", "md"}:
            from parsers.txt_parser import process_txt
            raw = process_txt(file_path, output_path, mode)
        elif ft == "json":
            from parsers.json_parser import process_json
            raw = process_json(file_path, output_path, mode)
        elif ft == "pdf":
            from parsers.pdf_parser import process_pdf
            raw = process_pdf(file_path, output_path, mode)
        elif ft in {"docx", "doc"}:
            from parsers.docx_parser import process_docx
            raw = process_docx(file_path, output_path, mode)
        elif ft in {"png", "jpg", "jpeg", "tiff", "bmp", "webp"}:
            from parsers.image_parser import process_image
            raw = process_image(file_path, output_path, mode)
        else:
            raise ValueError(f"Unsupported file type: {file_type}")

        file_size_mb = get_file_size_mb(file_path)

        return {
            "success": True,
            "pii_summary":       raw.get("pii_summary", {}),
            "total_pii":         raw.get("total_pii", 0),
            "layer_breakdown":   raw.get("layer_breakdown", {}),
            "strategies_applied": raw.get("strategies_applied", {}),
            "processing_info": {
                "file_size_mb":      round(file_size_mb, 2),
                "total_chunks":      1,
                "completed_chunks":  1,
                "failed_chunks":     0,
                "chunked_processing": False,
            },
        }

    @staticmethod
    def _call_merge(
        chunker: Any,
        ft: str,
        chunk_results: list[ChunkResult],
        chunk_metadata_list: list[ChunkMetadata],
        chunk_output_paths: list[str],
        output_path: str,
        original_file_path: str,
    ) -> None:
        """
        Dispatch to the correct ``merge()`` overload for each file type.

        Each chunker's ``merge()`` accepts a slightly different signature
        because some formats need extra state (JSON chunk_type/array_key;
        PDF / Image need the metadata list for page/tile geometry).
        """
        if ft == "json":
            chunker.merge(
                chunk_results,
                chunk_output_paths,
                output_path,
                original_file_path,
                chunker.chunk_type,
                chunker.array_key,
            )
        elif ft in {"png", "jpg", "jpeg", "tiff", "bmp", "webp"}:
            chunker.merge(
                chunk_results,
                chunk_output_paths,
                chunk_metadata_list,
                output_path,
                original_file_path,
                ft,
            )
        elif ft == "pdf":
            chunker.merge(
                chunk_results,
                chunk_output_paths,
                output_path,
                original_file_path,
                chunk_metadata_list,
            )
        else:
            # SQL, CSV, TXT/MD, DOCX/DOC
            chunker.merge(
                chunk_results,
                chunk_output_paths,
                output_path,
                original_file_path,
            )


# Module-level singleton — import and call orchestrator.process() directly
orchestrator = ChunkOrchestrator()
