"""
PII Detector — unified detection API for the processing pipeline.

All three detection layers live here.  Which layers actually run is
controlled entirely by the ``config`` dict produced by pipeline_config.

Layers:
  1. Regex  — custom Indian PII patterns + standard patterns (EMAIL, IP, CC)
  2. spaCy  — NER via en_core_web_sm *or* en_core_web_trf
  3. BERT   — dslim/bert-base-NER transformer

Public API:
  detect_pii_single(text, config)  → list[dict]
  detect_pii_batch(texts, config)  → list[list[dict]]
  deduplicate_results(results)     → list[dict]
"""

from __future__ import annotations

import logging
import re
from typing import Any

from pipeline.model_loader import analyzer, nlp_fast, nlp_full, bert_ner

logger = logging.getLogger(__name__)

# ── Pre-compiled regex patterns ───────────────────────────────────────────────
# Built once at import time from detection/custom_recognizers + standard patterns.

_REGEX_PATTERNS: list[tuple[str, re.Pattern, float]] = []


def _build_regex_patterns() -> list[tuple[str, re.Pattern, float]]:
    """
    Compile regex patterns from custom recognizers and add standard ones
    that Presidio normally handles but we need for the regex-only fast path.
    """
    patterns: list[tuple[str, re.Pattern, float]] = []

    # ── Patterns from custom Indian-PII recognizers ───────────────────────
    try:
        from detection.custom_recognizers import get_custom_recognizers

        for rec in get_custom_recognizers():
            entity = rec.supported_entities[0]
            for pat in rec.patterns:
                try:
                    patterns.append((entity, re.compile(pat.regex), pat.score))
                except re.error as exc:
                    logger.warning("Bad regex in %s: %s", entity, exc)
    except Exception as exc:
        logger.error("Could not load custom recognizers for regex layer: %s", exc)

    # ── Standard patterns (supplement custom recognizers) ─────────────────
    _standard = [
        (
            "EMAIL_ADDRESS",
            r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b",
            0.90,
        ),
        (
            "IP_ADDRESS",
            r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}"
            r"(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b",
            0.85,
        ),
        (
            "CREDIT_CARD",
            r"\b(?:4\d{3}|5[1-5]\d{2}|6011|3[47]\d{2})"
            r"[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b",
            0.85,
        ),
    ]
    for entity, regex, score in _standard:
        try:
            patterns.append((entity, re.compile(regex), score))
        except re.error as exc:
            logger.warning("Bad standard regex for %s: %s", entity, exc)

    return patterns


_REGEX_PATTERNS = _build_regex_patterns()


# ── Layer 1: Regex ────────────────────────────────────────────────────────────

def _run_regex(text: str) -> list[dict[str, Any]]:
    """Run all compiled regex patterns against *text*."""
    results: list[dict[str, Any]] = []
    for entity_type, pattern, base_score in _REGEX_PATTERNS:
        for match in pattern.finditer(text):
            results.append({
                "entity_type": entity_type,
                "start": match.start(),
                "end": match.end(),
                "value": match.group(),
                "score": base_score,
                "layer": "regex",
            })
    return results


# ── Layer 2: spaCy NER ────────────────────────────────────────────────────────

def _get_spacy_model(model_name: str):
    """Return the loaded spaCy model matching *model_name*."""
    if model_name == "en_core_web_sm":
        return nlp_fast
    # For trf / lg, prefer nlp_full; fall back to nlp_fast
    return nlp_full or nlp_fast


def _run_spacy_single(text: str, model_name: str) -> list[dict[str, Any]]:
    """Layer 2: spaCy NER on a single text string."""
    model = _get_spacy_model(model_name)
    if model is None:
        logger.warning("spaCy model unavailable — skipping spaCy layer")
        return []
    doc = model(text)
    results: list[dict[str, Any]] = []
    for ent in doc.ents:
        results.append({
            "entity_type": ent.label_,
            "start": ent.start_char,
            "end": ent.end_char,
            "value": ent.text,
            "score": 0.85,
            "layer": "spacy",
        })
    return results


def _run_spacy_batch(
    texts: list[str],
    model_name: str,
) -> list[list[dict[str, Any]]]:
    """Layer 2: spaCy NER on a batch using ``nlp.pipe()``."""
    model = _get_spacy_model(model_name)
    if model is None:
        logger.warning("spaCy model unavailable — skipping spaCy layer")
        return [[] for _ in texts]

    all_results: list[list[dict[str, Any]]] = []
    for doc in model.pipe(texts, batch_size=8):
        results: list[dict[str, Any]] = []
        for ent in doc.ents:
            results.append({
                "entity_type": ent.label_,
                "start": ent.start_char,
                "end": ent.end_char,
                "value": ent.text,
                "score": 0.85,
                "layer": "spacy",
            })
        all_results.append(results)
    return all_results


# ── Layer 3: BERT NER ─────────────────────────────────────────────────────────

def _run_bert(text: str) -> list[dict[str, Any]]:
    """Layer 3: transformer NER (dslim/bert-base-NER), max 512 tokens."""
    if bert_ner is None:
        logger.warning("BERT NER unavailable — skipping BERT layer")
        return []
    results: list[dict[str, Any]] = []
    raw = bert_ner(text[:512])
    for entity in raw:
        group = entity.get("entity_group", "")
        if group in ("PER", "PERSON"):
            entity_type = "PERSON"
        elif group in ("LOC", "GPE"):
            entity_type = "LOCATION"
        elif group == "ORG":
            entity_type = "ORGANIZATION"
        else:
            continue
        results.append({
            "entity_type": entity_type,
            "start": entity["start"],
            "end": entity["end"],
            "value": entity["word"],
            "score": float(entity["score"]),
            "layer": "bert",
        })
    return results


# ── Deduplication ─────────────────────────────────────────────────────────────

_LAYER_PRIORITY: dict[str, int] = {"bert": 3, "spacy": 2, "regex": 1}


def deduplicate_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Remove duplicates where two results overlap in character range AND have
    the same entity_type.  Keep the one with the higher score.
    If scores are equal, prefer layer order: bert > spacy > regex.
    """
    sorted_results = sorted(results, key=lambda r: r["start"])
    final: list[dict[str, Any]] = []

    for candidate in sorted_results:
        overlap_idx: int | None = None
        for idx, accepted in enumerate(final):
            if (
                candidate["entity_type"] == accepted["entity_type"]
                and candidate["start"] < accepted["end"]
                and candidate["end"] > accepted["start"]
            ):
                overlap_idx = idx
                break

        if overlap_idx is None:
            final.append(candidate)
        else:
            existing = final[overlap_idx]
            cand_priority = _LAYER_PRIORITY.get(candidate["layer"], 0)
            exist_priority = _LAYER_PRIORITY.get(existing["layer"], 0)
            if candidate["score"] > existing["score"]:
                final[overlap_idx] = candidate
            elif (
                candidate["score"] == existing["score"]
                and cand_priority > exist_priority
            ):
                final[overlap_idx] = candidate

    return sorted(final, key=lambda r: r["start"])


# ── Public API ────────────────────────────────────────────────────────────────

def detect_pii_single(text: str, config: dict) -> list[dict[str, Any]]:
    """
    Run detection layers gated by *config* flags on a single text.

    Returns a deduplicated list of result dicts, each with keys:
      entity_type, start, end, value, score, layer
    """
    results: list[dict[str, Any]] = []

    if config.get("use_regex", True):
        results.extend(_run_regex(text))

    if config.get("use_spacy", False):
        model_name = config.get("spacy_model", "en_core_web_sm")
        results.extend(_run_spacy_single(text, model_name))

    if config.get("use_bert", False):
        results.extend(_run_bert(text))

    return deduplicate_results(results)


def detect_pii_batch(
    texts: list[str],
    config: dict,
) -> list[list[dict[str, Any]]]:
    """
    Run detection layers on a batch of texts.

    For the spaCy layer, ``nlp.pipe(texts, batch_size=8)`` is used instead
    of a per-text loop.  For regex and BERT, a simple loop is fine (they
    have no pipe API worth batching).

    Returns one result list per input text, in the same order.
    """
    n = len(texts)
    batch_results: list[list[dict[str, Any]]] = [[] for _ in range(n)]

    # Layer 1: Regex (loop)
    if config.get("use_regex", True):
        for i, text in enumerate(texts):
            batch_results[i].extend(_run_regex(text))

    # Layer 2: spaCy (batched via nlp.pipe)
    if config.get("use_spacy", False):
        model_name = config.get("spacy_model", "en_core_web_sm")
        spacy_batch = _run_spacy_batch(texts, model_name)
        for i, spacy_results in enumerate(spacy_batch):
            batch_results[i].extend(spacy_results)

    # Layer 3: BERT (loop)
    if config.get("use_bert", False):
        for i, text in enumerate(texts):
            batch_results[i].extend(_run_bert(text))

    # Deduplicate each text's results independently
    return [deduplicate_results(r) for r in batch_results]
