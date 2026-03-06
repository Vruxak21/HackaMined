"""
Chunked processing test suite.

Run from the python-service/ directory:
    python tests/test_chunked_processing.py
"""

from __future__ import annotations

import csv
import os
import random
import re
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

# ── Ensure python-service/ is importable ─────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent   # python-service/
sys.path.insert(0, str(ROOT))

# ── Ensure /tmp (C:\tmp on Windows) exists — chunkers write there ─────────────
_POSIX_TMP = Path("/tmp")
_POSIX_TMP.mkdir(parents=True, exist_ok=True)

# ── Imports under test ────────────────────────────────────────────────────────
from chunking.config import (       # noqa: E402
    FILE_SIZE_THRESHOLD_MB,
    MAX_FILE_SIZE_BYTES,
    needs_chunking,
    validate_file_size,
)
from chunking.csv_chunker import CSVChunker   # noqa: E402
from chunking.sql_chunker import SQLChunker   # noqa: E402
from chunking.orchestrator import orchestrator  # noqa: E402

# ── Shared temp-file paths (mirror the /tmp convention used by the chunkers) ──
SQL_PATH     = str(_POSIX_TMP / "test_large.sql")
CSV_PATH     = str(_POSIX_TMP / "test_large.csv")
CSV_OUT_PATH = str(_POSIX_TMP / "test_large_out.csv")
SMALL_PATH   = str(_POSIX_TMP / "test_small.txt")
SMALL_OUT    = str(_POSIX_TMP / "test_small_out.txt")

# ── CSV schema (15 columns → ~230 chars/row → ~11.5 MB for 50 000 rows) ───────
CSV_HEADER = [
    "id", "full_name", "email", "phone", "alt_phone",
    "aadhaar", "pan", "dob", "gender",
    "address", "city", "state", "pincode",
    "account_number", "ifsc",
]

_FIRST = [
    "Rahul", "Priya", "Amit", "Sneha", "Vikram",
    "Pooja", "Arjun", "Kavya", "Rohan", "Ananya",
    "Sanjay", "Deepika", "Nikhil", "Ritu", "Arun",
    "Pallavi", "Suresh", "Lakshmi", "Raj", "Nisha",
]
_LAST = [
    "Sharma", "Patel", "Singh", "Gupta", "Kumar",
    "Mehta", "Verma", "Nair", "Reddy", "Joshi",
    "Iyer", "Pillai", "Rao", "Choudhary", "Banerjee",
    "Mishra", "Tiwari", "Pandey", "Shah", "Bose",
]
_DOMAINS  = ["gmail.com", "yahoo.co.in", "outlook.com", "rediffmail.com", "hotmail.com"]
_CITIES   = ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad"]
_STATES   = [
    "Maharashtra", "Uttar Pradesh", "Karnataka", "Telangana",
    "Tamil Nadu", "West Bengal", "Gujarat", "Rajasthan",
]
_STREETS  = [
    "MG Road Sector 15", "Park Street Block C", "Nehru Nagar Phase II",
    "Jubilee Hills Road No 45", "Anna Salai 2nd Cross", "Salt Lake Sector V",
    "Banjara Hills Rd 36", "Koregaon Park Lane 7", "Vasant Kunj C Pocket",
    "Whitefield Main Road IT Park",
]
_BANKS    = ["SBIN", "HDFC", "ICIC", "AXIS", "KOTAK", "IDBI", "CANR", "PUNB"]
_ALPHA    = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_GENDERS  = ["Male", "Female"]


def _make_row(i: int) -> list:
    first   = random.choice(_FIRST)
    last    = random.choice(_LAST)
    email   = f"{first.lower()}.{last.lower()}{i}@{random.choice(_DOMAINS)}"
    phone   = f"+91 9{random.randint(100_000_000, 999_999_999)}"
    alt     = f"+91 8{random.randint(100_000_000, 999_999_999)}"
    aadhaar = (
        f"{random.randint(1000, 9999)} "
        f"{random.randint(1000, 9999)} "
        f"{random.randint(1000, 9999)}"
    )
    pan     = (
        f"{''.join(random.choices(_ALPHA, k=5))}"
        f"{random.randint(1000, 9999)}"
        f"{random.choice(_ALPHA)}"
    )
    dob     = (
        f"{random.randint(1960, 2000)}-"
        f"{random.randint(1, 12):02d}-"
        f"{random.randint(1, 28):02d}"
    )
    gender  = random.choice(_GENDERS)
    house   = random.randint(1, 999)
    floor_n = random.randint(1, 15)
    block   = random.choice(list("ABCDEF"))
    address = f"Flat {house} Floor {floor_n} Block {block} {random.choice(_STREETS)}"
    city    = random.choice(_CITIES)
    state   = random.choice(_STATES)
    pincode = str(random.randint(100_000, 999_999))
    acct    = str(random.randint(10 ** 14, 10 ** 15 - 1))
    ifsc    = f"{random.choice(_BANKS)}0{random.randint(100_000, 999_999)}"
    return [
        i, f"{first} {last}", email, phone, alt, aadhaar, pan, dob,
        gender, address, city, state, pincode, acct, ifsc,
    ]


def _generate_large_csv(path: str = CSV_PATH, rows: int = 50_000) -> None:
    """Write *rows* rows of synthetic Indian PII data to *path*."""
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_HEADER)
        for i in range(1, rows + 1):
            writer.writerow(_make_row(i))


# ── Test runner helpers ───────────────────────────────────────────────────────

_passed: int = 0
_failed: int = 0
_errors: list[str] = []


def _run(name: str, fn) -> None:
    global _passed, _failed
    try:
        fn()
        _passed += 1
    except Exception as exc:
        _failed += 1
        _errors.append(f"  ✗ {name}: {exc}")


# =============================================================================
# Test 1 — File size validation
# =============================================================================

def test_file_size_validation() -> None:
    # Create a real (empty) file so os.path.exists checks inside the functions
    # won't fail; the actual size is provided by the mock.
    probe = str(_POSIX_TMP / "mock_probe.bin")
    Path(probe).write_bytes(b"")
    try:
        # validate_file_size: 1 MB → within 100 MB limit → True
        with patch("os.path.getsize", return_value=1 * 1024 * 1024):
            assert validate_file_size(probe) is True

        # validate_file_size: 101 MB → exceeds 100 MB limit → False
        with patch("os.path.getsize", return_value=101 * 1024 * 1024):
            assert validate_file_size(probe) is False

        # needs_chunking: 1 MB — below 10 MB threshold → False
        with patch("os.path.getsize", return_value=1 * 1024 * 1024):
            assert needs_chunking(probe) is False

        # needs_chunking: 50 MB — above 10 MB threshold → True
        with patch("os.path.getsize", return_value=50 * 1024 * 1024):
            assert needs_chunking(probe) is True

    finally:
        Path(probe).unlink(missing_ok=True)

    print("✓ File size validation works")


# =============================================================================
# Test 2 — SQL chunking
# =============================================================================

def test_sql_chunking() -> None:
    # Generate 2000 INSERT statements  (2000 / 500 = exactly 4 chunks)
    with open(SQL_PATH, "w", encoding="utf-8") as fh:
        for i in range(1, 2001):
            fh.write(
                f"INSERT INTO users (id, name, email) "
                f"VALUES ({i}, 'User{i}', 'user{i}@example.com');\n"
            )

    chunker = SQLChunker()
    chunks  = chunker.split(SQL_PATH)

    try:
        assert len(chunks) == 4, f"Expected 4 chunks, got {len(chunks)}"

        for meta in chunks:
            assert os.path.exists(meta.temp_input_path), (
                f"Chunk {meta.chunk_index} temp file missing: {meta.temp_input_path}"
            )
            content = Path(meta.temp_input_path).read_text(encoding="utf-8")
            assert "INSERT" in content, f"Chunk {meta.chunk_index} has no INSERT statements"
            assert ";"       in content, f"Chunk {meta.chunk_index} has no semicolons"

        print(f"✓ SQL split into {len(chunks)} chunks")
    finally:
        chunker.cleanup(chunks)


# =============================================================================
# Test 3 — CSV chunking
# =============================================================================

def test_csv_chunking() -> None:
    _generate_large_csv()
    size_mb = os.path.getsize(CSV_PATH) / (1024 * 1024)

    chunker = CSVChunker()
    chunks  = chunker.split(CSV_PATH)

    try:
        # 50 000 rows / 10 000 rows-per-chunk = exactly 5 chunks
        assert len(chunks) == 5, f"Expected 5 chunks, got {len(chunks)}"

        for meta in chunks:
            with open(meta.temp_input_path, newline="", encoding="utf-8") as fh:
                rows = list(csv.reader(fh))

            # Header must be present and intact in every chunk
            assert rows[0] == CSV_HEADER, (
                f"Header mismatch in chunk {meta.chunk_index}: {rows[0]}"
            )

            # Each chunk carries exactly 10 000 data rows
            data_rows = rows[1:]
            assert len(data_rows) == 10_000, (
                f"Chunk {meta.chunk_index}: expected 10000 rows, got {len(data_rows)}"
            )

        print(f"✓ CSV split into {len(chunks)} chunks  ({size_mb:.1f} MB)")
    finally:
        chunker.cleanup(chunks)


# =============================================================================
# Test 4 — Full orchestration: small file (direct processing path)
# =============================================================================

def test_orchestrator_small_file() -> None:
    Path(SMALL_PATH).write_text(
        "Rahul Sharma, aadhaar 5487 8795 5678, "
        "email rahul@gmail.com, pan ABCPS1234D",
        encoding="utf-8",
    )

    result = orchestrator.process(SMALL_PATH, SMALL_OUT, "txt")

    assert result["success"] is True, (
        f"Processing failed: {result.get('error')}"
    )
    assert result["total_pii"] > 0, (
        "Expected PII detections in test text, got 0"
    )
    assert result["processing_info"]["chunked_processing"] is False, (
        "Small file should use direct (non-chunked) processing"
    )

    print("✓ Small file direct processing works")


# =============================================================================
# Test 5 — Full orchestration: large file (chunked processing path)
# =============================================================================

_AADHAAR_RE = re.compile(r"\b\d{4}[ \-]\d{4}[ \-]\d{4}\b")
_EMAIL_RE   = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")


def test_orchestrator_large_file() -> None:
    if not os.path.exists(CSV_PATH):
        raise RuntimeError(
            f"{CSV_PATH} not found — test_csv_chunking must run first"
        )

    size_mb = os.path.getsize(CSV_PATH) / (1024 * 1024)
    assert size_mb > FILE_SIZE_THRESHOLD_MB, (
        f"Test CSV is only {size_mb:.1f} MB — must exceed {FILE_SIZE_THRESHOLD_MB} MB "
        f"to trigger chunked processing. Re-generate with more/larger rows."
    )

    # Snapshot original row/column counts for later comparison
    with open(CSV_PATH, newline="", encoding="utf-8") as fh:
        orig_rows = list(csv.reader(fh))
    orig_header = orig_rows[0]
    orig_count  = len(orig_rows) - 1   # exclude header

    result = orchestrator.process(CSV_PATH, CSV_OUT_PATH, "csv")

    assert result["success"] is True, (
        f"Large file processing failed: {result.get('error')}"
    )
    assert result["processing_info"]["chunked_processing"] is True, (
        "Large file should use chunked processing"
    )
    assert result["processing_info"]["total_chunks"] > 1, (
        f"Expected multiple chunks, got {result['processing_info']['total_chunks']}"
    )

    # ── Output structure verification ─────────────────────────────────────────
    with open(CSV_OUT_PATH, newline="", encoding="utf-8") as fh:
        out_rows = list(csv.reader(fh))

    out_header = out_rows[0]
    out_count  = len(out_rows) - 1

    assert out_count == orig_count, (
        f"Row count mismatch: original={orig_count}, output={out_count}"
    )
    assert len(out_header) == len(orig_header), (
        f"Column count differs: original={len(orig_header)}, output={len(out_header)}"
    )
    assert out_header == orig_header, (
        f"Header changed after processing:\n  expected: {orig_header}\n  got:      {out_header}"
    )

    # ── PII masking verification ──────────────────────────────────────────────
    aadhaar_hits = 0
    email_hits   = 0
    for row in out_rows[1:]:
        row_str       = ",".join(row)
        aadhaar_hits += len(_AADHAAR_RE.findall(row_str))
        email_hits   += len(_EMAIL_RE.findall(row_str))

    assert aadhaar_hits == 0, (
        f"Aadhaar patterns still present in output ({aadhaar_hits} occurrences found)"
    )
    assert email_hits == 0, (
        f"Email patterns still present in output ({email_hits} occurrences found)"
    )

    print(f"✓ Large file chunked processing works")
    print(f"  Chunks: {result['processing_info']['total_chunks']}")
    print(f"  PII found: {result['total_pii']}")


# =============================================================================
# Test 6 — Merge integrity
# =============================================================================

def test_merge_integrity() -> None:
    for path, label in [(CSV_PATH, "original"), (CSV_OUT_PATH, "output")]:
        if not os.path.exists(path):
            raise RuntimeError(
                f"Missing {label} file ({path}) — run prior tests first"
            )

    with open(CSV_PATH, newline="", encoding="utf-8") as fh:
        orig_rows = list(csv.reader(fh))
    with open(CSV_OUT_PATH, newline="", encoding="utf-8") as fh:
        out_rows  = list(csv.reader(fh))

    orig_data = orig_rows[1:]
    out_data  = out_rows[1:]

    # Row count must match exactly
    assert len(orig_data) == len(out_data), (
        f"Row count mismatch: orig={len(orig_data)}, output={len(out_data)}"
    )

    # Header row identical
    assert orig_rows[0] == out_rows[0], (
        f"Header rows differ:\n  orig:   {orig_rows[0]}\n  output: {out_rows[0]}"
    )

    # Last row must be complete (same column count as header — not truncated)
    assert len(out_data[-1]) == len(orig_rows[0]), (
        f"Last output row is incomplete "
        f"({len(out_data[-1])} cols, expected {len(orig_rows[0])}): {out_data[-1]}"
    )

    print("✓ Merge integrity verified")


# =============================================================================
# Runner
# =============================================================================

_TESTS: list[tuple[str, object]] = [
    ("File size validation",        test_file_size_validation),
    ("SQL chunking",                test_sql_chunking),
    ("CSV chunking",                test_csv_chunking),
    ("Orchestrator – small file",   test_orchestrator_small_file),
    ("Orchestrator – large file",   test_orchestrator_large_file),
    ("Merge integrity",             test_merge_integrity),
]

if __name__ == "__main__":
    print("=" * 60)
    print("Chunked Processing Test Suite")
    print("=" * 60)
    print()

    for _name, _fn in _TESTS:
        _run(_name, _fn)

    total = len(_TESTS)
    print()
    if _errors:
        print("Failures:")
        for _err in _errors:
            print(_err)
        print()

    print(f"Chunked Processing Tests: {_passed}/{total} passed")
