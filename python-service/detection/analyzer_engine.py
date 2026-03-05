"""
3-layer PII Analyzer Engine.

Layer 1 — Regex pattern matching  : custom PatternRecognizer classes
Layer 2 — Presidio + spaCy NLP    : AnalyzerEngine with en_core_web_sm
Layer 3 — indic-bert NER          : ai4bharat/indic-bert (optional, graceful fallback)

The module-level singleton `pii_analyzer` is created on import so the expensive
model loading happens once at service startup, not per request.
"""

from __future__ import annotations

import warnings
from typing import Any

from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider

from detection.custom_recognizers import get_all_entities, get_custom_recognizers
from detection.preprocessor import TextPreprocessor


class PIIAnalyzer:
    """
    Unified 3-layer PII detection pipeline.

    Instantiate once (module singleton) — model loading is expensive.
    Call `analyze(text)` per document/field value.
    """

    def __init__(self) -> None:
        # ── Layer 1 + 2: Presidio + spaCy ────────────────────────────────────
        nlp_configuration: dict[str, Any] = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }
        nlp_engine = NlpEngineProvider(nlp_configuration=nlp_configuration).create_engine()

        registry = RecognizerRegistry()
        registry.load_predefined_recognizers()
        for recognizer in get_custom_recognizers():
            registry.add_recognizer(recognizer)

        self.analyzer = AnalyzerEngine(
            nlp_engine=nlp_engine,
            registry=registry,
            supported_languages=["en"],
        )

        # ── Layer 3: indic-bert ───────────────────────────────────────────────
        # Force transformers to use PyTorch backend to avoid TensorFlow's
        # NumPy 2.x incompatibility (crashes before Python can catch the error).
        import os  # noqa: PLC0415
        os.environ.setdefault("USE_TF", "0")
        os.environ.setdefault("USE_TORCH", "1")
        try:
            from transformers import pipeline  # type: ignore[import]

            self.indic_ner = pipeline(
                "token-classification",
                model="ai4bharat/indic-bert",
                aggregation_strategy="simple",
            )
        except Exception:
            warnings.warn(
                "indic-bert unavailable, falling back to spaCy only",
                stacklevel=1,
            )
            self.indic_ner = None

        # ── Shared utilities ──────────────────────────────────────────────────
        self.preprocessor = TextPreprocessor()
        self.target_entities: list[str] = get_all_entities()

    # ─────────────────────────────────────────────────────────────────────────

    def analyze(self, text: str, language: str = "en") -> dict[str, Any]:
        """
        Run all three detection layers on *text*.

        Returns
        -------
        dict with keys:
          presidio_results : list[RecognizerResult]  (Layer 1+2)
          indic_results    : list[dict]              (Layer 3)
          label_pairs      : list[dict]              (preprocessor label hints)
          cleaned_text     : str                     (normalised input)
        """
        # Step 1: Normalise text
        cleaned = self.preprocessor.clean(text)

        # Step 2: Extract structural label-value hints (before Presidio so they
        #         can be used by downstream scoring / masking)
        label_pairs = self.preprocessor.extract_label_value_pairs(cleaned)

        # Step 3: Layer 1 + 2 — Presidio analysis
        presidio_results = self.analyzer.analyze(
            text=cleaned,
            language=language,
            entities=self.target_entities,
            return_decision_process=True,
        )
        # Annotate source so downstream consumers can distinguish layers
        for result in presidio_results:
            result.recognition_metadata["source"] = "presidio_spacy"  # type: ignore[index]

        # Filter spaCy false positives: label/field keywords (e.g. "Email",
        # "Phone", "Name") are sometimes tagged as PERSON/LOCATION by the small
        # spaCy model when they appear capitalised at the start of a field.
        # Also filter any NLP entity whose span crosses a newline — those
        # are almost always merges across structural boundaries.
        _nlp_types = {"PERSON", "LOCATION", "ORGANIZATION", "NRP"}
        _label_words: set[str] = {
            "email", "mail", "e-mail", "name", "address", "phone", "mobile",
            "contact", "cell", "pan", "aadhaar", "aadhar", "uid", "dob",
            "account", "ifsc", "upi", "vpa", "passport", "card", "date",
            "gender", "sex", "age", "id", "no", "number", "mob", "ph",
        }
        presidio_results = [
            r for r in presidio_results
            if not (
                r.entity_type in _nlp_types
                and (
                    cleaned[r.start : r.end].strip().lower() in _label_words
                    or "\n" in cleaned[r.start : r.end]
                )
            )
        ]

        # Step 4: Layer 3 — indic-bert NER
        indic_results: list[dict[str, Any]] = []
        if self.indic_ner is not None:
            raw = self.indic_ner(cleaned[:512])
            for entity in raw:
                group = entity.get("entity_group", "")
                if group in {"PER", "PERSON"}:
                    indic_results.append(
                        {
                            "type": "PERSON",
                            "value": entity["word"],
                            "start": entity["start"],
                            "end": entity["end"],
                            "score": float(entity["score"]),
                            "source": "indic_bert",
                        }
                    )
                elif group in {"LOC", "GPE"}:
                    indic_results.append(
                        {
                            "type": "LOCATION",
                            "value": entity["word"],
                            "start": entity["start"],
                            "end": entity["end"],
                            "score": float(entity["score"]),
                            "source": "indic_bert",
                        }
                    )

        # Step 5: Return combined results
        return {
            "presidio_results": presidio_results,
            "indic_results": indic_results,
            "label_pairs": label_pairs,
            "cleaned_text": cleaned,
        }


# ── Module-level singleton ────────────────────────────────────────────────────
# Loaded once at service startup (not per request).
pii_analyzer = PIIAnalyzer()

