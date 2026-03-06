"""
Image file chunker and merger for PNG / JPG using Pillow.

Splits an image into a regular grid of tiles, each saved as a lossless PNG
for the OCR + redaction pass.  Every tile carries a 50-pixel overlap on each
side so text that straddles a tile boundary is still fully readable by the
OCR engine.  After processing, only the core (non-overlap) region of each
tile is pasted back onto a blank canvas of the original dimensions.
"""

from __future__ import annotations

import logging
import os
import uuid
import tempfile
from pathlib import Path
from typing import List

from PIL import Image  # type: ignore[import]

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)

OVERLAP_PX = 50  # pixels added on each side of every tile for OCR context


def _get_file_id(file_path: str) -> str:
    stem = Path(file_path).stem.replace("-", "").replace("_", "")
    if len(stem) >= 32 and all(c in "0123456789abcdefABCDEF" for c in stem[:32]):
        return stem[:32]
    return uuid.uuid4().hex


class ImageChunker:
    """Splits large images into grid tiles and reassembles them after processing."""

    # ------------------------------------------------------------------
    # split
    # ------------------------------------------------------------------

    def split(self, file_path: str, file_type: str) -> List[ChunkMetadata]:
        """
        Slice *file_path* into a ``grid_rows × grid_cols`` grid, saving
        each tile (plus a 50-px overlap border) as a lossless PNG.

        Parameters
        ----------
        file_path:
            Source image path.
        file_type:
            Extension without dot (e.g. "png", "jpg", "jpeg") — used to
            look up the grid config.

        Returns
        -------
        list[ChunkMetadata]
            One entry per tile, row-major order, temp PNGs already written.
        """
        config = get_chunk_config(file_type)
        grid_rows: int = config["grid_rows"]
        grid_cols: int = config["grid_cols"]

        img = Image.open(file_path)
        original_width, original_height = img.size
        original_mode = img.mode

        # Ensure consistent colour mode for all tiles
        if original_mode not in ("RGB", "RGBA", "L"):
            img = img.convert("RGB")
            original_mode = "RGB"

        tile_width = original_width // grid_cols
        tile_height = original_height // grid_rows

        # Guard against degenerate dimensions
        if tile_width == 0 or tile_height == 0:
            logger.warning(
                "ImageChunker.split: image too small for %dx%d grid (%dx%d px) — "
                "treating as single chunk  (file=%s)",
                grid_rows,
                grid_cols,
                original_width,
                original_height,
                file_path,
            )
            grid_rows = grid_cols = 1
            tile_width = original_width
            tile_height = original_height

        total_chunks = grid_rows * grid_cols
        file_id = _get_file_id(file_path)
        tmp_dir = Path(tempfile.gettempdir())
        chunk_list: List[ChunkMetadata] = []
        chunk_idx = 0

        for row in range(grid_rows):
            for col in range(grid_cols):

                # ── Core tile boundaries ──────────────────────────────────
                left = col * tile_width
                upper = row * tile_height
                right = original_width if col == grid_cols - 1 else left + tile_width
                lower = original_height if row == grid_rows - 1 else upper + tile_height

                # ── Expanded crop with overlap for OCR context ────────────
                crop_left = max(0, left - OVERLAP_PX)
                crop_upper = max(0, upper - OVERLAP_PX)
                crop_right = min(original_width, right + OVERLAP_PX)
                crop_lower = min(original_height, lower + OVERLAP_PX)

                tile = img.crop((crop_left, crop_upper, crop_right, crop_lower))

                temp_input_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}.png")
                temp_output_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}_out.png")

                tile.save(temp_input_path, format="PNG")

                chunk_list.append(
                    ChunkMetadata(
                        chunk_index=chunk_idx,
                        total_chunks=total_chunks,
                        file_type=file_type,
                        # Encode (row, col) as a single integer for ordering
                        start_boundary=row * grid_cols + col,
                        end_boundary=row * grid_cols + col + 1,
                        overlap_before=0,
                        overlap_after=0,
                        temp_input_path=temp_input_path,
                        temp_output_path=temp_output_path,
                        extra_info={
                            "grid_row": row,
                            "grid_col": col,
                            "original_left": left,
                            "original_upper": upper,
                            "original_right": right,
                            "original_lower": lower,
                            "crop_left": crop_left,
                            "crop_upper": crop_upper,
                            "crop_right": crop_right,
                            "crop_lower": crop_lower,
                            "overlap_px": OVERLAP_PX,
                            "original_mode": original_mode,
                        },
                    )
                )
                chunk_idx += 1

        img.close()

        logger.info(
            "ImageChunker.split: %dx%d grid → %d tiles  (file=%s)",
            grid_rows,
            grid_cols,
            total_chunks,
            file_path,
        )
        return chunk_list

    # ------------------------------------------------------------------
    # merge
    # ------------------------------------------------------------------

    def merge(
        self,
        chunk_results: List[ChunkResult],
        chunk_output_paths: List[str],
        chunk_metadata_list: List[ChunkMetadata],
        output_path: str,
        original_file_path: str,
        file_type: str,
    ) -> None:
        """
        Reassemble processed tile images onto a canvas matching the original
        image dimensions.

        For each tile only the *core* region (minus the overlap border) is
        pasted, so the overlap pixels from adjacent tiles never overwrite
        each other.

        Parameters
        ----------
        chunk_results:
            One ChunkResult per tile (used for ordering).
        chunk_output_paths:
            Matching processed output paths, same order as *chunk_results*.
        chunk_metadata_list:
            Metadata list (provides ``extra_info`` for each tile).
        output_path:
            Destination path for the merged image.
        original_file_path:
            Source image — used to read dimensions and mode.
        file_type:
            Extension without dot, determines output format.
        """
        original = Image.open(original_file_path)
        width, height = original.size
        mode = original.mode
        if mode not in ("RGB", "RGBA", "L"):
            mode = "RGB"
        original.close()

        output_img = Image.new(mode, (width, height))

        # Sort by chunk_index so tiles are pasted in row-major order
        ordered = sorted(
            zip(chunk_results, chunk_output_paths, chunk_metadata_list),
            key=lambda t: t[0].chunk_index,
        )

        for result, out_path, meta in ordered:
            info = meta.extra_info
            try:
                tile_img = Image.open(out_path)
            except OSError as exc:
                logger.warning(
                    "ImageChunker.merge: cannot open tile %d (%s): %s",
                    result.chunk_index,
                    out_path,
                    exc,
                )
                continue

            # Ensure mode matches canvas
            if tile_img.mode != mode:
                tile_img = tile_img.convert(mode)

            # ── Compute core region inside the (possibly overlapped) tile ──
            core_left = info["original_left"] - info["crop_left"]
            core_upper = info["original_upper"] - info["crop_upper"]
            core_right = core_left + (info["original_right"] - info["original_left"])
            core_lower = core_upper + (info["original_lower"] - info["original_upper"])

            core_tile = tile_img.crop((core_left, core_upper, core_right, core_lower))
            tile_img.close()

            output_img.paste(core_tile, (info["original_left"], info["original_upper"]))

        # ── Save ──────────────────────────────────────────────────────────
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        if file_type.lower() in ("jpg", "jpeg"):
            # JPEG does not support alpha; convert if necessary
            save_img = output_img.convert("RGB") if output_img.mode == "RGBA" else output_img
            save_img.save(output_path, format="JPEG", quality=95)
        else:
            output_img.save(output_path, format="PNG")

        output_img.close()

        # ── Verify dimensions ─────────────────────────────────────────────
        try:
            check = Image.open(output_path)
            out_w, out_h = check.size
            check.close()
            if (out_w, out_h) != (width, height):
                logger.warning(
                    "ImageChunker.merge: dimension mismatch — "
                    "original=%dx%d, output=%dx%d  (file=%s)",
                    width,
                    height,
                    out_w,
                    out_h,
                    output_path,
                )
            else:
                logger.info(
                    "Image merged: %dx%d preserved  (file=%s)",
                    out_w,
                    out_h,
                    output_path,
                )
        except OSError:
            pass

    # ------------------------------------------------------------------
    # cleanup
    # ------------------------------------------------------------------

    def cleanup(self, chunk_metadata_list: List[ChunkMetadata]) -> None:
        """Delete all temporary tile files created by :meth:`split`."""
        for meta in chunk_metadata_list:
            for path in (meta.temp_input_path, meta.temp_output_path):
                try:
                    os.remove(path)
                except OSError:
                    pass


# ── Module-level chunked processing function ─────────────────────────────────

DEFAULT_TILE_GRID = (4, 4)  # rows × cols


def _noop_progress(tile_idx: int, status: str) -> None:  # noqa: ARG001
    pass


def process_image_chunked(
    input_path: str,
    output_path: str,
    mode: str = "redact",
    config: dict | None = None,
    progress_cb=_noop_progress,
) -> dict:
    """
    End-to-end image PII processing with OCR + regex only (Rule D).

    1. Open image, split into 4×4 grid of tiles (50 px overlap).
    2. OCR each tile in parallel via pytesseract.image_to_data().
    3. Run regex-only detection on the OCR text per tile.
    4. Draw black rectangles over detected PII bounding boxes.
    5. Composite core regions back onto a canvas and save.
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed

    import pytesseract  # type: ignore[import]
    from PIL import ImageDraw  # type: ignore[import]

    from pipeline.detector import detect_pii_single

    if config is None:
        config = {"use_regex": True, "use_spacy": False, "use_bert": False,
                  "spacy_model": None, "chunk_size": 16, "workers": 8}

    # Safety override – images always use regex only
    config = {**config, "use_spacy": False, "use_bert": False}
    workers = config.get("workers", 8)

    grid_rows, grid_cols = DEFAULT_TILE_GRID

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    img = Image.open(input_path)
    orig_w, orig_h = img.size
    orig_mode = img.mode
    if orig_mode not in ("RGB", "RGBA", "L"):
        img = img.convert("RGB")
        orig_mode = "RGB"

    tile_w = orig_w // grid_cols
    tile_h = orig_h // grid_rows

    if tile_w == 0 or tile_h == 0:
        grid_rows = grid_cols = 1
        tile_w = orig_w
        tile_h = orig_h

    total_tiles = grid_rows * grid_cols
    for i in range(total_tiles):
        progress_cb(i, "pending")

    # ── Build tile info ──────────────────────────────────────────────────
    tiles: list[dict] = []
    for row in range(grid_rows):
        for col in range(grid_cols):
            left = col * tile_w
            upper = row * tile_h
            right = orig_w if col == grid_cols - 1 else left + tile_w
            lower = orig_h if row == grid_rows - 1 else upper + tile_h

            crop_left = max(0, left - OVERLAP_PX)
            crop_upper = max(0, upper - OVERLAP_PX)
            crop_right = min(orig_w, right + OVERLAP_PX)
            crop_lower = min(orig_h, lower + OVERLAP_PX)

            tile_img = img.crop((crop_left, crop_upper, crop_right, crop_lower))
            tiles.append({
                "idx": row * grid_cols + col,
                "tile_img": tile_img,
                "core_left": left,
                "core_upper": upper,
                "core_right": right,
                "core_lower": lower,
                "crop_left": crop_left,
                "crop_upper": crop_upper,
            })

    img.close()

    # ── Parallel OCR + detection + redaction per tile ────────────────────
    lock = threading.Lock()
    all_detections: list[dict] = []
    processed_tiles: dict[int, Image.Image] = {}

    def _process_tile(tile_info: dict):
        idx = tile_info["idx"]
        tile_img = tile_info["tile_img"]
        progress_cb(idx, "processing")

        try:
            # OCR with bounding-box data
            ocr_data = pytesseract.image_to_data(
                tile_img, output_type=pytesseract.Output.DICT
            )

            # Build full text for detection
            words = ocr_data.get("text", [])
            full_text = " ".join(w for w in words if w.strip())

            dets = detect_pii_single(full_text, config) if full_text else []

            # Draw black rectangles over detected PII
            if dets:
                draw = ImageDraw.Draw(tile_img)
                detected_values = {d["value"] for d in dets if d.get("value")}

                n_words = len(words)
                lefts = ocr_data.get("left", [])
                tops = ocr_data.get("top", [])
                widths = ocr_data.get("width", [])
                heights = ocr_data.get("height", [])
                confs = ocr_data.get("conf", [])

                for i in range(n_words):
                    word = words[i].strip()
                    if not word:
                        continue
                    # Check if this word appears in any detected PII value
                    for val in detected_values:
                        if word in val or val in word:
                            try:
                                conf = int(confs[i])
                            except (ValueError, TypeError):
                                conf = 0
                            if conf > 0:
                                x = lefts[i]
                                y = tops[i]
                                w = widths[i]
                                h = heights[i]
                                draw.rectangle(
                                    [x, y, x + w, y + h],
                                    fill="black",
                                )
                            break

            progress_cb(idx, "done")
            return idx, tile_img, dets
        except Exception:
            progress_cb(idx, "failed")
            raise

    with ThreadPoolExecutor(max_workers=min(workers, total_tiles)) as executor:
        futures = {
            executor.submit(_process_tile, t): t["idx"] for t in tiles
        }
        for future in as_completed(futures):
            idx, redacted_tile, dets = future.result()
            with lock:
                processed_tiles[idx] = redacted_tile
                all_detections.extend(dets)

    # ── Composite core regions onto output canvas ────────────────────────
    output_img = Image.new(orig_mode, (orig_w, orig_h))

    for tile_info in tiles:
        idx = tile_info["idx"]
        tile_img = processed_tiles[idx]

        core_offset_x = tile_info["core_left"] - tile_info["crop_left"]
        core_offset_y = tile_info["core_upper"] - tile_info["crop_upper"]
        core_w = tile_info["core_right"] - tile_info["core_left"]
        core_h = tile_info["core_lower"] - tile_info["core_upper"]

        core = tile_img.crop((
            core_offset_x, core_offset_y,
            core_offset_x + core_w, core_offset_y + core_h,
        ))
        output_img.paste(core, (tile_info["core_left"], tile_info["core_upper"]))
        tile_img.close()

    # ── Save ─────────────────────────────────────────────────────────────
    ext = Path(output_path).suffix.lower()
    if ext in (".jpg", ".jpeg"):
        save_img = output_img.convert("RGB") if output_img.mode == "RGBA" else output_img
        save_img.save(output_path, format="JPEG", quality=95)
    else:
        output_img.save(output_path, format="PNG")
    output_img.close()

    return _build_image_summary(all_detections, total_tiles)


def _build_image_summary(detections: list[dict], tile_count: int) -> dict:
    pii_summary: dict[str, int] = {}
    layer_breakdown: dict[str, int] = {"regex": 0, "spacy": 0, "bert": 0}
    high = medium = 0

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
        "tile_count":           tile_count,
    }
