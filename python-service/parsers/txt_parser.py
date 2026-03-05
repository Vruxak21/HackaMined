"""
Plain-text parser.

Reads a UTF-8 text file, runs the full PII detection pipeline, and writes the
masked text to the output path.  Long files are chunked to stay within the
spaCy / Presidio token limit.
"""

from __future__ import annotations

from typing import Any

from detection.analyzer_engine import pii_analyzer
from detection.context_analyzer import context_analyzer
from detection.confidence_scorer import confidence_scorer
from detection.masker import pii_masker

# spaCy's default max_length is ~1 million chars; chunk well below that
_CHUNK_SIZE = 50_000


def _chunk_text(text: str, size: int = _CHUNK_SIZE) -> list[tuple[int, str]]:
    """Split text into (offset, chunk) pairs for position-accurate results."""
    chunks: list[tuple[int, str]] = []
    for i in range(0, len(text), size):
        chunks.append((i, text[i: i + size]))
    return chunks


def process_txt(
    input_path: str,
    output_path: str,
    mode: str = "redact",
) -> dict[str, Any]:
    """
    Detect and sanitise PII in a plain-text file.

    Returns a summary dict.
    """
    with open(input_path, encoding="utf-8", errors="replace") as fh:
        text = fh.read()

    all_to_mask: list[dict[str, Any]] = []
    total_high = 0
    total_medium = 0
    masked_chunks: list[str] = []

    for _offset, chunk in _chunk_text(text):
        analysis = pii_analyzer.analyze(chunk)
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

        all_to_mask.extend(to_mask)
        total_high += scored["high_count"]
        total_medium += scored["medium_count"]
        masked_chunks.append(mask_out["masked_text"])

    with open(output_path, "w", encoding="utf-8") as fh:
        fh.write("".join(masked_chunks))

    return {
        "pii_summary": confidence_scorer.get_summary(all_to_mask),
        "layer_breakdown": confidence_scorer.get_layer_breakdown(all_to_mask),
        "confidence_breakdown": {
            "high": total_high,
            "medium": total_medium,
        },
        "total_pii": len(all_to_mask),
    }

