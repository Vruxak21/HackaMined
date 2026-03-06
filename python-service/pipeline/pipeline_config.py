"""
Pipeline Configuration — determines detection layers, chunk sizes, and worker
counts based on file type and file size.

Rules:
  A — CSV, SQL, JSON (any size):   Regex only.  8 workers.
  B — TXT, PDF, DOCX (> 5 MB):    Regex + spaCy fast.  4 workers.
  C — TXT, PDF, DOCX (≤ 5 MB):    Regex + spaCy trf + BERT.  4 workers.
  D — Images (any size):           OCR → Regex only.  8 workers.
"""

from __future__ import annotations

_IMAGE_TYPES = frozenset({"png", "jpg", "jpeg"})
_STRUCTURED_TYPES = frozenset({"csv", "sql", "json"})
_UNSTRUCTURED_TYPES = frozenset({"txt", "pdf", "docx"})

_BERT_THRESHOLD_MB = 5.0


def get_pipeline_config(file_type: str, file_size_mb: float) -> dict:
    """
    Return a pipeline configuration dict for the given file type and size.

    Keys:
        use_regex       (bool)
        use_spacy       (bool)
        use_bert        (bool)
        spacy_model     (str)   "en_core_web_sm" or "en_core_web_trf"
        chunk_size      (int)   rows / chars / statements / pages / paragraphs / tiles
        workers         (int)
        skip_bert_reason (str)  human-readable explanation

    Raises ValueError for unrecognised file_type.
    """
    ft = file_type.lower().lstrip(".")

    # ── Rule D — Images ───────────────────────────────────────────────────────
    if ft in _IMAGE_TYPES:
        return {
            "use_regex": True,
            "use_spacy": False,
            "use_bert": False,
            "spacy_model": "en_core_web_sm",
            "chunk_size": 16,          # 4×4 grid tiles
            "workers": 8,
            "skip_bert_reason": (
                "Rule D: Image — OCR + Regex only "
                "(spaCy/BERT unreliable on OCR text)"
            ),
        }

    # ── Rule A — Structured data (CSV, SQL, JSON) any size ────────────────────
    if ft in _STRUCTURED_TYPES:
        _chunk_sizes = {"csv": 10_000, "sql": 2_000, "json": 1_500}
        return {
            "use_regex": True,
            "use_spacy": False,
            "use_bert": False,
            "spacy_model": "en_core_web_sm",
            "chunk_size": _chunk_sizes[ft],
            "workers": 8,
            "skip_bert_reason": (
                f"Rule A: {ft.upper()} — structured data, Regex only "
                f"(spaCy/BERT add latency with zero accuracy gain)"
            ),
        }

    # ── Rules B & C — Unstructured text (TXT, PDF, DOCX) ─────────────────────
    if ft in _UNSTRUCTURED_TYPES:
        if file_size_mb > _BERT_THRESHOLD_MB:
            # Rule B — large unstructured
            _chunk_sizes = {"txt": 100_000, "pdf": 15, "docx": 400}
            return {
                "use_regex": True,
                "use_spacy": True,
                "use_bert": False,
                "spacy_model": "en_core_web_sm",
                "chunk_size": _chunk_sizes[ft],
                "workers": 4,
                "skip_bert_reason": (
                    f"Rule B: {ft.upper()} > {_BERT_THRESHOLD_MB}MB — "
                    f"Regex + spaCy fast (BERT too slow for large files)"
                ),
            }
        # Rule C — small unstructured
        _chunk_sizes = {"txt": 30_000, "pdf": 5, "docx": 100}
        return {
            "use_regex": True,
            "use_spacy": True,
            "use_bert": True,
            "spacy_model": "en_core_web_trf",
            "chunk_size": _chunk_sizes[ft],
            "workers": 4,
            "skip_bert_reason": (
                f"Rule C: {ft.upper()} ≤ {_BERT_THRESHOLD_MB}MB — "
                f"full pipeline (Regex + spaCy trf + BERT)"
            ),
        }

    raise ValueError(f"Unrecognised file type: {file_type!r}")
