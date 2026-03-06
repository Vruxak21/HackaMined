"""
Model Loader — loads all ML models exactly ONCE at module-import time.

Exports (module-level singletons):
    analyzer     — Presidio AnalyzerEngine with custom Indian-PII recognizers
    nlp_fast     — spaCy "en_core_web_sm"
    nlp_full     — spaCy "en_core_web_trf" (fallback → "en_core_web_lg" → "en_core_web_sm")
    bert_ner     — HuggingFace token-classification pipeline (dslim/bert-base-NER)
    _load_errors — dict mapping model key → error string for any that failed

Functions:
    is_ready()        → bool   (True only if analyzer + nlp_fast + nlp_full loaded)
    get_model_status() → dict  (per-model booleans + error list)
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# Force PyTorch backend before any transformers/torch import
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("USE_TORCH", "1")

_load_errors: dict[str, str] = {}

# ── 1. Presidio AnalyzerEngine ────────────────────────────────────────────────

analyzer = None
try:
    from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
    from presidio_analyzer.nlp_engine import NlpEngineProvider
    from detection.custom_recognizers import get_custom_recognizers

    _nlp_cfg: dict[str, Any] = {
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
    }
    _nlp_engine = NlpEngineProvider(nlp_configuration=_nlp_cfg).create_engine()

    _registry = RecognizerRegistry()
    _registry.load_predefined_recognizers()
    for _rec in get_custom_recognizers():
        _registry.add_recognizer(_rec)

    analyzer = AnalyzerEngine(
        nlp_engine=_nlp_engine,
        registry=_registry,
        supported_languages=["en"],
    )
    logger.info("Presidio AnalyzerEngine loaded successfully")
except Exception as exc:
    _load_errors["presidio"] = str(exc)
    logger.error("Failed to load Presidio AnalyzerEngine: %s", exc)


# ── 2. spaCy fast model (en_core_web_sm) ──────────────────────────────────────

nlp_fast = None
try:
    import spacy
    nlp_fast = spacy.load("en_core_web_sm")
    logger.info("spaCy fast model (en_core_web_sm) loaded")
except Exception as exc:
    _load_errors["spacy_fast"] = str(exc)
    logger.error("Failed to load spaCy en_core_web_sm: %s", exc)


# ── 3. spaCy full model (trf → lg → sm fallback chain) ────────────────────────

nlp_full = None
_full_attempts: list[str] = []

for _model_name in ("en_core_web_trf", "en_core_web_lg", "en_core_web_sm"):
    try:
        import spacy as _sp  # noqa: F811
        nlp_full = _sp.load(_model_name)
        logger.info("spaCy full model loaded: %s", _model_name)
        break
    except Exception as _exc:
        _full_attempts.append(f"{_model_name}: {_exc}")

if nlp_full is None:
    _load_errors["spacy_full"] = "; ".join(_full_attempts)
    logger.error("Failed to load any spaCy full model: %s", _full_attempts)


# ── 4. BERT transformer NER (dslim/bert-base-NER) ─────────────────────────────

bert_ner = None
try:
    from transformers import pipeline as _hf_pipeline  # type: ignore[import]

    bert_ner = _hf_pipeline(
        "token-classification",
        model="dslim/bert-base-NER",
        aggregation_strategy="simple",
    )
    logger.info("BERT NER (dslim/bert-base-NER) loaded successfully")
except Exception as exc:
    _load_errors["bert"] = str(exc)
    logger.warning("BERT NER unavailable, will fall back to spaCy only: %s", exc)


# ── Public helpers ─────────────────────────────────────────────────────────────

def is_ready() -> bool:
    """Return True only if analyzer, nlp_fast, and nlp_full all loaded."""
    return (
        analyzer is not None
        and nlp_fast is not None
        and nlp_full is not None
    )


def get_model_status() -> dict[str, Any]:
    """Return per-model load status and any error messages."""
    return {
        "presidio": analyzer is not None,
        "spacy_fast": nlp_fast is not None,
        "spacy_full": nlp_full is not None,
        "bert": bert_ner is not None,
        "errors": list(_load_errors.values()),
    }
