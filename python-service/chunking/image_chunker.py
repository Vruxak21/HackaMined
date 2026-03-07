"""
Image PII processor — tiered OCR with graceful fallback.

Automatically selects the best available OCR backend via pipeline.ocr_engine:
  Tier 1 — EasyOCR   (deep-learning, no system binary required, pip install only)
  Tier 2 — pytesseract (fast for clean text, requires tesseract binary on PATH)
  Tier 3 — EXIF-only  (Pillow, always available, zero extra dependencies)

Processing flow
---------------
  1. Open the image and convert to RGB.
  2. For small images (< 400 px either dimension): single-pass OCR.
     For larger images: split into a 4×4 tile grid with 50-px overlap.
  3. Each tile: run_ocr() → detect_pii_single() (regex only, Rule D).
  4. Draw filled black rectangles over every matched PII bounding box.
  5. Composite processed tiles onto the original canvas dimension.
  6. Save to output_path preserving the original file format.

Exported public API
-------------------
  process_image(file_path, output_path, config, progress_callback) -> dict
  process_image_chunked(...)  — compatibility alias used by orchestrator.py
"""

from __future__ import annotations

import logging
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from PIL import Image, ImageDraw

from pipeline.ocr_engine import OCRWord, run_ocr, get_ocr_status
from pipeline.detector import detect_pii_single

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

GRID_ROWS             = 4
GRID_COLS             = 4
TILE_OVERLAP_PX       = 50
MAX_WORKERS           = 8
SMALL_IMAGE_THRESHOLD = 400   # px — process as single tile when smaller


# ── Data class ────────────────────────────────────────────────────────────────

@dataclass
class TileResult:
    tile_index:     int
    x_offset:       int                    # crop_left: tile's top-left x in full-image space
    y_offset:       int                    # crop_top:  tile's top-left y in full-image space
    tile_width:     int
    tile_height:    int
    ocr_text:       str                    = ""
    ocr_words:      list[OCRWord]          = field(default_factory=list)
    pii_detections: list[dict[str, Any]]  = field(default_factory=list)
    engine_used:    str                    = "pillow_only"
    exif_pii_count: int                    = 0
    success:        bool                   = True
    error:          str                    = ""


# ── Tile splitting ────────────────────────────────────────────────────────────

def split_into_tiles(image: Image.Image) -> list[dict]:
    """
    Split *image* into a GRID_ROWS × GRID_COLS grid, each tile extended by
    TILE_OVERLAP_PX on every side for OCR context at tile boundaries.

    Returns a list of dicts — one per tile — with keys:
        index, row, col,
        x_start (crop left),  y_start (crop top),
        x_end   (crop right), y_end   (crop bottom),
        core_left, core_top, core_right, core_bottom,
        image   (PIL.Image crop)
    """
    w, h = image.size
    tile_w = w // GRID_COLS
    tile_h = h // GRID_ROWS

    if tile_w == 0 or tile_h == 0:
        # Image smaller than the grid — treat as a single tile
        return [{
            "index": 0, "row": 0, "col": 0,
            "x_start": 0, "y_start": 0, "x_end": w, "y_end": h,
            "core_left": 0, "core_top": 0, "core_right": w, "core_bottom": h,
            "image": image.copy(),
        }]

    tiles: list[dict] = []
    idx = 0
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            core_left   = col * tile_w
            core_top    = row * tile_h
            core_right  = w if col == GRID_COLS - 1 else (col + 1) * tile_w
            core_bottom = h if row == GRID_ROWS - 1 else (row + 1) * tile_h

            x_start = max(0, core_left   - TILE_OVERLAP_PX)
            y_start = max(0, core_top    - TILE_OVERLAP_PX)
            x_end   = min(w, core_right  + TILE_OVERLAP_PX)
            y_end   = min(h, core_bottom + TILE_OVERLAP_PX)

            tiles.append({
                "index":       idx,
                "row":         row,
                "col":         col,
                "x_start":     x_start,
                "y_start":     y_start,
                "x_end":       x_end,
                "y_end":       y_end,
                "core_left":   core_left,
                "core_top":    core_top,
                "core_right":  core_right,
                "core_bottom": core_bottom,
                "image":       image.crop((x_start, y_start, x_end, y_end)),
            })
            idx += 1

    return tiles


# ── Tile processing ───────────────────────────────────────────────────────────

def process_tile(tile_dict: dict, config: dict) -> TileResult:
    """Run OCR + PII detection on one tile.  Never raises — errors go into TileResult."""
    idx      = tile_dict["index"]
    x_start  = tile_dict["x_start"]
    y_start  = tile_dict["y_start"]
    tile_img = tile_dict["image"]

    try:
        ocr_text, ocr_words, engine_used = run_ocr(tile_img)

        pii_detections: list[dict] = []
        if ocr_text:
            pii_detections = detect_pii_single(ocr_text, config)

        # Count detections that came from the EXIF section of the text
        exif_sep = "\n---EXIF---\n"
        exif_pii = 0
        if exif_sep in ocr_text:
            _, exif_section = ocr_text.split(exif_sep, 1)
            exif_pii = sum(
                1 for d in pii_detections
                if d.get("value") and d["value"] in exif_section
            )

        return TileResult(
            tile_index=idx,
            x_offset=x_start,
            y_offset=y_start,
            tile_width=tile_img.width,
            tile_height=tile_img.height,
            ocr_text=ocr_text,
            ocr_words=ocr_words,
            pii_detections=pii_detections,
            engine_used=engine_used,
            exif_pii_count=exif_pii,
            success=True,
        )

    except Exception as exc:
        logger.warning("process_tile %d failed: %s", idx, exc)
        return TileResult(
            tile_index=idx,
            x_offset=x_start,
            y_offset=y_start,
            tile_width=getattr(tile_img, "width", 0),
            tile_height=getattr(tile_img, "height", 0),
            success=False,
            error=str(exc),
        )


# ── Bounding-box lookup ───────────────────────────────────────────────────────

def find_word_bbox_in_image(
    word_text: str,
    ocr_words: list[OCRWord],
    tile_x_offset: int,
    tile_y_offset: int,
) -> list[tuple[int, int, int, int]]:
    """
    Return full-image (x0, y0, x1, y1) bounding boxes for *word_text*.

    Searches *ocr_words* for blocks where the block text is a substring of
    *word_text* or vice versa (case-insensitive).  Coords are converted from
    tile space → full-image space by adding the tile crop offsets.
    """
    bboxes: list[tuple[int, int, int, int]] = []
    needle = word_text.lower()
    for w in ocr_words:
        haystack = w.text.lower()
        if not haystack:
            continue
        if haystack in needle or needle in haystack:
            fx = w.x + tile_x_offset
            fy = w.y + tile_y_offset
            bboxes.append((fx, fy, fx + w.width, fy + w.height))
    return bboxes


# ── Image masking ─────────────────────────────────────────────────────────────

def apply_masking_to_image(
    original_image: Image.Image,
    tile_results: list[TileResult],
    mask_color: tuple[int, int, int] = (0, 0, 0),
) -> Image.Image:
    """
    Draw filled rectangles over every detected PII region.

    Returns a copy of *original_image* with PII bounding boxes blacked-out.
    Returns *original_image* unchanged when no PII was detected.
    """
    has_pii = any(t.pii_detections for t in tile_results)
    if not has_pii:
        return original_image

    masked = original_image.copy()
    draw   = ImageDraw.Draw(masked)

    for tile in tile_results:
        if not tile.pii_detections or not tile.success:
            continue
        for det in tile.pii_detections:
            pii_value = det.get("value", "")
            if not pii_value:
                continue
            bboxes = find_word_bbox_in_image(
                pii_value,
                tile.ocr_words,
                tile.x_offset,
                tile.y_offset,
            )
            for x0, y0, x1, y1 in bboxes:
                draw.rectangle([x0, y0, x1, y1], fill=mask_color)

    return masked


# ── Main entry point ──────────────────────────────────────────────────────────

def process_image(
    file_path: str,
    output_path: str,
    config: dict | None = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> dict[str, Any]:
    """
    Detect and redact PII from a PNG / JPG / JPEG image.

    Parameters
    ----------
    file_path:
        Absolute path to the source image.
    output_path:
        Where the redacted image should be written.
    config:
        Pipeline config dict (use_regex, use_spacy, use_bert, workers …).
        Images always force use_spacy=False and use_bert=False (Rule D —
        NLP models are unreliable on noisy OCR output).
    progress_callback:
        Optional callable(done: int, total: int) called after each tile.

    Returns
    -------
    dict with keys:
        success, total_pii_found, pii_by_type, tiles_processed, tiles_failed,
        ocr_engine_used, image_size, exif_pii_found.
        Also includes orchestrator-compatible aliases:
        pii_summary, total_pii, layer_breakdown, confidence_breakdown.

    Only returns success=False when the file cannot be opened at all.
    Tile failures are tolerated — partial results are better than a total failure.
    """
    # ── Defaults ─────────────────────────────────────────────────────────────
    if config is None:
        config = {}
    config = {**config, "use_spacy": False, "use_bert": False, "use_regex": True}

    # ── Step 1: Load image ────────────────────────────────────────────────────
    try:
        image = Image.open(file_path)
        image.load()          # force decode so corrupt files fail here, not later
        image = image.convert("RGB")
    except Exception as exc:
        logger.error("process_image: cannot open %s: %s", file_path, exc)
        return {
            "success": False,
            "error": f"Cannot open image: {exc}",
            "total_pii_found": 0,
            # orchestrator-compatible aliases
            "pii_summary": {}, "total_pii": 0,
            "layer_breakdown": {}, "confidence_breakdown": {},
        }

    orig_w, orig_h = image.size
    ocr_info = get_ocr_status()
    logger.info(
        "process_image: %dx%d  file=%s  ocr_engine=%s",
        orig_w, orig_h, file_path, ocr_info["active_engine"],
    )

    # ── Step 2: Tile or single-pass ───────────────────────────────────────────
    if orig_w < SMALL_IMAGE_THRESHOLD or orig_h < SMALL_IMAGE_THRESHOLD:
        logger.debug("process_image: small image (%dx%d) → single-pass", orig_w, orig_h)
        tiles = [{
            "index": 0, "row": 0, "col": 0,
            "x_start": 0, "y_start": 0, "x_end": orig_w, "y_end": orig_h,
            "core_left": 0, "core_top": 0, "core_right": orig_w, "core_bottom": orig_h,
            "image": image.copy(),
        }]
    else:
        tiles = split_into_tiles(image)

    total_tiles = len(tiles)
    tile_results: list[TileResult] = []
    lock = threading.Lock()
    completed_count = 0

    # ── Step 3: Parallel tile processing ─────────────────────────────────────
    workers = min(MAX_WORKERS, total_tiles)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(process_tile, t, config): t for t in tiles}
        for future in as_completed(futures):
            result = future.result()   # process_tile never raises
            with lock:
                tile_results.append(result)
                completed_count = len(tile_results)
            if progress_callback:
                progress_callback(completed_count, total_tiles)

    tile_results.sort(key=lambda r: r.tile_index)

    # ── Step 4: Masking ───────────────────────────────────────────────────────
    masked_image = apply_masking_to_image(image, tile_results)
    image.close()

    # ── Step 5: Save output ───────────────────────────────────────────────────
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    ext = Path(output_path).suffix.lower()
    if ext in (".jpg", ".jpeg"):
        save_img = masked_image.convert("RGB") if masked_image.mode == "RGBA" else masked_image
        save_img.save(output_path, format="JPEG", quality=95)
    else:
        masked_image.save(output_path, format="PNG", optimize=True)
    masked_image.close()

    # ── Step 6: Aggregate results ─────────────────────────────────────────────
    tiles_failed = sum(1 for r in tile_results if not r.success)

    # Deduplicate by (entity_type, value) — overlapping tiles may double-count
    seen: set[tuple[str, str]] = set()
    unique_dets: list[dict] = []
    for tr in tile_results:
        for det in tr.pii_detections:
            key = (det.get("entity_type", ""), det.get("value", ""))
            if key not in seen:
                seen.add(key)
                unique_dets.append(det)

    pii_by_type: dict[str, int] = {}
    for det in unique_dets:
        et = det.get("entity_type", "UNKNOWN")
        pii_by_type[et] = pii_by_type.get(et, 0) + 1

    exif_pii_found = sum(r.exif_pii_count for r in tile_results)

    engine_counts = Counter(r.engine_used for r in tile_results if r.success)
    dominant_engine = engine_counts.most_common(1)[0][0] if engine_counts else "pillow_only"

    # Only consider it a failure if ALL tiles failed AND no EXIF text was found
    all_failed     = tiles_failed == total_tiles and total_tiles > 0
    exif_extracted = any("\n---EXIF---\n" in (r.ocr_text or "") for r in tile_results)
    job_success    = not (all_failed and not exif_extracted)

    return {
        "success":          job_success,
        "total_pii_found":  len(unique_dets),
        "pii_by_type":      pii_by_type,
        "tiles_processed":  total_tiles,
        "tiles_failed":     tiles_failed,
        "ocr_engine_used":  dominant_engine,
        "image_size":       [orig_w, orig_h],
        "exif_pii_found":   exif_pii_found,
        # ── Orchestrator-compatible aliases ───────────────────────────────────
        "pii_summary":          pii_by_type,
        "total_pii":            len(unique_dets),
        "layer_breakdown":      {"regex": len(unique_dets), "spacy": 0, "bert": 0},
        "confidence_breakdown": {"high": 0, "medium": 0},
    }

# ── Compatibility shim ────────────────────────────────────────────────────────
# process_image_chunked is still referenced by orchestrator._get_chunked_funcs.
# It adapts the old (input_path, output_path, mode, config, progress_cb)
# signature into the new process_image API.

def _noop_progress_cb(tile_idx: int, status: str) -> None:  # noqa: ARG001
    pass


def process_image_chunked(
    input_path: str,
    output_path: str,
    mode: str = "redact",               # noqa: ARG001 — images use visual redaction
    config: dict | None = None,
    progress_cb: Callable[[int, str], None] | None = None,
) -> dict[str, Any]:
    """
    Compatibility wrapper so orchestrator._get_chunked_funcs() continues to work.

    Translates the old progress_cb(tile_idx, status_str) convention into the
    new progress_callback(done_count, total_count) convention used by
    process_image, then delegates entirely to process_image.
    """
    def _adapted_cb(done: int, total: int) -> None:
        if progress_cb and total > 0:
            for i in range(total):
                progress_cb(i, "done" if i < done else "pending")

    return process_image(
        file_path=input_path,
        output_path=output_path,
        config=config,
        progress_callback=_adapted_cb if progress_cb else None,
    )

