"""
JSON parser.

Recursively traverses all string leaf values in any JSON structure (objects,
arrays, nested).  Each string value is individually processed through the
detection pipeline and replaced in the rebuilt structure.  The sanitised JSON
is written with the same formatting as the input.
"""

from __future__ import annotations

import json
from typing import Any

from detection.analyzer_engine import pii_analyzer
from detection.context_analyzer import context_analyzer
from detection.confidence_scorer import confidence_scorer
from detection.masker import pii_masker


def _sanitise_value(
    value: str,
    mode: str,
    all_to_mask: list[dict[str, Any]],
    counters: dict[str, int],
) -> str:
    """
    Run the full pipeline on a single JSON string value.
    Accumulates detections in all_to_mask for final summary.
    """
    if not value.strip():
        return value

    analysis = pii_analyzer.analyze(value)
    enriched = context_analyzer.analyze(
        analysis["cleaned_text"],
        analysis["presidio_results"],
        analysis["indic_results"],
        analysis["label_pairs"],
    )
    deduped = confidence_scorer.deduplicate(enriched)
    scored = confidence_scorer.score_and_filter(deduped)
    to_mask = scored["to_mask"]

    all_to_mask.extend(to_mask)
    counters["high"] = counters.get("high", 0) + scored["high_count"]
    counters["medium"] = counters.get("medium", 0) + scored["medium_count"]

    if not to_mask:
        return value

    mask_out = pii_masker.mask(analysis["cleaned_text"], to_mask, mode)
    return mask_out["masked_text"]


def _traverse(
    node: Any,
    mode: str,
    all_to_mask: list[dict[str, Any]],
    counters: dict[str, int],
) -> Any:
    """Recursively sanitise all string leaves in a JSON node."""
    if isinstance(node, dict):
        return {
            k: _traverse(v, mode, all_to_mask, counters)
            for k, v in node.items()
        }
    if isinstance(node, list):
        return [_traverse(item, mode, all_to_mask, counters) for item in node]
    if isinstance(node, str):
        return _sanitise_value(node, mode, all_to_mask, counters)
    return node  # int, float, bool, None — pass through untouched


def process_json(
    input_path: str,
    output_path: str,
    mode: str = "redact",
) -> dict[str, Any]:
    """
    Detect and sanitise PII in a JSON file.

    Returns a summary dict.
    """
    with open(input_path, encoding="utf-8") as fh:
        data = json.load(fh)

    all_to_mask: list[dict[str, Any]] = []
    counters: dict[str, int] = {"high": 0, "medium": 0}

    sanitised = _traverse(data, mode, all_to_mask, counters)

    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(sanitised, fh, ensure_ascii=False, indent=2)

    return {
        "pii_summary": confidence_scorer.get_summary(all_to_mask),
        "layer_breakdown": confidence_scorer.get_layer_breakdown(all_to_mask),
        "confidence_breakdown": {
            "high": counters["high"],
            "medium": counters["medium"],
        },
        "total_pii": len(all_to_mask),
    }

