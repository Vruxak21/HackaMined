"""
Parallel chunk processing engine.

Orchestrates the PII detection pass over a list of pre-split chunk files:
  1. Dispatches each chunk to its correct parser (same parsers used for
     single-file processing).
  2. Runs all chunks concurrently via ThreadPoolExecutor.
  3. Collects ChunkResult objects, handling per-chunk timeouts and errors.
  4. Aggregates per-chunk PII summaries into a single combined result.
  5. Exposes thread-safe progress tracking.

Thread safety notes
-------------------
* All parsers are stateless functions that read from temp_input_path and
  write to temp_output_path — safe to call from multiple threads.
* PDF and DOCX parsers do document mutation internally; the chunkers already
  ensure each chunk is a separate file, so there is no shared mutable state.
* progress dict is guarded by self.progress_lock.
"""

from __future__ import annotations

import concurrent.futures
import logging
import threading
from typing import Dict, List, Optional

from chunking.chunk_models import ChunkMetadata, ChunkResult

logger = logging.getLogger(__name__)


class ParallelProcessor:
    """Runs PII detection on a list of chunk files in parallel."""

    def __init__(self) -> None:
        self.progress_lock = threading.Lock()
        self.progress: Dict[int, str] = {}

    # ------------------------------------------------------------------
    # process_single_chunk  (runs in a worker thread)
    # ------------------------------------------------------------------

    def process_single_chunk(
        self,
        chunk_meta: ChunkMetadata,
        override_mode: Optional[str],
    ) -> ChunkResult:
        """
        Process one chunk file through its format-specific parser.

        Called from worker threads — must be thread-safe (stateless parsers,
        separate temp paths per chunk).

        Parameters
        ----------
        chunk_meta:
            Metadata for the chunk, including ``temp_input_path`` and
            ``temp_output_path``.
        override_mode:
            Masking mode string passed to the parser (e.g. "redact").

        Returns
        -------
        ChunkResult
            Always returns a ChunkResult; ``success=False`` on any error.
        """
        ft = chunk_meta.file_type.lower().lstrip(".")
        idx = chunk_meta.chunk_index

        try:
            args = (
                chunk_meta.temp_input_path,
                chunk_meta.temp_output_path,
                override_mode,
            )

            if ft == "sql":
                from parsers.sql_parser import process_sql
                result = process_sql(*args)

            elif ft == "csv":
                from parsers.csv_parser import process_csv
                result = process_csv(*args)

            elif ft in {"txt", "md"}:
                from parsers.txt_parser import process_txt
                result = process_txt(*args)

            elif ft == "json":
                from parsers.json_parser import process_json
                result = process_json(*args)

            elif ft == "pdf":
                from parsers.pdf_parser import process_pdf
                result = process_pdf(*args)

            elif ft in {"docx", "doc"}:
                from parsers.docx_parser import process_docx
                result = process_docx(*args)

            elif ft in {"png", "jpg", "jpeg", "tiff", "bmp", "webp"}:
                from parsers.image_parser import process_image
                result = process_image(*args)

            else:
                raise ValueError(f"Unsupported file type for chunked processing: {ft!r}")

            with self.progress_lock:
                self.progress[idx] = "done"

            return ChunkResult(
                chunk_index=idx,
                success=True,
                pii_summary=result.get("pii_summary", {}),
                layer_breakdown=result.get("layer_breakdown", {}),
                strategies_applied=result.get("strategies_applied", {}),
            )

        except Exception as exc:  # noqa: BLE001
            logger.error(
                "ParallelProcessor: chunk %d failed (%s): %s",
                idx,
                chunk_meta.temp_input_path,
                exc,
                exc_info=True,
            )
            with self.progress_lock:
                self.progress[idx] = "failed"

            return ChunkResult(
                chunk_index=idx,
                success=False,
                pii_summary={},
                layer_breakdown={},
                strategies_applied={},
                error=str(exc),
            )

    # ------------------------------------------------------------------
    # process_chunks_parallel
    # ------------------------------------------------------------------

    def process_chunks_parallel(
        self,
        chunk_metadata_list: List[ChunkMetadata],
        file_type: str,
        override_mode: Optional[str],
        max_workers: int,
    ) -> List[ChunkResult]:
        """
        Submit all chunks to a thread pool and collect results.

        Parameters
        ----------
        chunk_metadata_list:
            List of ChunkMetadata objects (temp files must already exist).
        file_type:
            Format string (used for logging; actual dispatch is per-chunk).
        override_mode:
            Masking mode forwarded to each parser call.
        max_workers:
            Maximum number of concurrent worker threads.

        Returns
        -------
        list[ChunkResult]
            Results sorted ascending by ``chunk_index``.
        """
        with self.progress_lock:
            self.progress = {meta.chunk_index: "pending" for meta in chunk_metadata_list}

        results: List[ChunkResult] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures: Dict[concurrent.futures.Future, int] = {
                executor.submit(self.process_single_chunk, meta, override_mode): meta.chunk_index
                for meta in chunk_metadata_list
            }

            for future in concurrent.futures.as_completed(futures):
                chunk_idx = futures[future]
                try:
                    result = future.result(timeout=300)
                    results.append(result)
                except concurrent.futures.TimeoutError:
                    logger.error(
                        "ParallelProcessor: chunk %d timed out after 300 s  (file_type=%s)",
                        chunk_idx,
                        file_type,
                    )
                    with self.progress_lock:
                        self.progress[chunk_idx] = "failed"
                    results.append(
                        ChunkResult(
                            chunk_index=chunk_idx,
                            success=False,
                            pii_summary={},
                            layer_breakdown={},
                            strategies_applied={},
                            error="Chunk processing timeout",
                        )
                    )

        results.sort(key=lambda r: r.chunk_index)
        logger.info(
            "ParallelProcessor: finished %d/%d chunks  (file_type=%s)",
            sum(1 for r in results if r.success),
            len(results),
            file_type,
        )
        return results

    # ------------------------------------------------------------------
    # aggregate_results
    # ------------------------------------------------------------------

    def aggregate_results(self, chunk_results: List[ChunkResult]) -> dict:
        """
        Merge per-chunk PII summaries into a single combined result dict.

        Counts are summed across all successful chunks.  Failed chunks are
        counted but their (empty) summaries are excluded so they don't skew
        totals.

        Returns
        -------
        dict with keys:
            pii_summary, layer_breakdown, strategies_applied,
            total_pii, failed_chunks, total_chunks, completed_chunks
        """
        total_pii_summary: Dict[str, int] = {}
        total_layer_breakdown: Dict[str, int] = {
            "regex": 0,
            "presidio_spacy": 0,
            "indic_bert": 0,
        }
        total_strategies: Dict[str, int] = {}
        failed_chunks = 0

        for result in chunk_results:
            if not result.success:
                failed_chunks += 1
                continue

            # Merge pii_summary (additive counts per PII type)
            for pii_type, count in result.pii_summary.items():
                total_pii_summary[pii_type] = (
                    total_pii_summary.get(pii_type, 0) + count
                )

            # Merge layer_breakdown (additive counts per detection layer)
            for layer, count in result.layer_breakdown.items():
                total_layer_breakdown[layer] = (
                    total_layer_breakdown.get(layer, 0) + count
                )

            # Merge strategies_applied (additive counts per strategy)
            for strategy, count in result.strategies_applied.items():
                total_strategies[strategy] = (
                    total_strategies.get(strategy, 0) + count
                )

        completed = len(chunk_results) - failed_chunks

        return {
            "pii_summary": total_pii_summary,
            "layer_breakdown": total_layer_breakdown,
            "strategies_applied": total_strategies,
            "total_pii": sum(total_pii_summary.values()),
            "failed_chunks": failed_chunks,
            "total_chunks": len(chunk_results),
            "completed_chunks": completed,
        }

    # ------------------------------------------------------------------
    # get_progress
    # ------------------------------------------------------------------

    def get_progress(self) -> dict:
        """
        Return a snapshot of the current per-chunk progress states.

        Returns
        -------
        dict mapping chunk_index (int) → state str ("pending" | "done" | "failed")
        """
        with self.progress_lock:
            return dict(self.progress)


# Module-level singleton — importable directly by the orchestrator layer
parallel_processor = ParallelProcessor()
