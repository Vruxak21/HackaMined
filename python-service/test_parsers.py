"""
Smoke-tests for parsers that don't require binary dependencies
(SQL, TXT, JSON) using temp files and the real detection pipeline.
"""
import json, os, tempfile, pathlib

# ── SQL parser ────────────────────────────────────────────────────────────────
from parsers.sql_parser import process_sql

sql = "INSERT INTO users VALUES ('Rahul Sharma', '5487 8795 5678', 'ABCDE1234F');"
with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", delete=False, encoding="utf-8") as f:
    f.write(sql); src_sql = f.name
dst_sql = src_sql + ".out.sql"
result = process_sql(src_sql, dst_sql, mode="redact")
out_text = pathlib.Path(dst_sql).read_text(encoding="utf-8")
print(f"SQL parser OK  total_pii={result['total_pii']}  output_len={len(out_text)}")
os.unlink(src_sql); os.unlink(dst_sql)

# ── TXT parser ────────────────────────────────────────────────────────────────
from parsers.txt_parser import process_txt

txt = "Name: Rahul Sharma\nAadhaar: 5487 8795 5678\nPAN: ABCDE1234F"
with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
    f.write(txt); src_txt = f.name
dst_txt = src_txt + ".out.txt"
result = process_txt(src_txt, dst_txt, mode="mask")
out_text = pathlib.Path(dst_txt).read_text(encoding="utf-8")
print(f"TXT parser OK  total_pii={result['total_pii']}  output_len={len(out_text)}")
os.unlink(src_txt); os.unlink(dst_txt)

# ── JSON parser ───────────────────────────────────────────────────────────────
from parsers.json_parser import process_json

data = {
    "name": "Rahul Sharma",
    "aadhaar": "5487 8795 5678",
    "pan": "ABCDE1234F",
    "nested": {"phone": "+919876543210"},
    "items": ["some text", "ABCDE1234F"],
}
with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
    json.dump(data, f); src_json = f.name
dst_json = src_json + ".out.json"
result = process_json(src_json, dst_json, mode="tokenize")
out_data = json.loads(pathlib.Path(dst_json).read_text(encoding="utf-8"))
print(f"JSON parser OK  total_pii={result['total_pii']}  keys={list(out_data.keys())}")
os.unlink(src_json); os.unlink(dst_json)

print("\nAll parser smoke-tests passed.")
