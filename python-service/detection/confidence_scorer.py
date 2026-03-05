"""
Confidence Scorer and Deduplicator.

Pipeline position: runs AFTER ContextAnalyzer, BEFORE Masker.

Responsibilities
----------------
1. Tier results into high / medium / low confidence buckets.
2. Deduplicate overlapping spans (keep the highest-scoring span).
3. Produce summary statistics consumed by the API response and the UI cards.

Thresholds
----------
HIGH_CONFIDENCE   >= 0.85  → definitely mask
MEDIUM_CONFIDENCE >= 0.60  → mask (with context support from prior stage)
LOW_CONFIDENCE    <  0.60  → do not mask (or flag for manual review)
"""

from __future__ import annotations

from typing import Any

# ── Thresholds ────────────────────────────────────────────────────────────────
HIGH_CONFIDENCE: float = 0.85
MEDIUM_CONFIDENCE: float = 0.60
LOW_CONFIDENCE: float = 0.60  # alias kept for readability in comparisons


class ConfidenceScorer:
    """
    Tiers, deduplicates and summarises context-analysed PII results.
    """

    # ── Tiering ───────────────────────────────────────────────────────────────

    def score_and_filter(
        self, results: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """
        Separate *results* into confidence tiers.

        Returns
        -------
        dict with keys:
          to_mask         — list to send to the Masker (high + medium)
          low_confidence  — list to discard / flag for review
          high_count      — int
          medium_count    — int
          low_count       — int
        """
        high: list[dict[str, Any]] = []
        medium: list[dict[str, Any]] = []
        low: list[dict[str, Any]] = []

        for result in results:
            score = result["score"]
            standalone = result.get("standalone_non_pii", False)

            if standalone or score < LOW_CONFIDENCE:
                low.append(result)
            elif score >= HIGH_CONFIDENCE:
                high.append(result)
            else:
                # MEDIUM_CONFIDENCE <= score < HIGH_CONFIDENCE
                medium.append(result)

        return {
            "to_mask": high + medium,
            "low_confidence": low,
            "high_count": len(high),
            "medium_count": len(medium),
            "low_count": len(low),
        }

    # ── Deduplication ─────────────────────────────────────────────────────────

    def deduplicate(
        self, results: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Remove overlapping spans, keeping the highest-scoring one.

        When two results share any character position the lower-scoring one is
        discarded.  On equal scores the earlier result (lower start) is kept.
        """
        sorted_input = sorted(results, key=lambda r: r["start"])
        final: list[dict[str, Any]] = []

        for candidate in sorted_input:
            overlapping_idx: int | None = None

            for idx, accepted in enumerate(final):
                # Standard overlap test: intervals [s1,e1) and [s2,e2) overlap
                # iff s1 < e2 AND s2 < e1
                if (
                    candidate["start"] < accepted["end"]
                    and candidate["end"] > accepted["start"]
                ):
                    overlapping_idx = idx
                    break

            if overlapping_idx is None:
                final.append(candidate)
            elif candidate["score"] > final[overlapping_idx]["score"]:
                # Replace the weaker accepted result
                final[overlapping_idx] = candidate

        return sorted(final, key=lambda r: r["start"])

    # ── Summary helpers ───────────────────────────────────────────────────────

    def get_summary(
        self, results: list[dict[str, Any]]
    ) -> dict[str, int]:
        """Return a count-by-entity-type mapping."""
        summary: dict[str, int] = {}
        for result in results:
            entity_type = result["type"]
            summary[entity_type] = summary.get(entity_type, 0) + 1
        return summary

    def get_layer_breakdown(
        self, results: list[dict[str, Any]]
    ) -> dict[str, int]:
        """
        Return a count-by-detection-source mapping.

        Known sources: "regex", "presidio_spacy", "indic_bert".
        Results with an unrecognised source are bucketed under "presidio_spacy"
        (the most common fallback).
        """
        breakdown: dict[str, int] = {
            "regex": 0,
            "presidio_spacy": 0,
            "indic_bert": 0,
        }
        for result in results:
            source = result.get("source", "presidio_spacy")
            if source in breakdown:
                breakdown[source] += 1
            else:
                breakdown["presidio_spacy"] += 1
        return breakdown

    def get_confidence_breakdown(
        self, high_count: int, medium_count: int
    ) -> dict[str, int]:
        """Return high / medium split for the UI summary card."""
        return {
            "high_confidence": high_count,
            "medium_confidence": medium_count,
        }


# ── Module-level singleton ────────────────────────────────────────────────────
confidence_scorer = ConfidenceScorer()

