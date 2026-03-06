"""
JSON file chunker and merger.

Handles three root structures:

  "array"        — root is a JSON array; each chunk is a sub-array.
  "object_array" — root is a JSON object whose first list-valued key is
                   the data array; each chunk wraps the sub-array under
                   that key (all other top-level keys are preserved in
                   the merged output).
  "flat_object"  — root is a JSON object with no list values; it is
                   split by top-level key groups.

chunk_type is stored on the instance after split() and must be passed
explicitly to merge() (the merge signature already carries it).
"""

from __future__ import annotations

import json
import logging
import math
import os
import uuid
import tempfile
from pathlib import Path
from typing import Any, List, Optional, Tuple

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)

DEFAULT_CHUNK_SIZE = 1_500  # top-level items per chunk


def _get_file_id(file_path: str) -> str:
    stem = Path(file_path).stem.replace("-", "").replace("_", "")
    if len(stem) >= 32 and all(c in "0123456789abcdefABCDEF" for c in stem[:32]):
        return stem[:32]
    return uuid.uuid4().hex


def _detect_structure(
    data: Any, items_per_chunk: int
) -> Tuple[str, Optional[str], List[Any]]:
    """
    Inspect *data* and return (chunk_type, array_key, items).

    chunk_type  — "array" | "object_array" | "flat_object"
    array_key   — the dict key that holds the main list (object_array only)
    items       — the flat list of items to chunk
    """
    if isinstance(data, list):
        return "array", None, data

    if isinstance(data, dict):
        # Look for the first key whose value is a list
        for key, value in data.items():
            if isinstance(value, list):
                return "object_array", key, value

        # No list value found — split by key-value pairs
        return "flat_object", None, list(data.items())

    # Scalar or other — treat as single-chunk flat_object
    return "flat_object", None, [("__root__", data)]


class JSONChunker:
    """Splits large JSON files into structurally valid chunks."""

    def __init__(self) -> None:
        self.chunk_type: Optional[str] = None
        self.array_key: Optional[str] = None

    # ------------------------------------------------------------------
    # split
    # ------------------------------------------------------------------

    def split(self, file_path: str, chunk_size: int | None = None) -> List[ChunkMetadata]:
        """
        Parse *file_path*, detect its root structure, and write one temp
        .json file per chunk.

        Parameters
        ----------
        chunk_size:
            Items per chunk. Falls back to DEFAULT_CHUNK_SIZE if None.
        """
        items_per_chunk: int = chunk_size or DEFAULT_CHUNK_SIZE

        with open(file_path, "r", encoding="utf-8") as fh:
            data = json.load(fh)

        chunk_type, array_key, items = _detect_structure(data, items_per_chunk)
        self.chunk_type = chunk_type
        self.array_key = array_key

        total_items = len(items)
        if total_items == 0:
            logger.warning("JSONChunker.split: no items found in %s", file_path)
            return []

        total_chunks = math.ceil(total_items / items_per_chunk)
        file_id = _get_file_id(file_path)
        tmp_dir = Path(tempfile.gettempdir())
        chunk_list: List[ChunkMetadata] = []

        for chunk_idx in range(total_chunks):
            start_idx = chunk_idx * items_per_chunk
            end_idx = min(start_idx + items_per_chunk, total_items)
            items_group = items[start_idx:end_idx]

            temp_input_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}.json")
            temp_output_path = str(tmp_dir / f"chunk_{file_id}_{chunk_idx}_out.json")

            # ── Build chunk payload based on detected structure ───────────
            if chunk_type == "array":
                chunk_data = items_group

            elif chunk_type == "object_array":
                chunk_data = {array_key: items_group}

            else:  # flat_object
                chunk_data = dict(items_group)  # type: ignore[arg-type]

            Path(temp_input_path).write_text(
                json.dumps(chunk_data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            chunk_list.append(
                ChunkMetadata(
                    chunk_index=chunk_idx,
                    total_chunks=total_chunks,
                    file_type="json",
                    start_boundary=start_idx,
                    end_boundary=end_idx,
                    overlap_before=0,   # JSON items are self-contained
                    overlap_after=0,
                    temp_input_path=temp_input_path,
                    temp_output_path=temp_output_path,
                )
            )

        logger.info(
            "JSONChunker.split: %d items (%s) → %d chunks  (file=%s)",
            total_items,
            chunk_type,
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
        output_path: str,
        original_file_path: str,
        chunk_type: str,
        array_key: Optional[str] = None,
    ) -> None:
        """
        Reassemble processed chunk output files into a single JSON file
        at *output_path*.

        Parameters
        ----------
        chunk_type:
            One of "array", "object_array", or "flat_object"
            (returned by :meth:`split` via ``self.chunk_type``).
        array_key:
            The dict key that holds the main array (required when
            *chunk_type* is "object_array").
        """
        ordered = sorted(
            zip(chunk_results, chunk_output_paths),
            key=lambda pair: pair[0].chunk_index,
        )

        # ── Parse each chunk output ───────────────────────────────────────
        chunk_payloads: List[Any] = []
        for result, out_path in ordered:
            try:
                with open(out_path, "r", encoding="utf-8") as fh:
                    chunk_payloads.append(json.load(fh))
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning(
                    "JSONChunker.merge: could not read chunk %d output (%s): %s",
                    result.chunk_index,
                    out_path,
                    exc,
                )

        # ── Reconstruct merged data ───────────────────────────────────────
        if chunk_type == "array":
            merged: Any = []
            for payload in chunk_payloads:
                if isinstance(payload, list):
                    merged.extend(payload)
                else:
                    merged.append(payload)

        elif chunk_type == "object_array":
            if array_key is None:
                raise ValueError("array_key is required for chunk_type='object_array'")
            merged_items: List[Any] = []
            for payload in chunk_payloads:
                if isinstance(payload, dict) and array_key in payload:
                    merged_items.extend(payload[array_key])
            # Re-read original to recover all non-array wrapper keys
            with open(original_file_path, "r", encoding="utf-8") as fh:
                original_data = json.load(fh)
            wrapper = {k: v for k, v in original_data.items() if k != array_key}
            merged = {**wrapper, array_key: merged_items}

        else:  # flat_object
            merged = {}
            for payload in chunk_payloads:
                if isinstance(payload, dict):
                    merged.update(payload)

        # ── Write output ──────────────────────────────────────────────────
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        Path(output_path).write_text(
            json.dumps(merged, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

        # ── Integrity check: parse output + count items ───────────────────
        try:
            with open(output_path, "r", encoding="utf-8") as fh:
                parsed_output = json.load(fh)
            logger.info("JSONChunker.merge: output is valid JSON  (file=%s)", output_path)

            # Count items in original vs output for same structure type
            with open(original_file_path, "r", encoding="utf-8") as fh:
                original_data = json.load(fh)

            def _item_count(obj: Any) -> int:
                if isinstance(obj, list):
                    return len(obj)
                if isinstance(obj, dict):
                    for v in obj.values():
                        if isinstance(v, list):
                            return len(v)
                    return len(obj)
                return 1

            orig_count = _item_count(original_data)
            out_count = _item_count(parsed_output)

            if orig_count != out_count:
                logger.warning(
                    "JSONChunker.merge: item count mismatch — "
                    "original=%d, output=%d  (file=%s)",
                    orig_count,
                    out_count,
                    output_path,
                )
            else:
                logger.info(
                    "JSONChunker.merge: %d items preserved  (file=%s)",
                    out_count,
                    output_path,
                )
        except (OSError, json.JSONDecodeError) as exc:
            logger.error(
                "JSONChunker.merge: output validation failed (%s): %s",
                output_path,
                exc,
            )

    # ------------------------------------------------------------------
    # cleanup
    # ------------------------------------------------------------------

    def cleanup(self, chunk_metadata_list: List[ChunkMetadata]) -> None:
        """Delete all temporary files created by :meth:`split`."""
        for meta in chunk_metadata_list:
            for path in (meta.temp_input_path, meta.temp_output_path):
                try:
                    os.remove(path)
                except OSError:
                    pass


# ── Module-level chunked processing function ──────────────────────────────────

def _noop_progress(chunk_idx: int, status: str) -> None:  # noqa: ARG001
    pass


def _recursive_mask_strings(
    node: Any,
    replacement_map: dict[str, str],
) -> Any:
    """
    Walk a dict/list recursively and apply string replacement only on
    str values (not keys, not numbers).  Does NOT use regex on serialized
    JSON to avoid corrupting structure.
    """
    if isinstance(node, dict):
        return {
            k: _recursive_mask_strings(v, replacement_map)
            for k, v in node.items()
        }
    if isinstance(node, list):
        return [_recursive_mask_strings(item, replacement_map) for item in node]
    if isinstance(node, str):
        result = node
        for original in sorted(replacement_map, key=len, reverse=True):
            result = result.replace(original, replacement_map[original])
        return result
    return node


def process_json_chunked(
    input_path: str,
    output_path: str,
    mode: str = "redact",
    config: dict | None = None,
    progress_cb=_noop_progress,
) -> dict:
    """
    End-to-end chunked JSON processing with the new pipeline.

    JSON is ALWAYS Rule A (regex only).  If the incoming config has
    use_spacy=True, it is overridden here as a safety guard.

    Split strategy:
      - Root is JSON array: split into groups of chunk_size items.
      - Root is JSON object: split by top-level keys in groups.
      - Root is scalar: treat as single chunk.

    For detection: serialise each chunk to string, call detect_pii_batch().
    For masking: walk chunks recursively and apply string replacement on
    str values only (never on serialized JSON strings, which can corrupt
    structure).
    """
    from pathlib import Path

    from detection.masker import pii_masker
    from pipeline.detector import detect_pii_batch

    if config is None:
        config = {"use_regex": True, "use_spacy": False, "use_bert": False,
                  "chunk_size": DEFAULT_CHUNK_SIZE, "workers": 8}

    # Safety override: JSON is always regex-only (Rule A)
    if config.get("use_spacy") or config.get("use_bert"):
        logger.warning(
            "json_chunker: overriding use_spacy=%s, use_bert=%s → False "
            "(JSON is always Rule A: regex only)",
            config.get("use_spacy"),
            config.get("use_bert"),
        )
        config = {**config, "use_spacy": False, "use_bert": False}

    chunk_size = config.get("chunk_size", DEFAULT_CHUNK_SIZE)

    with open(input_path, encoding="utf-8") as fh:
        data = json.load(fh)

    # Detect indent style
    with open(input_path, encoding="utf-8") as fh:
        head = fh.read(512)
    indent = 2 if ("\n  " in head or "\n\t" in head) else None

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # ── Split into chunks ─────────────────────────────────────────────
    if isinstance(data, list):
        # Root is array: split into groups of chunk_size items
        chunks = [
            data[i : i + chunk_size]
            for i in range(0, max(1, len(data)), chunk_size)
        ]
        root_type = "array"
    elif isinstance(data, dict):
        # Root is object: split by top-level keys in groups
        keys = list(data.keys())
        chunks = [
            {k: data[k] for k in keys[i : i + chunk_size]}
            for i in range(0, max(1, len(keys)), chunk_size)
        ]
        root_type = "object"
    else:
        # Scalar: single chunk
        chunks = [data]
        root_type = "scalar"

    total = len(chunks)
    for i in range(total):
        progress_cb(i, "pending")

    # ── Detection: serialise chunks to strings, batch detect ───────────
    serialized = [json.dumps(chunk, ensure_ascii=False) for chunk in chunks]
    all_chunk_detections = detect_pii_batch(serialized, config)

    # ── Masking: walk each chunk recursively ──────────────────────────
    all_detections: list[dict] = []
    masked_chunks: list[Any] = []

    for idx, chunk in enumerate(chunks):
        progress_cb(idx, "processing")
        try:
            detections = all_chunk_detections[idx]
            all_detections.extend(detections)

            replacement_map: dict[str, str] = {}
            for det in detections:
                val = det["value"]
                if not val or val in replacement_map:
                    continue
                if mode == "redact":
                    replacement_map[val] = "[REDACTED]"
                elif mode == "mask":
                    replacement_map[val] = pii_masker.get_partial_mask(
                        val, det["entity_type"]
                    )
                elif mode == "tokenize":
                    replacement_map[val] = pii_masker.get_token(det["entity_type"])
                else:
                    replacement_map[val] = "[REDACTED]"

            masked_chunk = _recursive_mask_strings(chunk, replacement_map)
            masked_chunks.append(masked_chunk)
            progress_cb(idx, "done")
        except Exception:
            masked_chunks.append(chunk)
            progress_cb(idx, "failed")
            raise

    # ── Reassemble and write output ───────────────────────────────────
    if root_type == "array":
        output_data: Any = []
        for mc in masked_chunks:
            if isinstance(mc, list):
                output_data.extend(mc)
            else:
                output_data.append(mc)
    elif root_type == "object":
        output_data = {}
        for mc in masked_chunks:
            if isinstance(mc, dict):
                output_data.update(mc)
    else:
        output_data = masked_chunks[0] if masked_chunks else data

    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(output_data, fh, indent=indent, ensure_ascii=False)

    return _build_json_summary(all_detections, total)


def _build_json_summary(detections: list[dict], chunk_count: int) -> dict:
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
        "chunk_count":          chunk_count,
    }
