"""
CSV parser using pandas.

Processes each column independently, passing the column header as context so
the ContextAnalyzer can apply column-name boosts.  Cell-level replacements are
written back into the DataFrame before saving as CSV.

Each column is processed in small batches (CELL_BATCH_SIZE rows at a time) so
the NLP models never receive a multi-megabyte joined string, which would be
extremely slow and would exceed BERT's 512-token window.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from detection.analyzer_engine import pii_analyzer
from detection.context_analyzer import context_analyzer
from detection.confidence_scorer import confidence_scorer
from detection.masker import pii_masker
from detection.preprocessor import TextPreprocessor

_preprocessor = TextPreprocessor()

# Maximum number of rows joined into a single NLP call per column batch.
# Keeps each joined string under ~5–10 KB, which is fast for both spaCy and
# BERT (512-token limit means content beyond that is already truncated).
_CELL_BATCH_SIZE = 200


def _process_batch(
    col_name: str,
    batch_values: list[str],
    mode: str,
) -> tuple[list[str], list[dict[str, Any]], int, int]:
    """
    Run the full PII pipeline on a small batch of cell values joined as one
    text block, then map replacements back to individual cell strings.

    Returns (sanitised_values, to_mask, high_count, medium_count).
    """
    separator = " | "
    joined = separator.join(str(v) for v in batch_values)

    analysis = pii_analyzer.analyze(joined)
    enriched = context_analyzer.analyze(
        analysis["cleaned_text"],
        analysis["presidio_results"],
        analysis["indic_results"],
        analysis["label_pairs"],
        column_name=col_name,
    )
    deduped = confidence_scorer.deduplicate(enriched)
    scored = confidence_scorer.score_and_filter(deduped)
    to_mask = scored["to_mask"]

    # Build per-value replacement map from detected spans
    replacement_map: dict[str, str] = {}
    for result in to_mask:
        value = result.get("value", "")
        if not value or value in replacement_map:
            continue
        single_out = pii_masker.mask(
            value,
            [{**result, "start": 0, "end": len(value)}],
            mode,
        )
        replacement_map[value] = single_out["masked_text"]

    sanitised: list[str] = []
    for v in batch_values:
        cell = str(v)
        for original, replacement in replacement_map.items():
            cell = cell.replace(original, replacement)
        sanitised.append(cell)

    return sanitised, to_mask, scored["high_count"], scored["medium_count"]


def _process_column(
    col_name: str,
    values: list[str],
    mode: str,
) -> tuple[list[str], list[dict[str, Any]], int, int]:
    """
    Process all values in a column in batches of _CELL_BATCH_SIZE.

    Returns (sanitised_values, to_mask, high_count, medium_count).
    """
    all_sanitised: list[str] = []
    all_to_mask: list[dict[str, Any]] = []
    total_high = 0
    total_medium = 0

    for batch_start in range(0, len(values), _CELL_BATCH_SIZE):
        batch = values[batch_start: batch_start + _CELL_BATCH_SIZE]
        san, to_mask, high, medium = _process_batch(col_name, batch, mode)
        all_sanitised.extend(san)
        all_to_mask.extend(to_mask)
        total_high += high
        total_medium += medium

    return all_sanitised, all_to_mask, total_high, total_medium


def process_csv(
    input_path: str,
    output_path: str,
    mode: str = "redact",
) -> dict[str, Any]:
    """
    Detect and sanitise PII in a CSV file, column by column.

    Returns a summary dict.
    """
    df = pd.read_csv(input_path, dtype=str).fillna("")

    all_to_mask: list[dict[str, Any]] = []
    total_high = 0
    total_medium = 0

    for col_name in df.columns:
        sanitised_vals, to_mask, high, medium = _process_column(
            col_name, df[col_name].tolist(), mode
        )
        df[col_name] = sanitised_vals
        all_to_mask.extend(to_mask)
        total_high += high
        total_medium += medium

    df.to_csv(output_path, index=False)

    return {
        "pii_summary": confidence_scorer.get_summary(all_to_mask),
        "layer_breakdown": confidence_scorer.get_layer_breakdown(all_to_mask),
        "confidence_breakdown": {
            "high": total_high,
            "medium": total_medium,
        },
        "total_pii": len(all_to_mask),
    }

