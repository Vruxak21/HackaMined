"""Smoke-tests for PIIMasker."""
import ast
ast.parse(open("detection/masker.py").read())
print("Syntax OK")

from detection.masker import PIIMasker, pii_masker

m = PIIMasker()

def span(type_, start, end):
    return {"type": type_, "start": start, "end": end}

# ── get_partial_mask ──────────────────────────────────────────────────────────
cases = [
    ("EMAIL_ADDRESS",  "rahul.sharma@gmail.com",  "r***@g***.com"),
    ("IN_PHONE",       "+919876543210",            "9876******"),
    ("PHONE_NUMBER",   "09876543210",              "9876******"),
    ("CREDIT_CARD",    "4111 1111 1111 1234",      "**** **** **** 1234"),
    ("AADHAAR",        "5487 8795 9012",           "**** **** 9012"),
    ("PAN",            "ABCDE1234F",               "AB***4F"),
    ("PERSON",         "Rahul Sharma",             "Rahul S****"),
    ("PERSON",         "Madonna",                  "M****"),
    ("DATE_TIME",      "12/05/1997",               "**/*/1997"),  # approximate
    ("ACCOUNT_NUMBER", "123456781234",             "********1234"),
    ("LOCATION",       "123 MG Road, Bengaluru",   "[STREET REDACTED], Bengaluru"),
    ("LOCATION",       "Bengaluru",                "[REDACTED]"),
    ("UPI",            "rahul@oksbi",              "[REDACTED]"),
]
for entity_type, value, expected in cases:
    result = m.get_partial_mask(value, entity_type)
    # For DATE_TIME just check pattern
    if entity_type == "DATE_TIME":
        assert "1997" in result, f"DATE_TIME: {result!r} should contain year"
    else:
        assert result == expected, f"{entity_type} {value!r}: got {result!r}, want {expected!r}"
print("get_partial_mask OK")

# ── get_token ─────────────────────────────────────────────────────────────────
m.reset_counters()
assert m.get_token("AADHAAR") == "<<AADHAAR_001>>"
assert m.get_token("AADHAAR") == "<<AADHAAR_002>>"
assert m.get_token("PERSON")  == "<<PERSON_001>>"
m.reset_counters()
assert m.get_token("AADHAAR") == "<<AADHAAR_001>>"   # reset worked
print("get_token OK")

# ── mask — redact mode ────────────────────────────────────────────────────────
text = "Name: Rahul Sharma, Aadhaar: 5487 8795 9012"
spans = [
    span("PERSON",  6, 18),
    span("AADHAAR", 29, 43),
]
out = m.mask(text, spans, mode="redact")
assert "[REDACTED]" in out["masked_text"]
assert out["token_map"] == {}
assert "Rahul" not in out["masked_text"]
assert "5487" not in out["masked_text"]
print("redact mode OK")

# ── mask — mask mode ──────────────────────────────────────────────────────────
out = m.mask(text, spans, mode="mask")
assert "R****" in out["masked_text"] or "Rahul S****" in out["masked_text"]
assert "**** **** 9012" in out["masked_text"]
print("mask mode OK")

# ── mask — tokenize mode ──────────────────────────────────────────────────────
out = m.mask(text, spans, mode="tokenize")
assert "<<PERSON_001>>" in out["masked_text"]
assert "<<AADHAAR_001>>" in out["masked_text"]
assert out["token_map"]["<<PERSON_001>>"] == "Rahul Sharma"
assert out["token_map"]["<<AADHAAR_001>>"] == "5487 8795 9012"
print("tokenize mode OK")

# ── reverse-order preservation ────────────────────────────────────────────────
text2 = "Phone: +919876543210 and PAN: ABCDE1234F"
spans2 = [
    span("IN_PHONE", 7, 20),
    span("PAN",      30, 40),
]
out2 = m.mask(text2, spans2, mode="redact")
assert out2["masked_text"].count("[REDACTED]") == 2
print("reverse-order preservation OK")

# ── singleton ─────────────────────────────────────────────────────────────────
assert pii_masker is not None
print("singleton OK")

print("\nAll masker tests passed.")
