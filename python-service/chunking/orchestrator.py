"""
ChunkOrchestrator — main entry point for PII processing of all file sizes.

Decides whether to use chunked or direct processing based on file size:
  • ≤ 5 MB  → direct single-pass processing (no chunking overhead)
  • > 5 MB  → in-memory chunked parallel processing
  • > 100 MB → rejected immediately with ValueError

The pipeline configuration (which layers run, chunk sizes, worker counts)
is determined by ``pipeline.pipeline_config.get_pipeline_config()`` and
passed through to every chunker and detector call.

All callers should use the module-level ``orchestrator`` singleton rather
than instantiating ChunkOrchestrator directly.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Optional

from chunking.config import (
    get_file_size_mb,
    needs_chunking,
    validate_file_size,
)
from chunking.parallel_processor import parallel_processor
from pipeline.pipeline_config import get_pipeline_config

logger = logging.getLogger(__name__)

# ── Dispatch table: file_type → chunker process function ──────────────────────
# Lazily populated on first use to avoid circular imports.

_CHUNKED_FUNCS: dict[str, Callable[..., dict[str, Any]]] | None = None


def _get_chunked_funcs() -> dict[str, Callable[..., dict[str, Any]]]:
    global _CHUNKED_FUNCS
    if _CHUNKED_FUNCS is not None:
        return _CHUNKED_FUNCS

    from chunking.csv_chunker import process_csv_chunked
    from chunking.txt_chunker import process_txt_chunked
    from chunking.sql_chunker import process_sql_chunked
    from chunking.json_chunker import process_json_chunked
    from chunking.pdf_chunker import process_pdf_chunked
    from chunking.docx_chunker import process_docx_chunked

    _CHUNKED_FUNCS = {
        "sql":  process_sql_chunked,
        "csv":  process_csv_chunked,
        "txt":  process_txt_chunked,
        "md":   process_txt_chunked,
        "json": process_json_chunked,
        "pdf":  process_pdf_chunked,
        "docx": process_docx_chunked,
        "doc":  process_docx_chunked,
        # images are handled via early intercept in process() before reaching here
    }
    return _CHUNKED_FUNCS


class ChunkOrchestrator:
    """Orchestrates PII sanitisation for files of any size."""

    # ──────────────────────────────────────────────────────────────────────────
    # Public interface
    # ──────────────────────────────────────────────────────────────────────────

    def process(
        self,
        file_path: str,
        output_path: str,
        file_type: str,
        override_mode: Optional[str] = None,
        job_id: Optional[str] = None,  # noqa: ARG002
    ) -> dict[str, Any]:
        """
        Sanitise *file_path*, writing results to *output_path*.

        Returns a dict with ``success``, ``pii_summary``, ``total_pii``,
        ``layer_breakdown``, ``confidence_breakdown``, ``strategies_applied``,
        and ``processing_info``.
        """
        ft   = file_type.lower().lstrip(".")
        mode = override_mode or "redact"

        # ── Early intercept: images bypass chunking logic completely ──────────
        if ft in {"png", "jpg", "jpeg", "webp", "bmp", "tiff"}:
            return self._process_image(file_path, output_path, ft, mode)

        # ── Step 1: Validate ──────────────────────────────────────────────────
        if not validate_file_size(file_path):
            size_mb = get_file_size_mb(file_path)
            raise ValueError(f"File exceeds 100 MB limit. Size: {size_mb:.1f} MB")

        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)

        # ── Step 2: Pipeline config ───────────────────────────────────────────
        config = get_pipeline_config(ft, file_size_mb)
        logger.info(
            "Pipeline config for %s %.1fMB: %s",
            ft,
            file_size_mb,
            config["skip_bert_reason"],
        )

        # ── Step 3: Small file — direct single-pass ──────────────────────────
        if not needs_chunking(file_path):
            return self._direct_process(file_path, output_path, ft, mode, config)

        # ── Step 4: Large file — in-memory parallel chunked processing ────────
        logger.info("Large file %.1f MB → in-memory chunked processing", file_size_mb)

        funcs = _get_chunked_funcs()
        process_fn = funcs.get(ft)
        if process_fn is None:
            raise ValueError(
                f"Unsupported file type for chunked processing: {file_type!r}"
            )

        # Clear previous job's progress; individual callbacks will populate it.
        with parallel_processor.progress_lock:
            parallel_processor.progress = {}

        progress_cb = parallel_processor.make_progress_cb()

        result = process_fn(
            input_path=file_path,
            output_path=output_path,
            mode=mode,
            config=config,
            progress_cb=progress_cb,
        )

        logger.info("In-memory chunked processing complete → %s", output_path)

        chunk_statuses = parallel_processor.get_progress()
        total_chunks   = result.get("chunk_count", len(chunk_statuses))
        done_chunks    = sum(1 for s in chunk_statuses.values() if s == "done")
        failed_chunks  = sum(1 for s in chunk_statuses.values() if s == "failed")

        if failed_chunks == total_chunks and total_chunks > 0:
            raise Exception("All chunks failed processing")

        return {
            "success":              True,
            "pii_summary":          result["pii_summary"],
            "total_pii":            result["total_pii"],
            "layer_breakdown":      result["layer_breakdown"],
            "confidence_breakdown": result.get("confidence_breakdown", {}),
            "strategies_applied":   result.get("strategies_applied", {}),
            "processing_info": {
                "file_size_mb":       round(file_size_mb, 2),
                "total_chunks":       total_chunks,
                "completed_chunks":   done_chunks,
                "failed_chunks":      failed_chunks,
                "chunked_processing": True,
                "chunk_statuses":     {str(k): v for k, v in chunk_statuses.items()},
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
        config: dict,
    ) -> dict[str, Any]:
        """
        Process a small file (≤ 5 MB).

        For text-like formats (txt, sql) the full text is read once and
        detect_pii_single is called directly — no chunking at all.

        For structured / binary formats the format-specific parser is used,
        but with the pipeline config applied.

        Returns a result dict shaped identically to the chunked path so
        callers never need to branch on ``chunked_processing``.
        """
        ft = file_type.lower().lstrip(".")
        file_size_mb = get_file_size_mb(file_path)

        # ── Text / SQL: read → detect → mask → write ─────────────────────────
        if ft in {"txt", "md", "sql"}:
            from pathlib import Path
            from pipeline.detector import detect_pii_single
            from detection.masker import pii_masker

            text = Path(file_path).read_text(encoding="utf-8", errors="replace")
            detections = detect_pii_single(text, config)

            # Build replacement map
            replacement_map: dict[str, str] = {}
            for det in detections:
                val = det["value"]
                if val and val not in replacement_map:
                    if mode == "redact":
                        replacement_map[val] = "[REDACTED]"
                    elif mode == "mask":
                        replacement_map[val] = pii_masker.get_partial_mask(
                            val, det["entity_type"]
                        )
                    elif mode == "tokenize":
                        replacement_map[val] = pii_masker.get_token(
                            det["entity_type"]
                        )
                    else:
                        replacement_map[val] = "[REDACTED]"

            masked = text
            for original in sorted(replacement_map, key=len, reverse=True):
                masked = masked.replace(original, replacement_map[original])

            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_text(masked, encoding="utf-8")

            summary = _build_summary(detections, 1)
            return {
                "success":              True,
                **summary,
                "strategies_applied":   {},
                "processing_info": {
                    "file_size_mb":       round(file_size_mb, 2),
                    "total_chunks":       1,
                    "completed_chunks":   1,
                    "failed_chunks":      0,
                    "chunked_processing": False,
                },
            }

        # ── Other formats: use chunker process() even for small files ─────────
        funcs = _get_chunked_funcs()
        process_fn = funcs.get(ft)
        if process_fn is None:
            # Fallback to old parsers for unrecognised small-file formats
            return self._fallback_direct_process(
                file_path, output_path, ft, mode, file_size_mb
            )

        with parallel_processor.progress_lock:
            parallel_processor.progress = {}

        progress_cb = parallel_processor.make_progress_cb()

        result = process_fn(
            input_path=file_path,
            output_path=output_path,
            mode=mode,
            config=config,
            progress_cb=progress_cb,
        )

        return {
            "success":              True,
            "pii_summary":          result["pii_summary"],
            "total_pii":            result["total_pii"],
            "layer_breakdown":      result["layer_breakdown"],
            "confidence_breakdown": result.get("confidence_breakdown", {}),
            "strategies_applied":   result.get("strategies_applied", {}),
            "processing_info": {
                "file_size_mb":       round(file_size_mb, 2),
                "total_chunks":       result.get("chunk_count", 1),
                "completed_chunks":   result.get("chunk_count", 1),
                "failed_chunks":      0,
                "chunked_processing": False,
            },
        }

    def _process_image(
        self,
        file_path: str,
        output_path: str,
        file_type: str,
        mode: str,
    ) -> dict[str, Any]:
        """Route image files through the dedicated OCR+PII pipeline."""
        from chunking.image_chunker import process_image

        file_size_mb = get_file_size_mb(file_path)
        config = get_pipeline_config(file_type, file_size_mb)

        with parallel_processor.progress_lock:
            parallel_processor.progress = {}

        def _progress_cb(done: int, total: int) -> None:
            with parallel_processor.progress_lock:
                parallel_processor.progress = {i: "done" for i in range(done)}

        result = process_image(
            file_path=file_path,
            output_path=output_path,
            config=config,
            progress_callback=_progress_cb,
        )

        return {
            "success":              result.get("success", True),
            "pii_summary":          result.get("pii_summary", {}),
            "total_pii":            result.get("total_pii", 0),
            "layer_breakdown":      result.get("layer_breakdown", {}),
            "confidence_breakdown": result.get("confidence_breakdown", {}),
            "strategies_applied":   result.get("strategies_applied", {}),
            "processing_info": {
                "file_size_mb":       round(file_size_mb, 2),
                "total_chunks":       result.get("tile_count", 1),
                "completed_chunks":   result.get("tile_count", 1),
                "failed_chunks":      0,
                "chunked_processing": False,
                "image_processing":   True,
                "ocr_engine":         result.get("engine_used", "none"),
            },
        }

    def _fallback_direct_process(
        self,
        file_path: str,
        output_path: str,
        file_type: str,
        mode: str,
        file_size_mb: float,
    ) -> dict[str, Any]:
        """Fallback to old parsers for formats that may not have a chunker."""
        ft = file_type.lower().lstrip(".")

        if ft == "csv":
            from parsers.csv_parser import process_csv
            raw = process_csv(file_path, output_path, mode)
        elif ft == "json":
            from parsers.json_parser import process_json
            raw = process_json(file_path, output_path, mode)
        elif ft == "pdf":
            from parsers.pdf_parser import process_pdf
            raw = process_pdf(file_path, output_path, mode)
        elif ft in {"docx", "doc"}:
            from parsers.docx_parser import process_docx
            raw = process_docx(file_path, output_path, mode)
        else:
            raise ValueError(f"Unsupported file type: {file_type}")

        return {
            "success": True,
            "pii_summary":          raw.get("pii_summary", {}),
            "total_pii":            raw.get("total_pii", 0),
            "layer_breakdown":      raw.get("layer_breakdown", {}),
            "confidence_breakdown": raw.get("confidence_breakdown", {}),
            "strategies_applied":   raw.get("strategies_applied", {}),
            "processing_info": {
                "file_size_mb":       round(file_size_mb, 2),
                "total_chunks":       1,
                "completed_chunks":   1,
                "failed_chunks":      0,
                "chunked_processing": False,
            },
        }


# ── Summary helper ────────────────────────────────────────────────────────────

def _build_summary(
    detections: list[dict[str, Any]],
    chunk_count: int,
) -> dict[str, Any]:
    """Build the standard summary dict from a flat list of detection results."""
    pii_summary: dict[str, int] = {}
    layer_breakdown: dict[str, int] = {"regex": 0, "spacy": 0, "bert": 0}
    high = 0
    medium = 0

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


# Module-level singleton — import and call orchestrator.process() directly
orchestrator = ChunkOrchestrator()
