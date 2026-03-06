"""
PII Detection Service — FastAPI entry point.

Ties together all parsers and detection modules into two endpoints:
  POST /process      — sanitise a file (any supported format)
  POST /detect-text  — detect and mask PII in raw text
  GET  /health       — liveness probe

Security:
  POST endpoints are protected with HMAC-SHA256 request signing.
  Next.js signs every request with x-service-signature and x-service-timestamp.
  Signatures are computed over "<timestamp_ms>.<body>" using INTERNAL_SERVICE_SECRET.
  Requests without a valid, fresh signature are rejected with HTTP 401.
  Set INTERNAL_SERVICE_SECRET (64-hex value) in python-service/.env.
"""

from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from middleware.auth_middleware import verify_service_signature
from pydantic import BaseModel

# ── Load environment ──────────────────────────────────────────────────────────
load_dotenv()

# ── Detection modules (singleton instances created on import) ─────────────────
from detection.analyzer_engine import pii_analyzer          # noqa: E402
from detection.context_analyzer import context_analyzer     # noqa: E402
from detection.confidence_scorer import confidence_scorer   # noqa: E402
from detection.masker import pii_masker                     # noqa: E402

# ── Pipeline model loader (singleton, loads models once at import) ────────────
from pipeline.model_loader import is_ready, get_model_status  # noqa: E402

# ── Orchestrator (routes all file sizes: direct or chunked) ─────────────────
from chunking.orchestrator import orchestrator              # noqa: E402
from chunking.parallel_processor import parallel_processor  # noqa: E402


# ── Lifespan (replaces deprecated @app.on_event) ─────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model_loaded
    # Warm up: forces spaCy model into memory before first real request
    pii_analyzer.analyze("test warmup text")
    _model_loaded = True
    print("PII Detection Service ready")
    yield


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="PII Detection Service", lifespan=lifespan)

# Module-level flag set to True once the warmup request completes.
# The /health endpoint surfaces this so clients can wait for readiness.
_model_loaded: bool = False

# Per-job results written by background processing threads.
# Keyed by job_id; value is the final result dict once processing completes.
_job_results: dict[str, dict[str, Any]] = {}
_job_lock    = threading.Lock()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic request models ───────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    file_path: str
    output_path: str
    file_type: str
    mode: str = "redact"
    job_id: Optional[str] = None


class DetectTextRequest(BaseModel):
    text: str
    mode: str = "redact"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {
        "status": "ok" if is_ready() else "loading",
        "service": "PII Detection",
        "model_loaded": _model_loaded,
        "models": get_model_status(),
        "indic_bert_loaded": pii_analyzer.indic_ner is not None,
        "transformer_ner_loaded": pii_analyzer.indic_ner is not None,
        "transformer_model": "dslim/bert-base-NER" if pii_analyzer.indic_ner is not None else None,
    }


@app.post("/process", dependencies=[Depends(verify_service_signature)])
def process_file(req: ProcessRequest) -> dict[str, Any]:
    """
    Start file sanitisation in a background thread and return immediately.

    The caller must poll GET /process-status/{job_id} until finished=true
    to retrieve the result.  This prevents HTTP timeout for large files.
    """
    job_id = req.job_id or "default"
    try:
        Path(req.output_path).parent.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Clear any stale result and progress from a previous run of this job
    with _job_lock:
        _job_results.pop(job_id, None)
    with parallel_processor.progress_lock:
        parallel_processor.progress = {}

    def _run() -> None:
        try:
            result = orchestrator.process(
                file_path=req.file_path,
                output_path=req.output_path,
                file_type=req.file_type,
                override_mode=req.mode,
                job_id=job_id,
            )
            with _job_lock:
                _job_results[job_id] = {
                    "finished":             True,
                    "success":              True,
                    "pii_summary":          result.get("pii_summary", {}),
                    "total_pii":            result.get("total_pii", 0),
                    "layer_breakdown":      result.get("layer_breakdown", {}),
                    "confidence_breakdown": result.get("confidence_breakdown", {}),
                    "processing_info":      result.get("processing_info", {}),
                }
        except Exception as exc:
            with _job_lock:
                _job_results[job_id] = {
                    "finished": True,
                    "success":  False,
                    "error":    str(exc),
                }

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True, "job_id": job_id}


@app.get("/process-status/{job_id}")
def process_status(job_id: str) -> dict[str, Any]:
    """
    Return live chunk progress and, once processing completes, the full result.

    While processing:  finished=false, progress dict updated in real-time.
    When succeeded:    finished=true, success=true + all result fields.
    When failed:       finished=true, success=false, error message.
    """
    progress = parallel_processor.get_progress()
    done    = sum(1 for v in progress.values() if v == "done")
    total   = len(progress)
    percent = round(done / total * 100) if total > 0 else 0

    with _job_lock:
        job_result = _job_results.get(job_id)

    if job_result and job_result.get("finished"):
        if job_result["success"]:
            return {
                "job_id":               job_id,
                "progress":             progress,
                "completed":            total,
                "total":                total,
                "percent":              100,
                "finished":             True,
                "success":              True,
                "pii_summary":          job_result.get("pii_summary", {}),
                "total_pii":            job_result.get("total_pii", 0),
                "layer_breakdown":      job_result.get("layer_breakdown", {}),
                "confidence_breakdown": job_result.get("confidence_breakdown", {}),
                "processing_info":      job_result.get("processing_info", {}),
            }
        return {
            "job_id":   job_id,
            "progress": progress,
            "completed": done,
            "total":    total,
            "percent":  percent,
            "finished": True,
            "success":  False,
            "error":    job_result.get("error", "Processing failed"),
        }

    return {
        "job_id":    job_id,
        "progress":  progress,
        "completed": done,
        "total":     total,
        "percent":   percent,
        "finished":  False,
    }


@app.post("/detect-text", dependencies=[Depends(verify_service_signature)])
def detect_text(req: DetectTextRequest) -> dict[str, Any]:
    """
    Detect and mask PII in a raw text string.

    Runs the full 5-stage pipeline and returns detected spans, the masked
    text, and summary statistics.
    """
    try:
        analysis = pii_analyzer.analyze(req.text)
        cleaned = analysis["cleaned_text"]

        enriched = context_analyzer.analyze(
            cleaned,
            analysis["presidio_results"],
            analysis["indic_results"],
            analysis["label_pairs"],
        )
        deduped = confidence_scorer.deduplicate(enriched)
        scored = confidence_scorer.score_and_filter(deduped)
        to_mask = scored["to_mask"]

        mask_out = pii_masker.mask(cleaned, to_mask, req.mode)

        detected = [
            {
                "type": r["type"],
                "value": r["value"],
                "start": r["start"],
                "end": r["end"],
                "score": round(r["score"], 4),
                "source": r.get("source", "presidio_spacy"),
                "label_boosted": r.get("label_boosted", False),
                "proximity_boosted": r.get("proximity_boosted", False),
                "slide6_boosted": r.get("slide6_boosted", False),
            }
            for r in to_mask
        ]

        return {
            "detected": detected,
            "masked_text": mask_out["masked_text"],
            "token_map": mask_out.get("token_map", {}),
            "pii_summary": confidence_scorer.get_summary(to_mask),
            "layer_breakdown": confidence_scorer.get_layer_breakdown(to_mask),
            "confidence_breakdown": confidence_scorer.get_confidence_breakdown(
                scored["high_count"], scored["medium_count"]
            ),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

