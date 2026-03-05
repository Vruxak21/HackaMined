"""
PDF parser using PyMuPDF (fitz).

Extracts text (and OCR text from embedded images) from every page, runs the
full 5-stage PII detection pipeline, then applies redactions directly on the
PDF canvas and clears metadata fields that may contain PII.
"""

from __future__ import annotations

import io
from typing import Any

import fitz  # PyMuPDF

from detection.analyzer_engine import pii_analyzer
from detection.context_analyzer import context_analyzer
from detection.confidence_scorer import confidence_scorer
from detection.masker import pii_masker


def _run_pipeline(
    text: str,
    mode: str,
    column_name: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any], int, int]:
    """
    Shared 5-stage pipeline: analyze → context → deduplicate → score → mask.

    Returns (to_mask, mask_output, high_count, medium_count).
    """
    analysis = pii_analyzer.analyze(text)
    enriched = context_analyzer.analyze(
        text,
        analysis["presidio_results"],
        analysis["indic_results"],
        analysis["label_pairs"],
        column_name=column_name,
    )
    deduped = confidence_scorer.deduplicate(enriched)
    scored = confidence_scorer.score_and_filter(deduped)
    mask_out = pii_masker.mask(text, scored["to_mask"], mode)
    return scored["to_mask"], mask_out, scored["high_count"], scored["medium_count"]


def process_pdf(
    input_path: str,
    output_path: str,
    mode: str = "redact",
) -> dict[str, Any]:
    """
    Detect and redact PII from a PDF file.

    Parameters
    ----------
    input_path  : path to the source PDF
    output_path : path where the sanitised PDF will be saved
    mode        : "redact" | "mask" | "tokenize"

    Returns
    -------
    Summary dict with pii_summary, layer_breakdown, confidence_breakdown, total_pii.
    """
    doc: fitz.Document = fitz.open(input_path)

    # ── 1. Extract full text (and OCR text from embedded images) ─────────────
    page_texts: list[str] = []
    for page in doc:
        page_texts.append(page.get_text())

        # Embedded images → OCR (best-effort; requires pytesseract)
        try:
            import pytesseract  # type: ignore[import]
            from PIL import Image  # type: ignore[import]

            for img_info in page.get_images(full=True):
                xref = img_info[0]
                base_image = doc.extract_image(xref)
                img_bytes = base_image["image"]
                img = Image.open(io.BytesIO(img_bytes))
                ocr_text = pytesseract.image_to_string(img)
                if ocr_text.strip():
                    page_texts.append(ocr_text)
        except Exception:  # tesseract / PIL not available
            pass

    full_text = "\n".join(page_texts)

    # ── 2. Run detection pipeline ─────────────────────────────────────────────
    to_mask, _mask_out, high_count, medium_count = _run_pipeline(full_text, mode)

    # ── 3. Apply redactions to PDF canvas ────────────────────────────────────
    for result in to_mask:
        value = result.get("value", "")
        if not value:
            continue
        for page in doc:
            areas = page.search_for(value)
            for area in areas:
                page.add_redact_annot(area, fill=(0, 0, 0))
            if areas:
                page.apply_redactions()

    # ── 4. Sanitise metadata ──────────────────────────────────────────────────
    meta = doc.metadata or {}
    sanitised_meta: dict[str, str] = {}
    for field in ("title", "author", "subject", "creator", "producer"):
        raw = meta.get(field, "")
        if raw:
            _, meta_mask_out, _, _ = _run_pipeline(raw, "redact")
            sanitised_meta[field] = meta_mask_out["masked_text"]
        else:
            sanitised_meta[field] = raw
    doc.set_metadata(sanitised_meta)

    doc.save(output_path, garbage=4, deflate=True)
    doc.close()

    return {
        "pii_summary": confidence_scorer.get_summary(to_mask),
        "layer_breakdown": confidence_scorer.get_layer_breakdown(to_mask),
        "confidence_breakdown": {
            "high": high_count,
            "medium": medium_count,
        },
        "total_pii": len(to_mask),
    }

