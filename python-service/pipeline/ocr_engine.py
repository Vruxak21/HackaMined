"""
Tiered OCR engine for image PII processing.

Engine priority (checked once at module import — model loads at server startup):
  Tier 1 — EasyOCR (easyocr)     Pure Python, deep-learning OCR.
                                  pip install easyocr is all that's needed.
                                  Handles handwriting, mixed fonts, poor scans.
  Tier 2 — pytesseract            Wraps the system Tesseract binary (if installed).
                                  Fastest on clean scanned / printed text.
  Tier 3 — EXIF / none            No OCR. Extracts PII from EXIF metadata only.
                                  Always available (Pillow only, zero extra deps).

Public API
----------
  EASYOCR_AVAILABLE  : bool
  TESSERACT_AVAILABLE: bool

  OCRWord               — dataclass (text, confidence, x, y, width, height, engine)

  ocr_with_easyocr(image)       -> list[OCRWord]   — never raises
  ocr_with_tesseract(image)     -> list[OCRWord]   — never raises
  extract_exif_text(image)      -> str             — never raises
  merge_ocr_results(easy, tess) -> list[OCRWord]
  run_ocr(image) -> (full_text, words, engine_used) — main entry, never raises
  get_ocr_status() -> dict
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from PIL import Image, ImageFilter

logger = logging.getLogger(__name__)


# ── Engine availability (evaluated once at module-import time) ────────────────
# easyocr loads a ~100 MB model here so the cost is paid once at server
# startup rather than on the first image request.

EASYOCR_AVAILABLE   = False
TESSERACT_AVAILABLE = False

_easyocr_reader = None   # singleton Reader — expensive to construct

try:
    import easyocr as _easyocr_mod           # noqa: F401
    _easyocr_reader = _easyocr_mod.Reader(
        ["en"],
        gpu=False,      # works on any server; promotes to GPU if CUDA present
        verbose=False,  # suppress download progress bars in production logs
    )
    EASYOCR_AVAILABLE = True
except ImportError:
    pass
except Exception as _exc:
    logger.warning("EasyOCR import succeeded but Reader init failed: %s", _exc)

try:
    import pytesseract as _pytesseract_mod   # noqa: F401
    _pytesseract_mod.get_tesseract_version()
    TESSERACT_AVAILABLE = True
except Exception:
    pass

logger.info(
    "OCR engines available: easyocr=%s, tesseract=%s",
    EASYOCR_AVAILABLE,
    TESSERACT_AVAILABLE,
)


# ── Data class ────────────────────────────────────────────────────────────────

@dataclass
class OCRWord:
    text:       str
    confidence: float    # 0.0 – 1.0
    x:          int      # left edge in image coordinate space
    y:          int      # top edge
    width:      int
    height:     int
    engine:     str      # "easyocr", "tesseract", or "pillow"


# ── Engine-specific OCR functions ─────────────────────────────────────────────

def ocr_with_easyocr(image: Image.Image) -> list[OCRWord]:
    """Run EasyOCR on *image*.  Returns empty list on any error."""
    if not EASYOCR_AVAILABLE or _easyocr_reader is None:
        return []
    try:
        import numpy as np   # noqa: PLC0415
        arr = np.array(image)
        # detail=1  → each result is (bbox, text, confidence)
        # paragraph=False → word/phrase level, not merged paragraphs
        raw = _easyocr_reader.readtext(arr, detail=1, paragraph=False)
        words: list[OCRWord] = []
        for bbox, text, conf in raw:
            text = (text or "").strip()
            if not text or conf < 0.3:
                continue
            xs = [float(p[0]) for p in bbox]
            ys = [float(p[1]) for p in bbox]
            left   = int(min(xs))
            top    = int(min(ys))
            width  = max(1, int(max(xs) - left))
            height = max(1, int(max(ys) - top))
            words.append(OCRWord(
                text=text, confidence=float(conf),
                x=left, y=top, width=width, height=height,
                engine="easyocr",
            ))
        return words
    except Exception as exc:
        logger.warning("ocr_with_easyocr error: %s", exc)
        return []


def ocr_with_tesseract(image: Image.Image) -> list[OCRWord]:
    """Run pytesseract on *image*.  Returns empty list on any error."""
    if not TESSERACT_AVAILABLE:
        return []
    try:
        import pytesseract   # noqa: PLC0415
        data = pytesseract.image_to_data(
            image, output_type=pytesseract.Output.DATAFRAME
        )
        words: list[OCRWord] = []
        for _, row in data.iterrows():
            text = str(row.get("text", "") or "").strip()
            if not text:
                continue
            try:
                conf = float(row.get("conf", -1))
            except (ValueError, TypeError):
                conf = -1.0
            if conf <= 30:    # tesseract uses 0–100 scale; ≤30 ≈ noise
                continue
            words.append(OCRWord(
                text=text, confidence=conf / 100.0,
                x=int(row.get("left",   0)), y=int(row.get("top",    0)),
                width=int(row.get("width", 0)), height=int(row.get("height", 0)),
                engine="tesseract",
            ))
        return words
    except Exception as exc:
        logger.warning("ocr_with_tesseract error: %s", exc)
        return []


# ── EXIF metadata extraction ──────────────────────────────────────────────────

def extract_exif_text(image: Image.Image) -> str:
    """Extract EXIF metadata as a flat text string.  Returns '' on any error."""
    try:
        from PIL.ExifTags import TAGS   # noqa: PLC0415

        exif_raw: dict = {}

        # Newer Pillow (≥ 9.x) exposes getexif(); older images use _getexif()
        try:
            exif_obj = image.getexif()
            if exif_obj:
                exif_raw = {TAGS.get(k, str(k)): v for k, v in exif_obj.items()}
        except Exception:
            pass

        if not exif_raw:
            try:
                raw = getattr(image, "_getexif", lambda: None)()
                if raw:
                    exif_raw = {TAGS.get(k, str(k)): v for k, v in raw.items()}
            except Exception:
                pass

        if not exif_raw:
            return ""

        parts: list[str] = []

        # GPS coordinates
        gps_raw = exif_raw.get("GPSInfo")
        if gps_raw and isinstance(gps_raw, dict):
            try:
                from PIL.ExifTags import GPSTAGS   # noqa: PLC0415
                gps = {GPSTAGS.get(k, str(k)): v for k, v in gps_raw.items()}

                def _dms(dms: Any, ref: str) -> float | None:
                    try:
                        d, m, s = (float(x) for x in dms)
                        dd = d + m / 60 + s / 3600
                        return -dd if str(ref).upper() in ("S", "W") else dd
                    except Exception:
                        return None

                lat = _dms(gps.get("GPSLatitude", ()), gps.get("GPSLatitudeRef") or "N")
                lon = _dms(gps.get("GPSLongitude", ()), gps.get("GPSLongitudeRef") or "E")
                if lat is not None and lon is not None:
                    parts.append(f"GPS: {lat:.6f}, {lon:.6f}")
            except Exception:
                pass

        # Text fields that frequently contain PII
        for field_name in (
            "Make", "Model", "DateTime", "DateTimeOriginal",
            "Artist", "Copyright", "ImageDescription",
            "UserComment", "Software",
        ):
            val = exif_raw.get(field_name)
            if val is None:
                continue
            try:
                text_val = (
                    val.decode("utf-8", errors="replace")
                    if isinstance(val, bytes)
                    else str(val)
                ).strip()
                if text_val:
                    parts.append(f"{field_name}: {text_val}")
            except Exception:
                pass

        return "\n".join(parts)

    except Exception as exc:
        logger.debug("extract_exif_text failed: %s", exc)
        return ""


# ── Result merging ────────────────────────────────────────────────────────────

def merge_ocr_results(
    easyocr_words: list[OCRWord],
    tesseract_words: list[OCRWord],
) -> list[OCRWord]:
    """
    Merge EasyOCR and pytesseract results.

    For overlapping bounding boxes (intersection > 50% of the smaller box's
    area) keep whichever word has higher confidence.
    For non-overlapping detections keep all from both engines.
    Returns words sorted in reading order (top → bottom, left → right).
    """
    if not easyocr_words:
        return sorted(tesseract_words, key=lambda w: (w.y, w.x))
    if not tesseract_words:
        return sorted(easyocr_words, key=lambda w: (w.y, w.x))

    def _area(w: OCRWord) -> int:
        return max(1, w.width * w.height)

    def _intersection(a: OCRWord, b: OCRWord) -> int:
        ix0 = max(a.x, b.x)
        iy0 = max(a.y, b.y)
        ix1 = min(a.x + a.width,  b.x + b.width)
        iy1 = min(a.y + a.height, b.y + b.height)
        return max(0, ix1 - ix0) * max(0, iy1 - iy0)

    def _overlaps(a: OCRWord, b: OCRWord) -> bool:
        inter = _intersection(a, b)
        return inter > 0 and (inter / min(_area(a), _area(b))) > 0.5

    # Start from easyocr results; augment or replace with tesseract results
    merged: list[OCRWord] = list(easyocr_words)
    easyocr_snapshot = list(easyocr_words)

    for tw in tesseract_words:
        overlapping = [ew for ew in easyocr_snapshot if _overlaps(ew, tw)]
        if overlapping:
            for ew in overlapping:
                if tw.confidence > ew.confidence:
                    try:
                        merged.remove(ew)
                    except ValueError:
                        pass
                    merged.append(tw)
        else:
            merged.append(tw)

    return sorted(merged, key=lambda w: (w.y, w.x))


# ── Image preprocessing ───────────────────────────────────────────────────────

def _preprocess(image: Image.Image) -> tuple[Image.Image, float, float]:
    """
    Normalise *image* for best OCR accuracy.

    Steps:
      • Convert unusual modes (RGBA, CMYK, palette …) → RGB.
      • Upscale 2× via LANCZOS if either dimension is below 800 px.
      • Apply one ImageFilter.SHARPEN pass.

    Returns
    -------
    (processed_image, scale_x_back, scale_y_back)
        scale_x_back and scale_y_back convert processed-image pixel
        coordinates back to the original image's coordinate space.
        Both equal 1.0 when no resize occurred.
    """
    img = image.copy()
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    orig_w, orig_h = img.size
    if orig_w < 800 or orig_h < 800:
        new_w = orig_w * 2
        new_h = orig_h * 2
        img = img.resize((new_w, new_h), Image.LANCZOS)
        scale_x = orig_w / new_w    # < 1.0 — shrinks coords back to original
        scale_y = orig_h / new_h
    else:
        scale_x = scale_y = 1.0

    img = img.filter(ImageFilter.SHARPEN)
    return img, scale_x, scale_y


# ── Main entry point ──────────────────────────────────────────────────────────

def run_ocr(image: Image.Image) -> tuple[str, list[OCRWord], str]:
    """
    Run OCR on *image* using the best available engine(s).

    Returns
    -------
    (full_text, word_list, engine_used)

    engine_used is one of:
        "easyocr"     — only EasyOCR ran and produced results
        "tesseract"   — only pytesseract ran and produced results
        "both"        — both ran; results are merged
        "pillow_only" — no text was extracted (EXIF only or no engines)
        "failed"      — unexpected error (full_text and word_list are empty)

    IMPORTANT: This function NEVER raises.  Any unhandled exception causes
    the function to return ("", [], "failed").
    """
    try:
        preprocessed, scale_x, scale_y = _preprocess(image)

        words_easy: list[OCRWord] = []
        words_tess: list[OCRWord] = []

        if EASYOCR_AVAILABLE:
            words_easy = ocr_with_easyocr(preprocessed)
        if TESSERACT_AVAILABLE:
            words_tess = ocr_with_tesseract(preprocessed)

        preprocessed.close()

        # ── Scale bounding boxes back to original image coordinate space ──────
        def _scale(words: list[OCRWord]) -> list[OCRWord]:
            if scale_x == 1.0 and scale_y == 1.0:
                return words
            return [
                OCRWord(
                    text=w.text, confidence=w.confidence, engine=w.engine,
                    x=int(w.x * scale_x),             y=int(w.y * scale_y),
                    width=max(1, int(w.width  * scale_x)),
                    height=max(1, int(w.height * scale_y)),
                )
                for w in words
            ]

        words_easy = _scale(words_easy)
        words_tess = _scale(words_tess)

        # ── Select / merge ────────────────────────────────────────────────────
        if EASYOCR_AVAILABLE and TESSERACT_AVAILABLE:
            if words_easy and words_tess:
                words      = merge_ocr_results(words_easy, words_tess)
                engine_used = "both"
            elif words_easy:
                words      = words_easy
                engine_used = "easyocr"
            elif words_tess:
                words      = words_tess
                engine_used = "tesseract"
            else:
                words      = []
                engine_used = "pillow_only"
        elif EASYOCR_AVAILABLE:
            words       = words_easy
            engine_used = "easyocr" if words_easy else "pillow_only"
        elif TESSERACT_AVAILABLE:
            words       = words_tess
            engine_used = "tesseract" if words_tess else "pillow_only"
        else:
            words       = []
            engine_used = "pillow_only"

        # ── EXIF (extracted from the original, not the preprocessed copy) ─────
        exif_text = extract_exif_text(image)

        ocr_text = " ".join(w.text for w in words)
        if exif_text:
            full_text = (ocr_text + "\n---EXIF---\n" + exif_text) if ocr_text else exif_text
        else:
            full_text = ocr_text

        return full_text, words, engine_used

    except Exception as exc:
        logger.error("run_ocr unexpected failure: %s", exc, exc_info=True)
        return "", [], "failed"


def get_ocr_status() -> dict[str, Any]:
    """Return a dict describing which OCR engines are currently available."""
    if EASYOCR_AVAILABLE and TESSERACT_AVAILABLE:
        active = "both"
    elif EASYOCR_AVAILABLE:
        active = "easyocr"
    elif TESSERACT_AVAILABLE:
        active = "tesseract"
    else:
        active = "pillow_only"

    return {
        "easyocr":       EASYOCR_AVAILABLE,
        "tesseract":     TESSERACT_AVAILABLE,
        "pillow":        True,
        "active_engine": active,
    }
