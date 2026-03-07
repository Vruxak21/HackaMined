"""
Image parser — delegates to pipeline.ocr_engine for text extraction.

NOTE: For normal orchestrated processing, images are intercepted earlier by
ChunkOrchestrator._process_image() (which calls chunking.image_chunker.process_image).
This module remains as a lightweight fallback / standalone entry point.

Auto-selects the best available OCR backend at runtime:
  EasyOCR (pure Python, deep-learning) → pytesseract (if binary installed)
  → EXIF metadata only → no-op (image saved unchanged, 0 PII).
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from detection.analyzer_engine import pii_analyzer
from detection.context_analyzer import context_analyzer
from detection.confidence_scorer import confidence_scorer
from pipeline.ocr_engine import run_ocr, get_ocr_status

logger = logging.getLogger(__name__)


def process_image(
    input_path: str,
    output_path: str,
    mode: str = "redact",
) -> dict[str, Any]:
    """
    Detect and redact PII from a scanned image (PNG / JPG / TIFF / BMP / WEBP).

    Uses the active OCR engine (EasyOCR preferred, pytesseract fallback).
    If no OCR engine is available the original image is saved unchanged
    with 0 PII detected — the job succeeds rather than failing.

    Returns a summary dict.
    """
    ocr_status = get_ocr_status()

    # ── No OCR engine: save original and return cleanly ───────────────────────
    if ocr_status["active_engine"] in {"none", "failed", "pillow_only"}:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(input_path, output_path)
        logger.warning(
            "process_image: no OCR engine available — "
            "image saved unchanged, 0 PII detected  (file=%s).  "
            "Install EasyOCR: pip install easyocr",
            input_path,
        )
        return {
            "pii_summary": {},
            "layer_breakdown": {"regex": 0, "spacy": 0, "bert": 0},
            "confidence_breakdown": {"high": 0, "medium": 0},
            "total_pii": 0,
        }

    img = Image.open(input_path).convert("RGB")

    # ── 1. OCR: full text + word-level bounding boxes ─────────────────────────
    full_text, words, _engine = run_ocr(img)

    # ── 2. Run full detection pipeline ────────────────────────────────────────
    if full_text:
        analysis = pii_analyzer.analyze(full_text)
        enriched = context_analyzer.analyze(
            analysis["cleaned_text"],
            analysis["presidio_results"],
            analysis["indic_results"],
            analysis["label_pairs"],
        )
        deduped = confidence_scorer.deduplicate(enriched)
        scored = confidence_scorer.score_and_filter(deduped)
        to_mask = scored["to_mask"]
    else:
        to_mask = []
        scored = {"high_count": 0, "medium_count": 0}

    # ── 3. Draw redaction boxes over PII bounding boxes ───────────────────────
    if to_mask:
        draw = ImageDraw.Draw(img)
        for result in to_mask:
            pii_value: str = result.get("value", "")
            if not pii_value:
                continue
            for word in words:
                if word.text in pii_value or pii_value in word.text:
                    draw.rectangle(
                        [word.x, word.y, word.x + word.width, word.y + word.height],
                        fill=(0, 0, 0),
                    )

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path)

    return {
        "pii_summary": confidence_scorer.get_summary(to_mask),
        "layer_breakdown": confidence_scorer.get_layer_breakdown(to_mask),
        "confidence_breakdown": {
            "high": scored["high_count"],
            "medium": scored["medium_count"],
        },
        "total_pii": len(to_mask),
    }

