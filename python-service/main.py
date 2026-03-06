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
        "status": "ok",
        "service": "PII Detection",
        "model_loaded": _model_loaded,
        "indic_bert_loaded": pii_analyzer.indic_ner is not None,
    }


@app.post("/process", dependencies=[Depends(verify_service_signature)])
def process_file(req: ProcessRequest) -> dict[str, Any]:
    """
    Sanitise a file.

    Routes automatically: small files go through a single-pass parser;
    large files (> 10 MB) are split, processed in parallel, and merged.
    """
    try:
        Path(req.output_path).parent.mkdir(parents=True, exist_ok=True)
        result = orchestrator.process(
            file_path=req.file_path,
            output_path=req.output_path,
            file_type=req.file_type,
            override_mode=req.mode,
            job_id=req.job_id,
        )
        return {
            "success": True,
            "pii_summary": result.get("pii_summary", {}),
            "total_pii": result.get("total_pii", 0),
            "layer_breakdown": result.get("layer_breakdown", {}),
            "confidence_breakdown": result.get("confidence_breakdown", {}),
            "processing_info": result.get("processing_info", {}),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/process-status/{job_id}")
def process_status(job_id: str) -> dict[str, Any]:
    """
    Return the current chunk-processing progress for the active job.

    The parallel_processor singleton keeps an in-memory snapshot of each
    chunk's state (pending / done / failed) which is updated as workers
    complete.  progress is keyed by chunk_index.
    """
    progress = parallel_processor.get_progress()
    done  = sum(1 for v in progress.values() if v == "done")
    total = len(progress)
    percent = round(done / total * 100) if total > 0 else 0
    return {
        "job_id":    job_id,
        "progress":  progress,
        "completed": done,
        "total":     total,
        "percent":   percent,
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

