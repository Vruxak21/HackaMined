"""
SQL parser.

Treats the SQL file as plain text — the detection pipeline operates on the
raw SQL string, which naturally includes all INSERT values, comments, and
string literals that may contain PII.  The masked text is written verbatim
to the output file.
"""

from __future__ import annotations

from typing import Any

from detection.analyzer_engine import pii_analyzer
from detection.context_analyzer import context_analyzer
from detection.confidence_scorer import confidence_scorer
from detection.masker import pii_masker


def process_sql(
    input_path: str,
    output_path: str,
    mode: str = "redact",
) -> dict[str, Any]:
    """
    Detect and sanitise PII in a SQL file.

    Returns a summary dict.
    """
    with open(input_path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()

    # ── Detection pipeline ────────────────────────────────────────────────────
    analysis = pii_analyzer.analyze(text)
    enriched = context_analyzer.analyze(
        analysis["cleaned_text"],
        analysis["presidio_results"],
        analysis["indic_results"],
        analysis["label_pairs"],
    )
    deduped = confidence_scorer.deduplicate(enriched)
    scored = confidence_scorer.score_and_filter(deduped)
    to_mask = scored["to_mask"]
    mask_out = pii_masker.mask(analysis["cleaned_text"], to_mask, mode)

    # ── Write output ──────────────────────────────────────────────────────────
    with open(output_path, "w", encoding="utf-8") as fh:
        fh.write(mask_out["masked_text"])

    return {
        "pii_summary": confidence_scorer.get_summary(to_mask),
        "layer_breakdown": confidence_scorer.get_layer_breakdown(to_mask),
        "confidence_breakdown": {
            "high": scored["high_count"],
            "medium": scored["medium_count"],
        },
        "total_pii": len(to_mask),
    }

