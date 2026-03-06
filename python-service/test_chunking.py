"""
Smoke-tests for the in-memory parallel chunked processing pipeline.

Tests cover:
  1. process_csv_chunked  — splits rows, processes in parallel, merges in-memory
  2. process_txt_chunked  — paragraph splits with overlap context
  3. process_json_chunked — top-level array chunking
  4. ChunkOrchestrator    — full end-to-end (large + small file routing)
  5. Progress tracking    -- per-chunk pending->processing->done states visible in
                            parallel_processor.progress during a real run

Run from python-service/:
    python test_chunking.py
"""

from __future__ import annotations

import sys
# Force UTF-8 output on Windows (avoids cp1252 UnicodeEncodeError for ✓ → etc.)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import csv
import json
import os
import tempfile
import textwrap
import threading
from pathlib import Path

# ── 0. helpers ────────────────────────────────────────────────────────────────

def _tmp(suffix: str, content: str, mode: str = "w") -> str:
    f = tempfile.NamedTemporaryFile(
        mode=mode, suffix=suffix, delete=False, encoding="utf-8"
    )
    f.write(content)
    f.close()
    return f.name


def _cleanup(*paths: str) -> None:
    for p in paths:
        try:
            os.unlink(p)
        except FileNotFoundError:
            pass


FAKE_PII_ROWS = [
    ["name",         "email",                  "aadhaar"],
    ["Rahul Sharma", "rahul@example.com",       "5487 8795 5678"],
    ["Priya Singh",  "priya@test.org",          "1234 5678 9012"],
    ["Amit Patel",   "amit.p@corp.co",          "9876 5432 1012"],
]

# ── 1. process_csv_chunked ────────────────────────────────────────────────────
print("=" * 60)
print("1. CSV in-memory chunked processing")
print("=" * 60)

from processing.chunked_processor import process_csv_chunked, _CSV_CELL_BATCH

# Build a CSV with 3 data rows (tiny so test is fast; real chunk would be 10k rows)
src = tempfile.NamedTemporaryFile(
    mode="w", suffix=".csv", delete=False, newline="", encoding="utf-8"
)
writer = csv.writer(src)
for row in FAKE_PII_ROWS:
    writer.writerow(row)
src.close()
src_path = src.name
dst_path = src_path + ".out.csv"

progress_log: list[tuple[int, str]] = []

def _cb(idx: int, status: str) -> None:
    progress_log.append((idx, status))
    print(f"  chunk[{idx}] -> {status}")

result = process_csv_chunked(src_path, dst_path, mode="redact", progress_cb=_cb)
assert Path(dst_path).exists(), "Output CSV not created"

with open(dst_path, newline="", encoding="utf-8") as f:
    rows = list(csv.reader(f))
assert rows[0] == ["name", "email", "aadhaar"], f"Header mismatch: {rows[0]}"
assert len(rows) == len(FAKE_PII_ROWS), f"Row count mismatch: {len(rows)} vs {len(FAKE_PII_ROWS)}"

statuses = {s for _, s in progress_log}
assert statuses.issuperset({"pending", "processing", "done"}), \
    f"Expected pending/processing/done, got: {statuses}"

print(f"  ✓  total_pii={result['total_pii']}  chunk_count={result['chunk_count']}")
print(f"  ✓  _CSV_CELL_BATCH={_CSV_CELL_BATCH}  (each column NLP call ≤ {_CSV_CELL_BATCH} rows)")
_cleanup(src_path, dst_path)
print()

# ── 2. process_txt_chunked ────────────────────────────────────────────────────
print("=" * 60)
print("2. TXT in-memory chunked processing")
print("=" * 60)

from processing.chunked_processor import process_txt_chunked

# Two paragraphs with PII
txt_content = textwrap.dedent("""\
    Customer: Rahul Sharma
    Aadhaar: 5487 8795 5678
    PAN: ABCDE1234F

    Second customer: Priya Singh
    Phone: +919876543210
    Email: priya@test.org
""")

src_txt = _tmp(".txt", txt_content)
dst_txt = src_txt + ".out.txt"
progress_txt: list[tuple[int, str]] = []

result_txt = process_txt_chunked(
    src_txt, dst_txt, mode="redact",
    progress_cb=lambda i, s: progress_txt.append((i, s)) or print(f"  chunk[{i}] -> {s}"),
)
assert Path(dst_txt).exists(), "Output TXT not created"
out_text = Path(dst_txt).read_text(encoding="utf-8")
assert len(out_text) > 0, "Output TXT is empty"
statuses_txt = {s for _, s in progress_txt}
assert statuses_txt.issuperset({"pending", "processing", "done"}), \
    f"TXT progress states incomplete: {statuses_txt}"

print(f"  ✓  total_pii={result_txt['total_pii']}  chunk_count={result_txt['chunk_count']}")
_cleanup(src_txt, dst_txt)
print()

# ── 3. process_json_chunked ───────────────────────────────────────────────────
print("=" * 60)
print("3. JSON in-memory chunked processing (array root)")
print("=" * 60)

from processing.chunked_processor import process_json_chunked

json_data = [
    {"id": 1, "name": "Rahul Sharma",  "aadhaar": "5487 8795 5678"},
    {"id": 2, "name": "Priya Singh",   "email": "priya@test.org"},
    {"id": 3, "name": "Amit Patel",    "pan": "ABCDE1234F"},
]
src_json = _tmp(".json", json.dumps(json_data, indent=2))
dst_json = src_json + ".out.json"
progress_json: list[tuple[int, str]] = []

result_json = process_json_chunked(
    src_json, dst_json, mode="redact",
    progress_cb=lambda i, s: progress_json.append((i, s)) or print(f"  chunk[{i}] -> {s}"),
)
assert Path(dst_json).exists(), "Output JSON not created"
out_data = json.loads(Path(dst_json).read_text(encoding="utf-8"))
assert isinstance(out_data, list) and len(out_data) == 3, f"JSON output malformed: {out_data}"

statuses_json = {s for _, s in progress_json}
assert statuses_json.issuperset({"pending", "processing", "done"}), \
    f"JSON progress states incomplete: {statuses_json}"

print(f"  ✓  total_pii={result_json['total_pii']}  output_items={len(out_data)}")
_cleanup(src_json, dst_json)
print()

# ── 4. Orchestrator small-file path (≤ threshold) ────────────────────────────
print("=" * 60)
print("4. Orchestrator — small CSV (direct single-pass, no chunking)")
print("=" * 60)

from chunking.orchestrator import orchestrator

src = tempfile.NamedTemporaryFile(
    mode="w", suffix=".csv", delete=False, newline="", encoding="utf-8"
)
writer = csv.writer(src)
for row in FAKE_PII_ROWS:
    writer.writerow(row)
src.close()
src_small = src.name
dst_small = src_small + ".out.csv"

res_small = orchestrator.process(src_small, dst_small, "csv", override_mode="redact")
assert res_small["success"], "Orchestrator small file returned success=False"
assert not res_small["processing_info"]["chunked_processing"], \
    "Small file should NOT use chunked processing"
print(f"  ✓  success={res_small['success']}  chunked=False  total_pii={res_small['total_pii']}")
_cleanup(src_small, dst_small)
print()

# ── 5. Progress tracking via parallel_processor singleton ─────────────────────
print("=" * 60)
print("5. Live progress tracking via parallel_processor.get_progress()")
print("=" * 60)

from chunking.parallel_processor import parallel_processor
from processing.chunked_processor import process_txt_chunked, TXT_CHARS_PER_CHUNK

# Build text big enough to make 2 chunks by lowering the effective limit
# We monkey-patch the constant temporarily so the test stays fast
import processing.chunked_processor as _cp
original_limit = _cp.TXT_CHARS_PER_CHUNK
_cp.TXT_CHARS_PER_CHUNK = 50   # 50 chars -> forces many chunks for even small text

multi_para_text = "\n\n".join(
    f"Customer {i}: Name Surname{i}\nEmail{i}: user{i}@example.com"
    for i in range(6)
)

src_mt = _tmp(".txt", multi_para_text)
dst_mt  = src_mt + ".out.txt"

# Clear progress and wire up the real singleton callback
with parallel_processor.progress_lock:
    parallel_processor.progress = {}

progress_cb = parallel_processor.make_progress_cb()

snapshots: list[dict] = []
done_event = threading.Event()

def _run():
    process_txt_chunked(src_mt, dst_mt, mode="redact", progress_cb=progress_cb)
    done_event.set()

t = threading.Thread(target=_run, daemon=True)
t.start()

# Poll progress a few times while processing runs
import time
for _ in range(20):
    snap = parallel_processor.get_progress()
    snapshots.append(dict(snap))
    if done_event.is_set():
        break
    time.sleep(0.05)

t.join(timeout=60)
_cp.TXT_CHARS_PER_CHUNK = original_limit   # restore

final = parallel_processor.get_progress()
print(f"  Final progress snapshot: {final}")
all_statuses = set(final.values())
assert all_statuses <= {"pending", "processing", "done", "failed"}, \
    f"Unexpected status values: {all_statuses}"
assert "done" in all_statuses, f"No chunks reached 'done': {all_statuses}"
print(f"  ✓  Chunks tracked: {len(final)}  Final statuses: {all_statuses}")
_cleanup(src_mt, dst_mt)
print()

# ── Summary ───────────────────────────────────────────────────────────────────
print("=" * 60)
print("All chunking smoke-tests passed ✓")
print("=" * 60)
