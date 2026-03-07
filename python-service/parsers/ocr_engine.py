"""
Multi-engine OCR abstraction for image PII processing.

Engine priority (auto-detected once at first use):
  1. EasyOCR      — pure-Python deep-learning OCR (pip install easyocr).
                    No external binary required.  GPU-accelerated when
                    available, falls back to CPU.  Handles skewed text,
                    complex backgrounds and varied fonts.
  2. pytesseract  — wraps the system Tesseract binary, if installed.
  3. none         — no OCR engine available; returns empty results so the
                    image is saved unchanged with 0 PII detected.

Public API
----------
  get_ocr_backend_name() -> str
      Returns 'easyocr', 'pytesseract', or 'none'.

  ocr_document(pil_image) -> list[OcrBlock]
      Returns word/phrase-level blocks with bounding boxes in the
      original image coordinate space (accounts for any internal
      preprocessing / upscaling).

  ocr_text(pil_image) -> str
      Convenience wrapper: space-joined full text from ocr_document().
"""

from __future__ import annotations

import logging
from typing import TypedDict

from PIL import Image

logger = logging.getLogger(__name__)


# ── Public types ──────────────────────────────────────────────────────────────

class OcrBlock(TypedDict):
    """A recognized text segment with its axis-aligned bounding box."""
    word: str    # recognized text (may be multi-word phrase from EasyOCR)
    left: int    # x of top-left corner in original image space
    top: int     # y of top-left corner in original image space
    width: int
    height: int


# ── Backend detection (lazy, done once) ───────────────────────────────────────

_BACKEND: str | None = None
_easyocr_reader = None          # singleton reader — expensive to create


def _check_easyocr() -> bool:
    try:
        import easyocr  # noqa: F401
        return True
    except ImportError:
        return False


def _check_pytesseract() -> bool:
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def _detect_backend() -> str:
    if _check_easyocr():
        logger.info("OCR backend: EasyOCR (deep-learning, no binary required)")
        return "easyocr"
    if _check_pytesseract():
        logger.info("OCR backend: pytesseract (Tesseract binary found in PATH)")
        return "pytesseract"
    logger.warning(
        "OCR backend: none — no OCR engine available. "
        "Run `pip install easyocr` to enable image PII analysis."
    )
    return "none"


def get_ocr_backend_name() -> str:
    """Return the name of the active OCR backend ('easyocr', 'pytesseract', or 'none')."""
    global _BACKEND
    if _BACKEND is None:
        _BACKEND = _detect_backend()
    return _BACKEND


def _get_easyocr_reader():
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        # gpu=False → works on any server; easyocr auto-promotes to GPU when
        # CUDA is available if you set gpu=True.  verbose=False suppresses
        # download progress bars in production logs.
        _easyocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        logger.info("EasyOCR reader initialized (CPU, English)")
    return _easyocr_reader


# ── Image preprocessing ───────────────────────────────────────────────────────

_MIN_SHORT_EDGE_PX = 200    # upscale images smaller than this
_SCALE_TARGET_PX   = 1000   # target short-edge size when upscaling


def _preprocess(img: Image.Image) -> tuple[Image.Image, float, float]:
    """
    Normalise *img* for best OCR accuracy.

    Steps:
      • Convert unusual modes (palette, CMYK, RGBA) → RGB so both OCR
        engines receive a consistent format.
      • Upscale images whose short edge is below *_MIN_SHORT_EDGE_PX* so
        character-level detail is preserved during OCR.

    Returns
    -------
    (processed_image, scale_x, scale_y)
        *scale_x* and *scale_y* are the ratios original / processed —
        multiply OCR coordinates by these to convert back to original space.
        When no resizing occurs both values are 1.0 and the returned image
        is the same object as the input.
    """
    # ── Mode normalisation ────────────────────────────────────────────────────
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    orig_w, orig_h = img.size

    # ── Upscale very small images ─────────────────────────────────────────────
    short_edge = min(orig_w, orig_h)
    if short_edge < _MIN_SHORT_EDGE_PX:
        scale = _SCALE_TARGET_PX / short_edge
        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)
        processed = img.resize((new_w, new_h), Image.LANCZOS)
        # scale_x = orig_w / new_w  (< 1.0 — shrink coordinates back down)
        scale_x = orig_w / new_w
        scale_y = orig_h / new_h
        logger.debug(
            "OCR preprocess: upscaled %dx%d → %dx%d (scale=%.2f)",
            orig_w, orig_h, new_w, new_h, scale,
        )
        return processed, scale_x, scale_y

    return img, 1.0, 1.0


# ── Public API ────────────────────────────────────────────────────────────────

def ocr_document(img: Image.Image) -> list[OcrBlock]:
    """
    Extract text blocks with bounding boxes from *img*.

    Coordinates in the returned blocks are always in the **original image
    coordinate space**, regardless of any internal upscaling — so callers
    can draw redaction rectangles directly on the image they passed in.

    If no OCR engine is available an empty list is returned.
    """
    backend = get_ocr_backend_name()
    if backend == "none":
        return []

    processed, scale_x, scale_y = _preprocess(img)
    try:
        if backend == "easyocr":
            raw_blocks = _easyocr_blocks(processed)
        else:
            raw_blocks = _pytesseract_blocks(processed)
    finally:
        if processed is not img:
            processed.close()

    # ── Scale coordinates back to original image space ────────────────────────
    if scale_x == 1.0 and scale_y == 1.0:
        return raw_blocks

    scaled: list[OcrBlock] = []
    for b in raw_blocks:
        scaled.append(OcrBlock(
            word=b["word"],
            left=int(b["left"]   * scale_x),
            top=int(b["top"]    * scale_y),
            width=int(b["width"]  * scale_x),
            height=int(b["height"] * scale_y),
        ))
    return scaled


def ocr_text(img: Image.Image) -> str:
    """Return the full OCR text from *img* (space-joined from all blocks)."""
    return " ".join(b["word"] for b in ocr_document(img))


# ── EasyOCR backend ───────────────────────────────────────────────────────────

def _easyocr_blocks(img: Image.Image) -> list[OcrBlock]:
    """
    Run EasyOCR on *img* and return word/phrase blocks.

    EasyOCR returns (bbox, text, confidence) tuples where bbox is a
    4-point polygon ([[x0,y0],[x1,y1],[x2,y2],[x3,y3]]).  We convert
    each polygon to an axis-aligned bounding rectangle.
    """
    import numpy as np

    reader = _get_easyocr_reader()
    arr = np.array(img)
    # detail=1 → returns (bbox, text, conf); paragraph=False → word-level
    raw = reader.readtext(arr, detail=1, paragraph=False)

    blocks: list[OcrBlock] = []
    for bbox, text, conf in raw:
        text = text.strip()
        if not text or conf < 0.2:
            continue
        xs = [p[0] for p in bbox]
        ys = [p[1] for p in bbox]
        left   = int(min(xs))
        top    = int(min(ys))
        width  = int(max(xs) - left)
        height = int(max(ys) - top)
        blocks.append(OcrBlock(
            word=text,
            left=left,
            top=top,
            width=width,
            height=height,
        ))
    return blocks


# ── pytesseract backend ───────────────────────────────────────────────────────

def _pytesseract_blocks(img: Image.Image) -> list[OcrBlock]:
    """
    Run pytesseract on *img* and return word-level blocks.

    Words with confidence ≤ 0 (typically whitespace / noise tokens) are
    filtered out.
    """
    import pytesseract

    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    blocks: list[OcrBlock] = []
    n = len(data["text"])
    for i in range(n):
        word = data["text"][i].strip()
        if not word:
            continue
        try:
            conf = int(data["conf"][i])
        except (ValueError, TypeError):
            conf = 0
        if conf <= 0:
            continue
        blocks.append(OcrBlock(
            word=word,
            left=data["left"][i],
            top=data["top"][i],
            width=data["width"][i],
            height=data["height"][i],
        ))
    return blocks
