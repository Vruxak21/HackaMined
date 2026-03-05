"""
Image parser using pytesseract + Pillow.

Extracts text via OCR (pytesseract.image_to_string for the detection pipeline,
pytesseract.image_to_data for bounding boxes), runs the full detection pipeline,
then draws filled black rectangles over every PII bounding box on the original
image and saves the redacted result.
"""

from __future__ import annotations

from typing import Any

from detection.analyzer_engine import pii_analyzer
from detection.context_analyzer import context_analyzer
from detection.confidence_scorer import confidence_scorer
from detection.masker import pii_masker


def process_image(
    input_path: str,
    output_path: str,
    mode: str = "redact",
) -> dict[str, Any]:
    """
    Detect and redact PII from a scanned image (PNG / JPG / TIFF).

    Returns a summary dict.
    """
    try:
        import pytesseract  # type: ignore[import]
        from PIL import Image, ImageDraw  # type: ignore[import]
    except ImportError as exc:
        raise RuntimeError(
            "pytesseract and Pillow are required for image processing. "
            "Install them with: pip install pytesseract Pillow"
        ) from exc

    img = Image.open(input_path).convert("RGB")

    # ── 1. OCR: full text for pipeline + word-level bounding boxes ────────────
    full_text: str = pytesseract.image_to_string(img)

    # image_to_data returns a TSV-like structure with x, y, w, h, text per word
    ocr_data = pytesseract.image_to_data(
        img, output_type=pytesseract.Output.DICT
    )

    # ── 2. Run detection pipeline ─────────────────────────────────────────────
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

    # ── 3. Draw redaction boxes over PII words ────────────────────────────────
    draw = ImageDraw.Draw(img)

    # Build a list of OCR words with their bounding boxes
    n_boxes = len(ocr_data["text"])
    ocr_words: list[dict[str, Any]] = []
    for i in range(n_boxes):
        word = ocr_data["text"][i].strip()
        if not word:
            continue
        ocr_words.append({
            "word": word,
            "left": ocr_data["left"][i],
            "top": ocr_data["top"][i],
            "width": ocr_data["width"][i],
            "height": ocr_data["height"][i],
        })

    for result in to_mask:
        pii_value: str = result.get("value", "")
        if not pii_value:
            continue

        # Find OCR words that are substrings of the detected PII value
        for ow in ocr_words:
            if ow["word"] in pii_value or pii_value in ow["word"]:
                x0 = ow["left"]
                y0 = ow["top"]
                x1 = x0 + ow["width"]
                y1 = y0 + ow["height"]
                draw.rectangle([x0, y0, x1, y1], fill=(0, 0, 0))

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

