"""
setup_test.py
Run this script to verify all PII service dependencies are correctly installed.
Usage: python setup_test.py
"""

errors = []
passed = []

# ── 1. presidio-analyzer ─────────────────────────────────────────────────────
try:
    import presidio_analyzer
    version = getattr(presidio_analyzer, "__version__", "unknown")
    print(f"[OK] presidio_analyzer  v{version}")
    passed.append("presidio_analyzer")
except ImportError as e:
    print(f"[FAIL] presidio_analyzer: {e}")
    errors.append("presidio_analyzer")

# ── 2. presidio-anonymizer ────────────────────────────────────────────────────
try:
    import presidio_anonymizer
    version = getattr(presidio_anonymizer, "__version__", "unknown")
    print(f"[OK] presidio_anonymizer  v{version}")
    passed.append("presidio_anonymizer")
except ImportError as e:
    print(f"[FAIL] presidio_anonymizer: {e}")
    errors.append("presidio_anonymizer")

# ── 3. spaCy + en_core_web_sm ─────────────────────────────────────────────────
try:
    import spacy
    print(f"[OK] spacy  v{spacy.__version__}")
    passed.append("spacy")
    try:
        nlp = spacy.load("en_core_web_sm")
        print("[OK] spacy model  en_core_web_sm loaded")
        passed.append("en_core_web_sm")
    except OSError:
        print("[FAIL] spacy model en_core_web_sm not found – run: python -m spacy download en_core_web_sm")
        errors.append("en_core_web_sm")
except ImportError as e:
    print(f"[FAIL] spacy: {e}")
    errors.append("spacy")

# ── 4. transformers ───────────────────────────────────────────────────────────
try:
    from transformers import pipeline
    import transformers
    print(f"[OK] transformers  v{transformers.__version__}")
    passed.append("transformers")
except ImportError as e:
    print(f"[FAIL] transformers: {e}")
    errors.append("transformers")

# ── 5. Multilingual NER model for Indian names (public, no gating) ───────────
# Using Davlan/bert-base-multilingual-cased-ner-hrl as the Indian NER model.
# It covers Hindi/Indic names and is fully publicly accessible on HuggingFace.
try:
    from transformers import AutoTokenizer, AutoModelForTokenClassification
    print("[OK] transformers AutoTokenizer/AutoModel available")
    print("[INFO] Attempting to load Davlan/bert-base-multilingual-cased-ner-hrl tokenizer...")
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            "Davlan/bert-base-multilingual-cased-ner-hrl",
            local_files_only=False,
        )
        print("[OK] Davlan/bert-base-multilingual-cased-ner-hrl tokenizer loaded")
        passed.append("indic-ner-model")
    except Exception as e:
        print(f"[WARN] Multilingual NER model could not be loaded: {e}")
        print("       This is non-fatal. The model will be downloaded on first use (~700 MB).")
        print("       Ensure internet access and sufficient disk space.")
except ImportError as e:
    print(f"[FAIL] transformers (AutoTokenizer): {e}")
    errors.append("transformers-auto")

# ── 6. PyMuPDF (fitz) ─────────────────────────────────────────────────────────
try:
    import fitz
    print(f"[OK] PyMuPDF (fitz)  v{fitz.__version__}")
    passed.append("fitz")
except ImportError as e:
    print(f"[FAIL] PyMuPDF (fitz): {e}")
    errors.append("fitz")

# ── 7. python-docx ────────────────────────────────────────────────────────────
try:
    import docx
    print(f"[OK] python-docx  v{docx.__version__}")
    passed.append("docx")
except ImportError as e:
    print(f"[FAIL] python-docx: {e}")
    errors.append("docx")

# ── 8. pandas ─────────────────────────────────────────────────────────────────
try:
    import pandas as pd
    print(f"[OK] pandas  v{pd.__version__}")
    passed.append("pandas")
except ImportError as e:
    print(f"[FAIL] pandas: {e}")
    errors.append("pandas")

# ── 9. pytesseract ────────────────────────────────────────────────────────────
try:
    import pytesseract
    print(f"[OK] pytesseract  v{pytesseract.get_tesseract_version()}")
    passed.append("pytesseract")
except Exception as e:
    # Tesseract binary may not be installed even if the Python package is
    print(f"[WARN] pytesseract package OK but Tesseract binary issue: {e}")
    print("       Install Tesseract OCR: https://github.com/UB-Mannheim/tesseract/wiki")

# ── 10. Pillow ────────────────────────────────────────────────────────────────
try:
    from PIL import Image
    import PIL
    print(f"[OK] Pillow  v{PIL.__version__}")
    passed.append("Pillow")
except ImportError as e:
    print(f"[FAIL] Pillow: {e}")
    errors.append("Pillow")

# ── 11. FastAPI + uvicorn ─────────────────────────────────────────────────────
try:
    import fastapi
    print(f"[OK] fastapi  v{fastapi.__version__}")
    passed.append("fastapi")
except ImportError as e:
    print(f"[FAIL] fastapi: {e}")
    errors.append("fastapi")

try:
    import uvicorn
    print(f"[OK] uvicorn  v{uvicorn.__version__}")
    passed.append("uvicorn")
except ImportError as e:
    print(f"[FAIL] uvicorn: {e}")
    errors.append("uvicorn")

# ── 12. python-dotenv ─────────────────────────────────────────────────────────
try:
    import dotenv
    # python-dotenv exposes version via importlib, not dotenv.__version__
    try:
        from importlib.metadata import version as pkg_version
        dv = pkg_version("python-dotenv")
    except Exception:
        dv = "unknown"
    print(f"[OK] python-dotenv  v{dv}")
    passed.append("dotenv")
except ImportError as e:
    print(f"[FAIL] python-dotenv: {e}")
    errors.append("dotenv")

# ── 13. faker ─────────────────────────────────────────────────────────────────
try:
    import faker
    print(f"[OK] faker  v{faker.VERSION}")
    passed.append("faker")
except ImportError as e:
    print(f"[FAIL] faker: {e}")
    errors.append("faker")

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"  {len(passed)} passed  |  {len(errors)} failed")
if errors:
    print(f"\n  FAILED: {', '.join(errors)}")
    print("  Fix the above errors before starting the service.")
else:
    print("\n  ALL DEPENDENCIES OK ✓")
print("=" * 60)
