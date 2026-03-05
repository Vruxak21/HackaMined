"""
Context Analyzer — implements the Slide 6 novelty rule.

The core insight (Slide 6 of the project brief):
  The SAME data value is non-PII when seen in isolation but becomes PII when
  it is structurally linked to an identity (a person name or e-mail address
  appearing nearby in the document).

Pipeline position: runs AFTER all 3 detection layers, BEFORE confidence scoring.

Boost constants
---------------
LABEL_BOOST          — reward for value sitting right after a PII label
PROXIMITY_BOOST      — reward for appearing in a cluster of other PII values
DENSITY_BOOST        — reward for appearing in a sentence dense with PII
IDENTITY_ANCHOR_ZONE — character radius around a PERSON/EMAIL anchor
PROXIMITY_WINDOW     — character radius for cluster detection
"""

from __future__ import annotations

import re
from typing import Any

from detection.preprocessor import TextPreprocessor

# ── Tuneable constants ────────────────────────────────────────────────────────
LABEL_BOOST = 0.15
PROXIMITY_BOOST = 0.10
DENSITY_BOOST = 0.10
IDENTITY_ANCHOR_ZONE = 300
PROXIMITY_WINDOW = 150

# ── Identity anchor entity types ──────────────────────────────────────────────
_ANCHOR_TYPES = {"PERSON", "EMAIL_ADDRESS"}


def _cap(score: float) -> float:
    """Clamp a score to [0.0, 1.0]."""
    return min(1.0, max(0.0, score))


def _in_zone(pos: int, anchor_start: int, anchor_end: int, radius: int) -> bool:
    """Return True if *pos* falls within [anchor_start-radius, anchor_end+radius]."""
    return (anchor_start - radius) <= pos <= (anchor_end + radius)


class ContextAnalyzer:
    """
    Post-detection context booster implementing the Slide 6 rule and
    four supporting heuristics.
    """

    def __init__(self) -> None:
        self._preprocessor = TextPreprocessor()

    # ── 1. Label boost ────────────────────────────────────────────────────────

    def boost_with_labels(
        self,
        results: list[dict[str, Any]],
        label_pairs: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Boost a result when a matching PII label appears immediately before it
        (within 50 characters).  This rewards values that were explicitly
        labelled in the source document (e.g. "Aadhaar: 5487 8795 5678").
        """
        for result in results:
            for lp in label_pairs:
                if lp["entity_type"] != result["type"]:
                    continue
                # label must end no more than 50 chars before the value starts
                label_end = lp.get("label_end", lp.get("value_start", 0))
                gap = result["start"] - label_end
                if 0 <= gap <= 50:
                    result["score"] = _cap(result["score"] + LABEL_BOOST)
                    result["label_boosted"] = True
                    break  # only boost once per result
        return results

    # ── 2. Proximity boost ────────────────────────────────────────────────────

    def boost_with_proximity(
        self,
        results: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Boost values that appear in a cluster of other PII within
        PROXIMITY_WINDOW characters.  A dense cluster is a strong signal that
        the surrounding context is an identity/record block.
        """
        sorted_results = sorted(results, key=lambda r: r["start"])

        for i, result in enumerate(sorted_results):
            nearby = sum(
                1
                for j, other in enumerate(sorted_results)
                if j != i
                and abs(other["start"] - result["start"]) <= PROXIMITY_WINDOW
            )
            if nearby == 0:
                continue  # no cluster; no boost
            if nearby <= 2:
                result["score"] = _cap(result["score"] + PROXIMITY_BOOST)
            else:
                result["score"] = _cap(result["score"] + PROXIMITY_BOOST * 2)
            result["proximity_boosted"] = True

        return sorted_results

    # ── 3. Slide 6 rule ───────────────────────────────────────────────────────

    def apply_slide6_rule(
        self,
        text: str,  # noqa: ARG002  (reserved for future sentence-level work)
        results: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Core novelty implementation of the Slide 6 rule.

        Uncertain values (0.55 ≤ score < 0.85) are up-scored when they fall
        within IDENTITY_ANCHOR_ZONE characters of a high-confidence PERSON or
        EMAIL_ADDRESS detection.

        Low-confidence values (score < 0.55) are flagged as standalone_non_pii
        when they have no nearby identity anchor and boosted to 0.70 when they do.

        Contextual types (DATE_TIME, LOCATION) are *always* evaluated against
        the nearest identity anchor regardless of their raw score — a date or
        location is only PII when it is linked to an identifiable person.
        """
        # Contextual types that are only PII when near an identity anchor
        _CONTEXTUAL_TYPES = {"DATE_TIME", "LOCATION"}

        # Step 1: collect identity anchors
        anchors = [
            r for r in results
            if r["type"] in _ANCHOR_TYPES and r["score"] >= 0.70
        ]

        # Pre-compute anchor zones as (start, end) tuples for O(n) look-up
        zones = [
            (a["start"] - IDENTITY_ANCHOR_ZONE, a["end"] + IDENTITY_ANCHOR_ZONE)
            for a in anchors
        ]

        def _in_any_zone(pos: int) -> bool:
            return any(lo <= pos <= hi for lo, hi in zones)

        for result in results:
            # Skip anchors themselves
            if result["type"] in _ANCHOR_TYPES:
                continue

            in_zone = _in_any_zone(result["start"])
            score = result["score"]

            # Contextual types: always require an identity anchor to be PII
            if result["type"] in _CONTEXTUAL_TYPES:
                if in_zone:
                    result["score"] = _cap(max(score, 0.85))
                    result["slide6_boosted"] = True
                    result["linked_to_identity"] = True
                else:
                    result["standalone_non_pii"] = True
                continue

            # Step 3: uncertain values near an identity anchor
            if 0.55 <= score < 0.85:
                if in_zone:
                    result["score"] = _cap(score + 0.20)
                    result["slide6_boosted"] = True
                    result["linked_to_identity"] = True

            # Step 4: low-confidence values
            elif score < 0.55:
                if in_zone:
                    result["score"] = 0.70
                    result["slide6_boosted"] = True
                    result["linked_to_identity"] = True
                else:
                    result["standalone_non_pii"] = True

        return results

    # ── 4. Sentence density boost ─────────────────────────────────────────────

    def check_sentence_density(
        self,
        text: str,
        results: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Sentences that contain 3 or more distinct PII hits indicate a highly
        structured record (e.g. a KYC form row).  Boost everything in those
        sentences to reward the strong contextual signal.
        """
        # Split on common sentence-ending punctuation; keep track of offsets
        sentence_spans: list[tuple[int, int]] = []
        for m in re.finditer(r"[^.!?\n]+[.!?\n]?", text):
            sentence_spans.append((m.start(), m.end()))

        for sent_start, sent_end in sentence_spans:
            hits_in_sent = [
                r for r in results
                if sent_start <= r["start"] < sent_end
            ]
            if len(hits_in_sent) >= 3:
                for result in hits_in_sent:
                    result["score"] = _cap(result["score"] + DENSITY_BOOST)
                    result["density_boosted"] = True

        return results

    # ── 5. Column-name context boost ─────────────────────────────────────────

    def analyze_column_context(
        self,
        column_name: str,
        results: list[dict[str, Any]],
        all_column_results: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        When processing tabular data, the column header often names the PII
        type exactly.  If the preprocessor maps the column to a known entity
        type, boost all same-type results in the column to 0.95.
        """
        pii_type = self._preprocessor.get_column_pii_type(column_name)
        if pii_type is None:
            return all_column_results

        for result in all_column_results:
            if result["type"] == pii_type:
                result["score"] = _cap(max(result["score"], 0.95))
                result["column_name_boosted"] = True

        return all_column_results

    # ── Public entry point ────────────────────────────────────────────────────

    def analyze(
        self,
        text: str,
        presidio_results: list[Any],
        indic_results: list[dict[str, Any]],
        label_pairs: list[dict[str, Any]],
        column_name: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Full context-analysis pass.

        Accepts raw output from PIIAnalyzer.analyze(), normalises everything
        into a uniform dict format, then applies all five context boosts in
        order.

        Parameters
        ----------
        text             : the cleaned source text
        presidio_results : list of presidio_analyzer.RecognizerResult objects
        indic_results    : list of dicts from the indic-bert layer
        label_pairs      : list of dicts from TextPreprocessor.extract_label_value_pairs
        column_name      : optional column header (tabular data only)

        Returns
        -------
        list of fully annotated result dicts, sorted by start position.
        """
        # ── Normalise Presidio RecognizerResult objects ───────────────────────
        normalised: list[dict[str, Any]] = []

        for r in presidio_results:
            # Presidio RecognizerResult has .entity_type, .start, .end, .score
            normalised.append(
                {
                    "type": r.entity_type,
                    "value": text[r.start: r.end],
                    "start": r.start,
                    "end": r.end,
                    "score": float(r.score),
                    "source": (
                        r.recognition_metadata.get("source", "presidio_spacy")
                        if r.recognition_metadata
                        else "presidio_spacy"
                    ),
                    # Boost flags
                    "label_boosted": False,
                    "proximity_boosted": False,
                    "slide6_boosted": False,
                    "column_name_boosted": False,
                    "density_boosted": False,
                    "standalone_non_pii": False,
                    "linked_to_identity": False,
                }
            )

        # ── Normalise indic-bert dicts (already close to the target format) ──
        for r in indic_results:
            normalised.append(
                {
                    "type": r["type"],
                    "value": r.get("value", text[r["start"]: r["end"]]),
                    "start": r["start"],
                    "end": r["end"],
                    "score": float(r["score"]),
                    "source": r.get("source", "indic_bert"),
                    "label_boosted": False,
                    "proximity_boosted": False,
                    "slide6_boosted": False,
                    "column_name_boosted": False,
                    "density_boosted": False,
                    "standalone_non_pii": False,
                    "linked_to_identity": False,
                }
            )

        # ── Apply context boosts in defined order ─────────────────────────────
        normalised = self.boost_with_labels(normalised, label_pairs)
        normalised = self.boost_with_proximity(normalised)
        normalised = self.apply_slide6_rule(text, normalised)
        normalised = self.check_sentence_density(text, normalised)
        if column_name is not None:
            normalised = self.analyze_column_context(
                column_name, normalised, normalised
            )

        normalised.sort(key=lambda r: r["start"])
        return normalised


# ── Module-level singleton ────────────────────────────────────────────────────
context_analyzer = ContextAnalyzer()

