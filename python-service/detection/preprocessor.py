"""
TextPreprocessor — Stage 1 of the PII detection pipeline.

Responsibilities:
  1. clean()                  — Normalize raw text before passing to detection layers.
  2. extract_label_value_pairs() — Find explicit "LABEL: value" patterns in structured text.
  3. get_column_pii_type()    — Determine PII entity type from a column/header name.
"""

import re
import unicodedata
from typing import Optional


class TextPreprocessor:
    """
    Pre-processes raw text extracted from any file format before PII detection.

    Usage:
        pp = TextPreprocessor()
        clean_text = pp.clean(raw_text)
        pairs = pp.extract_label_value_pairs(clean_text)
        col_type = pp.get_column_pii_type("aadhaar_no")
    """

    def __init__(self) -> None:
        # Mapping of lowercase label keywords → canonical entity type.
        # Ordered from most-specific to least-specific so that multi-word
        # keys (e.g. "permanent account") match before single-word fragments.
        self._known_labels: dict[str, str] = {
            # Aadhaar / UID
            "aadhaar":          "AADHAAR",
            "aadhar":           "AADHAAR",
            "uid":              "AADHAAR",
            "uidai":            "AADHAAR",
            # PAN
            "pan":              "PAN",
            "permanent account": "PAN",
            # Phone
            "mobile":           "IN_PHONE",
            "phone":            "IN_PHONE",
            "ph":               "IN_PHONE",
            "mob":              "IN_PHONE",
            "contact":          "IN_PHONE",
            "cell":             "IN_PHONE",
            # Email
            "email":            "EMAIL_ADDRESS",
            "mail":             "EMAIL_ADDRESS",
            "e-mail":           "EMAIL_ADDRESS",
            # Address / Location
            "address":          "LOCATION",
            "addr":             "LOCATION",
            "residence":        "LOCATION",
            # Date of birth
            "dob":              "DATE_TIME",
            "date of birth":    "DATE_TIME",
            "born":             "DATE_TIME",
            "birth date":       "DATE_TIME",
            # Bank account
            "account":          "ACCOUNT_NUMBER",
            "a/c":              "ACCOUNT_NUMBER",
            "acct":             "ACCOUNT_NUMBER",
            # IFSC
            "ifsc":             "IFSC",
            # UPI / VPA
            "upi":              "UPI",
            "vpa":              "UPI",
            # Passport
            "passport":         "PASSPORT",
            "pp no":            "PASSPORT",
            # Card
            "card":             "CREDIT_CARD",
            "credit card":      "CREDIT_CARD",
            "debit card":       "CREDIT_CARD",
            # Person / Name
            "name":             "PERSON",
            "full name":        "PERSON",
            "customer name":    "PERSON",
            "father":           "PERSON",
            "mother":           "PERSON",
            "spouse":           "PERSON",
            # Card security
            "cvv":              "CVV",
            "expiry":           "EXPIRY",
            # Network / Device
            "ip":               "IP_ADDRESS",
            "device":           "DEVICE_ID",
            # Biometric
            "fingerprint":      "BIOMETRIC",
            "face":             "BIOMETRIC",
        }

        # Pre-compile a regex that matches "LABEL :" / "LABEL:" / "LABEL ="
        # followed by capture of the value up to end-of-line or 100 chars.
        # Labels are tried longest-first (avoids "pan" matching inside "permanent account").
        sorted_labels = sorted(self._known_labels.keys(), key=len, reverse=True)
        label_alts = "|".join(re.escape(lbl) for lbl in sorted_labels)
        self._label_re = re.compile(
            rf"(?P<label>{label_alts})\s*[:=]\s*(?P<value>[^\n]{{0,100}})",
            re.IGNORECASE,
        )

        # OCR artifact patterns: digit-letter-digit ambiguities
        self._ocr_l = re.compile(r"(?<=\d)l(?=\d)|(?<=\d)l$|^l(?=\d)", re.IGNORECASE)
        self._ocr_O = re.compile(r"(?<=\d)O(?=\d)|(?<=\d)O$|^O(?=\d)")

        # Date separator normalization: '.' and '-' between 2-digit groups
        self._date_sep = re.compile(
            r"\b(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})\b"
        )

    # ── public API ────────────────────────────────────────────────────────────

    def clean(self, text: str) -> str:
        """
        Normalize raw text before detection.

        Steps:
          1. Decode to UTF-8 / normalize Unicode forms.
          2. Collapse horizontal whitespace (spaces/tabs) to a single space;
             preserve newlines so multi-line documents keep their structure
             (prevents spaCy from merging tokens across lines).
          3. Fix common OCR digit/letter substitutions in numeric contexts.
          4. Standardize date separators to '/'.

        Returns:
            Cleaned string (always str, never None).
        """
        if not isinstance(text, str):
            try:
                text = text.decode("utf-8", errors="replace")
            except AttributeError:
                text = str(text)

        # 1. Unicode normalization (NFC: composed form, handles accented chars)
        text = unicodedata.normalize("NFC", text)

        # 1a. Remove zero-width and invisible control characters so they
        #     cannot split number tokens that appear continuous to the eye.
        #     Covers: zero-width space (U+200B), ZWJ (U+200D), ZWNJ (U+200C),
        #     BOM (U+FEFF), and Unicode line/paragraph separators (U+2028/29).
        text = re.sub(r"[\u200b-\u200d\u2028\u2029\ufeff]", "", text)

        # 1b. Normalize Unicode whitespace variants → ASCII space so that
        #     the collapse step below treats them uniformly.
        #     Covers: NBSP (U+00A0), ogham space (U+1680), Unicode general
        #     punctuation spaces U+2000-U+200A, narrow NBSP (U+202F),
        #     medium mathematical space (U+205F), ideographic space (U+3000).
        text = re.sub(r"[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]", " ", text)

        # 1c. Normalize typographic dashes → ASCII hyphen (-).
        #     Covers: non-breaking hyphen (U+2011), figure dash (U+2012),
        #     en-dash (U+2013), em-dash (U+2014), horizontal bar (U+2015),
        #     and minus sign (U+2212).
        text = re.sub(r"[\u2011-\u2015\u2212]", "-", text)

        # 1d. Commas used as digit-group separators → single space so that
        #     structured identifiers written as "1234,5678,9012" (Aadhaar)
        #     or "98765,43210" (phone) collapse to their spaced equivalents
        #     that the existing regex patterns already recognise.
        #     Only replaces commas that are immediately flanked by digits,
        #     leaving sentence commas and CSV structure untouched.
        text = re.sub(r"(?<=\d),(?=\d)", " ", text)

        # 1e. Underscores between consecutive digits → hyphen.
        #     Handles formats like "1234_5678_9012".
        text = re.sub(r"(?<=\d)_(?=\d)", "-", text)

        # 2. Collapse horizontal whitespace to a single space; preserve newlines
        text = re.sub(r"[ \t\r\f\v]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()

        # 3. OCR corrections — only in digit-adjacent contexts
        #    "l" (lowercase L) → "1" when surrounded by digits
        text = re.sub(r"(?<=\d)l(?=\d)", "1", text)
        text = re.sub(r"(?<=\d)l\b", "1", text)
        text = re.sub(r"\bl(?=\d)", "1", text)
        #    "O" (uppercase O) → "0" when surrounded by digits
        text = re.sub(r"(?<=\d)O(?=\d)", "0", text)
        text = re.sub(r"(?<=\d)O\b", "0", text)
        text = re.sub(r"\bO(?=\d)", "0", text)

        # 4. Normalize date separators: "12-05-1997" / "12.05.1997" → "12/05/1997"
        text = self._date_sep.sub(r"\1/\2/\3", text)

        return text

    def extract_label_value_pairs(self, text: str) -> list[dict]:
        """
        Find explicit "LABEL: value" or "LABEL = value" patterns in text.

        Handles both single-line structured text (e.g., form data, CSV headers
        with inline values) and multi-line documents.

        Returns:
            List of dicts, each with:
                label       — matched label text (lowercased)
                value       — trimmed value string
                entity_type — canonical PII entity type
                label_start — start index of label in text
                label_end   — end index of label in text
                value_start — start index of value in text
                value_end   — end index of value in text
        """
        results: list[dict] = []
        seen_spans: set[tuple[int, int]] = set()

        for m in self._label_re.finditer(text):
            label_raw = m.group("label")
            value_raw = m.group("value").strip()

            # Skip empty values
            if not value_raw:
                continue

            label_lower = label_raw.lower()
            entity_type = self._known_labels.get(label_lower)
            if entity_type is None:
                # Shouldn't happen given regex construction, but guard anyway
                continue

            label_start = m.start("label")
            label_end   = m.end("label")
            value_start = m.start("value")
            value_end   = value_start + len(value_raw)

            # Deduplicate by span (overlapping captures can occur with broad patterns)
            span = (label_start, value_end)
            if span in seen_spans:
                continue
            seen_spans.add(span)

            results.append({
                "label":        label_lower,
                "value":        value_raw,
                "entity_type":  entity_type,
                "label_start":  label_start,
                "label_end":    label_end,
                "value_start":  value_start,
                "value_end":    value_end,
            })

        return results

    def get_column_pii_type(self, column_name: str) -> Optional[str]:
        """
        Infer the PII entity type from a column / header name.

        Normalization applied before matching:
          - lowercase
          - underscores and hyphens → spaces

        Examples:
            "aadhaar_no"      → "AADHAAR"
            "customer_phone"  → "IN_PHONE"
            "emp_pan"         → "PAN"
            "email_address"   → "EMAIL_ADDRESS"
            "full_name"       → "PERSON"

        Returns:
            Entity type string, or None if the column is not recognised as PII.
        """
        normalized = column_name.lower().replace("_", " ").replace("-", " ")

        # Collect all matching labels with their start position.
        # Prefer the leftmost match (earliest in the column name) — e.g.
        # "email_address" → "email address": both "email" and "address" match,
        # but "email" starts at 0 so it wins over "address" at 6.
        # Ties in position are broken by label length (longer = more specific).
        best: Optional[tuple[int, int, str]] = None  # (start, length, entity_type)

        for label, entity_type in self._known_labels.items():
            idx = normalized.find(label)
            if idx == -1:
                continue
            llen = len(label)
            if best is None or idx < best[0] or (idx == best[0] and llen > best[1]):
                best = (idx, llen, entity_type)

        return best[2] if best is not None else None

