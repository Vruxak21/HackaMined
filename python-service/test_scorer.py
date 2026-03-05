"""Smoke-tests for ConfidenceScorer."""
import ast
ast.parse(open("detection/confidence_scorer.py").read())
print("Syntax OK")

from detection.confidence_scorer import (
    ConfidenceScorer, confidence_scorer,
    HIGH_CONFIDENCE, MEDIUM_CONFIDENCE, LOW_CONFIDENCE,
)

cs = ConfidenceScorer()

def make(type_, start, end, score, standalone=False, source="presidio_spacy"):
    return {
        "type": type_, "value": "X", "start": start, "end": end,
        "score": score, "source": source,
        "standalone_non_pii": standalone,
    }

# ── score_and_filter ──────────────────────────────────────────────────────────
results = [
    make("AADHAAR",  0, 14, 0.95),            # high
    make("PAN",     20, 30, 0.75),            # medium
    make("CVV",     40, 43, 0.40),            # low (score)
    make("ACCOUNT_NUMBER", 50, 60, 0.80, standalone=True),  # low (standalone)
]
out = cs.score_and_filter(results)
assert out["high_count"] == 1, out
assert out["medium_count"] == 1, out
assert out["low_count"] == 2, out
assert len(out["to_mask"]) == 2
assert len(out["low_confidence"]) == 2
print("score_and_filter OK")

# ── deduplicate ───────────────────────────────────────────────────────────────
# Case 1: no overlap — both kept
results = [make("A", 0, 10, 0.80), make("B", 15, 25, 0.80)]
out = cs.deduplicate(results)
assert len(out) == 2
# Case 2: full overlap, second is higher → second wins
results = [make("A", 0, 10, 0.70), make("B", 5, 15, 0.90)]
out = cs.deduplicate(results)
assert len(out) == 1 and out[0]["type"] == "B", out
# Case 3: full overlap, first is higher → first wins
results = [make("A", 0, 10, 0.95), make("B", 5, 15, 0.70)]
out = cs.deduplicate(results)
assert len(out) == 1 and out[0]["type"] == "A", out
# Case 4: adjacent but not overlapping — both kept
results = [make("A", 0, 10, 0.80), make("B", 10, 20, 0.80)]
out = cs.deduplicate(results)
assert len(out) == 2
print("deduplicate OK")

# ── get_summary ───────────────────────────────────────────────────────────────
results = [
    make("AADHAAR", 0, 14, 0.95),
    make("AADHAAR", 20, 34, 0.90),
    make("PAN",     40, 50, 0.85),
]
summary = cs.get_summary(results)
assert summary == {"AADHAAR": 2, "PAN": 1}, summary
print("get_summary OK")

# ── get_layer_breakdown ───────────────────────────────────────────────────────
results = [
    make("A", 0, 5, 0.9, source="regex"),
    make("B", 10, 15, 0.9, source="presidio_spacy"),
    make("C", 20, 25, 0.9, source="indic_bert"),
    make("D", 30, 35, 0.9, source="unknown_layer"),  # → presidio_spacy bucket
]
bd = cs.get_layer_breakdown(results)
assert bd["regex"] == 1
assert bd["presidio_spacy"] == 2   # 1 real + 1 unknown
assert bd["indic_bert"] == 1
print("get_layer_breakdown OK")

# ── get_confidence_breakdown ──────────────────────────────────────────────────
cbd = cs.get_confidence_breakdown(5, 3)
assert cbd == {"high_confidence": 5, "medium_confidence": 3}
print("get_confidence_breakdown OK")

# ── singleton ─────────────────────────────────────────────────────────────────
assert confidence_scorer is not None
print("singleton OK")

print("\nAll confidence_scorer tests passed.")
