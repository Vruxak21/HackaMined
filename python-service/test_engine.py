"""Smoke-test for PIIAnalyzer (analyzer_engine.py)."""
import warnings
warnings.filterwarnings("always")

from detection.analyzer_engine import pii_analyzer  # noqa: E402  (singleton loads here)

print("PIIAnalyzer loaded")
print(f"  indic_ner available : {pii_analyzer.indic_ner is not None}")
print(f"  target_entities     : {len(pii_analyzer.target_entities)}")

samples = [
    "Aadhaar: 5487 8795 5678",
    "PAN: ABCDE1234F",
    "Phone: +919876543210",
    "Email: john.doe@example.com",
    "IFSC: SBIN0001234",
]

for text in samples:
    result = pii_analyzer.analyze(text)
    hits = [(r.entity_type, round(r.score, 2)) for r in result["presidio_results"]]
    lp   = [(p["entity_type"], p["value"]) for p in result["label_pairs"]]
    print(f"\n  INPUT : {text!r}")
    print(f"  presidio: {hits}")
    print(f"  label_pairs: {lp}")
    print(f"  indic_bert: {result['indic_results']}")
    print(f"  cleaned: {result['cleaned_text']!r}")

print("\nAll OK")
