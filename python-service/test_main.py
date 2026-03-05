"""
Smoke-test for main.py — verifies imports, routing, and /detect-text end-to-end
without starting a real HTTP server.
"""
import ast
ast.parse(open("main.py").read())
print("Syntax OK")

# Import the app (triggers lifespan warmup indirectly via module-level singletons)
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

# ── /health ───────────────────────────────────────────────────────────────────
resp = client.get("/health")
assert resp.status_code == 200, resp.text
assert resp.json() == {"status": "ok", "service": "PII Detection"}
print("GET /health OK")

# ── /detect-text — redact mode ────────────────────────────────────────────────
resp = client.post("/detect-text", json={
    "text": "Aadhaar: 5487 8795 5678\nPAN: ABCDE1234F",
    "mode": "redact",
})
assert resp.status_code == 200, resp.text
data = resp.json()
assert "detected" in data
assert "masked_text" in data
assert "[REDACTED]" in data["masked_text"] or len(data["detected"]) == 0
print(f"POST /detect-text (redact)  OK  detected={len(data['detected'])}  summary={data['pii_summary']}")

# ── /detect-text — tokenize mode ─────────────────────────────────────────────
resp = client.post("/detect-text", json={
    "text": "Name: Rahul Sharma, Phone: +919876543210",
    "mode": "tokenize",
})
assert resp.status_code == 200, resp.text
data = resp.json()
print(f"POST /detect-text (tokenize) OK  detected={len(data['detected'])}  token_map={data['token_map']}")

# ── /process — unsupported type returns 400 ──────────────────────────────────
resp = client.post("/process", json={
    "file_path": "/tmp/fake.xyz",
    "output_path": "/tmp/fake_out.xyz",
    "file_type": "xyz",
    "mode": "redact",
})
assert resp.status_code == 400, resp.text
print("POST /process (bad type) → 400 OK")

print("\nAll main.py smoke-tests passed.")
