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
from pathlib import Path
from typing import Any, List, Optional, Tuple

from chunking.chunk_models import ChunkMetadata, ChunkResult
from chunking.config import get_chunk_config

logger = logging.getLogger(__name__)


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

    def split(self, file_path: str) -> List[ChunkMetadata]:
        """
        Parse *file_path*, detect its root structure, and write one temp
        .json file per chunk.

        Populates ``self.chunk_type`` and ``self.array_key`` so that
        :meth:`merge` can be called without re-parsing the orignal file.

        Returns
        -------
        list[ChunkMetadata]
            One entry per chunk (temp files already written).
        """
        config = get_chunk_config("json")
        items_per_chunk: int = config["items_per_chunk"]

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
        tmp_dir = Path("/tmp")
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
