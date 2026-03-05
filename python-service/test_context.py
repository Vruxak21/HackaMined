"""Smoke-test for ContextAnalyzer."""
import ast, sys
ast.parse(open("detection/context_analyzer.py").read())
print("Syntax OK")

from detection.context_analyzer import context_analyzer, ContextAnalyzer, LABEL_BOOST, PROXIMITY_BOOST

ca = ContextAnalyzer()

# ── Helpers to build minimal fake results ─────────────────────────────────────
def make(type_, start, end, score, source="test"):
    return {
        "type": type_, "value": "X", "start": start, "end": end,
        "score": score, "source": source,
        "label_boosted": False, "proximity_boosted": False,
        "slide6_boosted": False, "column_name_boosted": False,
        "density_boosted": False, "standalone_non_pii": False,
        "linked_to_identity": False,
    }

# ── 1. boost_with_labels ──────────────────────────────────────────────────────
results = [make("AADHAAR", 10, 28, 0.75)]
label_pairs = [{"entity_type": "AADHAAR", "label_end": 8, "value_start": 10}]
out = ca.boost_with_labels(results, label_pairs)
assert out[0]["label_boosted"] is True
assert abs(out[0]["score"] - (0.75 + LABEL_BOOST)) < 1e-9
print("boost_with_labels OK")

# ── 2. boost_with_proximity ───────────────────────────────────────────────────
results = [
    make("AADHAAR", 0, 14, 0.75),
    make("PAN", 20, 30, 0.75),
    make("IN_PHONE", 40, 55, 0.75),
    make("EMAIL_ADDRESS", 300, 320, 0.75),   # isolated
]
out = ca.boost_with_proximity(results)
clustered = [r for r in out if r["start"] < 100]
isolated  = [r for r in out if r["start"] >= 300]
assert all(r["proximity_boosted"] for r in clustered), "cluster should be boosted"
assert not isolated[0]["proximity_boosted"], "isolated should NOT be boosted"
print("boost_with_proximity OK")

# ── 3. apply_slide6_rule ──────────────────────────────────────────────────────
text = "A" * 600
results = [
    make("PERSON",       0,  20, 0.90),   # identity anchor
    make("AADHAAR",     50,  65, 0.65),   # uncertain, in zone → boosted
    make("CVV",        550, 555, 0.45),   # low-score, in zone (anchor goes to 0+300=300... wait 300<550 → NOT in zone)
    make("ACCOUNT_NUMBER", 100, 115, 0.40),  # low-score, in zone → boosted to 0.70
]
out = ca.apply_slide6_rule(text, results)
by_type = {r["type"]: r for r in out}
assert by_type["AADHAAR"]["slide6_boosted"] is True, "uncertain in zone should be boosted"
assert abs(by_type["AADHAAR"]["score"] - 0.85) < 1e-9
assert by_type["CVV"]["standalone_non_pii"] is True, "out-of-zone low-score → standalone"
assert by_type["ACCOUNT_NUMBER"]["slide6_boosted"] is True, "in-zone low-score → boosted to 0.70"
assert abs(by_type["ACCOUNT_NUMBER"]["score"] - 0.70) < 1e-9
print("apply_slide6_rule OK")

# ── 4. check_sentence_density ─────────────────────────────────────────────────
text = "Aadhaar 5487 8795 5678, PAN ABCDE1234F, phone +919876543210."
results = [
    make("AADHAAR",   8, 23, 0.75),
    make("PAN",      29, 39, 0.75),
    make("IN_PHONE", 47, 62, 0.75),
]
out = ca.check_sentence_density(text, results)
assert all(r["density_boosted"] for r in out), "dense sentence should boost all"
print("check_sentence_density OK")

# ── 5. analyze_column_context ─────────────────────────────────────────────────
results = [make("AADHAAR", 0, 14, 0.70), make("PAN", 20, 30, 0.70)]
out = ca.analyze_column_context("aadhaar_no", results, results)
by_type = {r["type"]: r for r in out}
assert by_type["AADHAAR"]["column_name_boosted"] is True
assert abs(by_type["AADHAAR"]["score"] - 0.95) < 1e-9
assert not by_type["PAN"]["column_name_boosted"]
print("analyze_column_context OK")

# ── 6. singleton exists ───────────────────────────────────────────────────────
from detection.context_analyzer import context_analyzer
assert context_analyzer is not None
print("singleton OK")

print("\nAll context_analyzer tests passed.")
