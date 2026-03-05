"""
Custom Presidio PatternRecognizer classes for Indian PII types.

Layer assignment:
  - Regex patterns  → Layer 1 (Pattern matching)
  - context words   → Layer 2 (Presidio context-aware scoring)

All classes extend presidio_analyzer.PatternRecognizer.

Public API:
  get_custom_recognizers() → list of recognizer instances
  get_all_entities()       → list of all entity type strings
"""

from __future__ import annotations

import re

from presidio_analyzer import Pattern, PatternRecognizer


# ── 1. AadhaarRecognizer ──────────────────────────────────────────────────────

class AadhaarRecognizer(PatternRecognizer):
    """
    Detects 12-digit Indian Aadhaar numbers in three formats:
      - Space-separated groups of 4  (highest confidence)
      - Dash-separated groups of 4   (highest confidence)
      - 12 consecutive digits        (lower confidence; could be other number)
    """

    PATTERNS = [
        Pattern(
            name="aadhaar_spaced",
            regex=r"\b[2-9]\d{3}\s\d{4}\s\d{4}\b",
            score=0.95,
        ),
        Pattern(
            name="aadhaar_dashed",
            regex=r"\b[2-9]\d{3}-\d{4}-\d{4}\b",
            score=0.95,
        ),
        Pattern(
            name="aadhaar_plain",
            regex=r"\b[2-9]\d{11}\b",
            score=0.75,
        ),
    ]
    CONTEXT = ["aadhaar", "aadhar", "uid", "uidai"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="AADHAAR",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 2. PANRecognizer ──────────────────────────────────────────────────────────

class PANRecognizer(PatternRecognizer):
    """
    Detects Indian Permanent Account Number (PAN) in format ABCDE1234F.
    Must be uppercase; the 4th character encodes the taxpayer category.
    """

    PATTERNS = [
        Pattern(
            name="pan_standard",
            # 3 alpha + 1 category char (A-Z) + 1 alpha + 4 digits + 1 alpha check digit
            regex=r"\b[A-Z]{3}[A-Z][A-Z]\d{4}[A-Z]\b",
            score=0.95,
        ),
    ]
    CONTEXT = ["pan", "permanent account", "income tax"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="PAN",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 3. IndianPhoneRecognizer ──────────────────────────────────────────────────

class IndianPhoneRecognizer(PatternRecognizer):
    """
    Detects Indian mobile numbers in three forms:
      - +91 prefix        (highest confidence)
      - 0  STD prefix     (medium confidence)
      - bare 10 digits starting 6-9 (lowest; needs context)
    """

    PATTERNS = [
        Pattern(
            name="in_phone_plus91",
            regex=r"(?:\+91[\s\-]?)[6-9]\d{9}\b",
            score=0.95,
        ),
        Pattern(
            name="in_phone_0prefix",
            regex=r"\b0[6-9]\d{9}\b",
            score=0.85,
        ),
        Pattern(
            name="in_phone_bare",
            regex=r"\b[6-9]\d{9}\b",
            score=0.75,
        ),
    ]
    CONTEXT = ["mobile", "phone", "ph", "mob", "contact", "cell", "whatsapp"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="IN_PHONE",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 4. UPIRecognizer ──────────────────────────────────────────────────────────

class UPIRecognizer(PatternRecognizer):
    """
    Detects Indian UPI Virtual Payment Addresses (VPA) in the form
    handle@bankcode, e.g. rahul@oksbi, 9876543210@paytm.
    """

    # Exhaustive list of known Indian UPI bank/app handles
    _BANK_CODES = (
        "oksbi", "okaxis", "okicici", "okhdfcbank",
        "ybl",   "ibl",   "axl",     "apl",
        "waicici", "wahdfc",
        "paytm", "upi",   "rbl",     "aubank",
        "icici", "sbi",   "hdfc",    "axis",
        "kotak", "boi",   "pnb",     "idbi",
        "fbl",   "ucobank",
    )

    def __init__(self) -> None:
        bank_alts = "|".join(re.escape(b) for b in self._BANK_CODES)
        patterns = [
            Pattern(
                name="upi_vpa",
                regex=rf"\b[\w.\-+]+@(?:{bank_alts})\b",
                score=0.95,
            ),
        ]
        super().__init__(
            supported_entity="UPI",
            patterns=patterns,
            context=["upi", "vpa", "payment", "gpay", "phonepe", "paytm"],
        )


# ── 5. IFSCRecognizer ─────────────────────────────────────────────────────────

class IFSCRecognizer(PatternRecognizer):
    """
    Detects Indian Financial System Code (IFSC):
      4 uppercase alpha (bank) + '0' (reserved) + 6 alphanumeric (branch).
    """

    PATTERNS = [
        Pattern(
            name="ifsc_standard",
            regex=r"\b[A-Z]{4}0[A-Z0-9]{6}\b",
            score=0.95,
        ),
    ]
    CONTEXT = ["ifsc", "rtgs", "neft", "imps", "bank code", "branch code"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="IFSC",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 6. IndianPassportRecognizer ───────────────────────────────────────────────

class IndianPassportRecognizer(PatternRecognizer):
    """
    Detects Indian passport numbers: 1 uppercase letter + 7 digits,
    where the first digit is non-zero (e.g., A1234567).
    Lower base confidence — needs context to reach usable threshold.
    """

    PATTERNS = [
        Pattern(
            name="passport_in",
            regex=r"\b[A-Z][1-9]\d{6}\b",
            score=0.75,
        ),
    ]
    CONTEXT = ["passport", "pp no", "travel doc", "visa", "passport no"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="PASSPORT",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 7. AadhaarVIDRecognizer ───────────────────────────────────────────────────

class AadhaarVIDRecognizer(PatternRecognizer):
    """
    Detects 16-digit Aadhaar Virtual ID (VID), optionally spaced every 4 digits.
    Always requires context words to avoid false positives (many 16-digit numbers
    look like credit cards).
    """

    PATTERNS = [
        Pattern(
            name="aadhaar_vid_spaced",
            regex=r"\b\d{4}\s\d{4}\s\d{4}\s\d{4}\b",
            score=0.80,
        ),
        Pattern(
            name="aadhaar_vid_plain",
            regex=r"\b\d{16}\b",
            score=0.70,
        ),
    ]
    CONTEXT = ["vid", "virtual id", "virtual aadhaar", "virtual id number"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="AADHAAR_VID",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 8. CVVRecognizer ──────────────────────────────────────────────────────────

class CVVRecognizer(PatternRecognizer):
    """
    Detects 3- or 4-digit card verification values.
    Base confidence is deliberately kept low — without context words near the
    match, 3-digit numbers are ubiquitous; Presidio's context boost brings it
    to a usable threshold.
    """

    PATTERNS = [
        Pattern(
            name="cvv_3digit",
            regex=r"\b\d{3}\b",
            score=0.40,
        ),
        Pattern(
            name="cvv_4digit",
            regex=r"\b\d{4}\b",
            score=0.40,
        ),
    ]
    CONTEXT = ["cvv", "cvc", "security code", "card verification", "cvv2", "cvc2"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="CVV",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 9. IndianAccountRecognizer ────────────────────────────────────────────────

class IndianAccountRecognizer(PatternRecognizer):
    """
    Detects Indian bank account numbers (9–18 consecutive digits).
    Low base confidence (strings of digits are common); strong context boost
    pushes valid hits to 0.90+.
    """

    PATTERNS = [
        Pattern(
            name="account_9to18_digits",
            regex=r"\b\d{9,18}\b",
            score=0.65,
        ),
    ]
    CONTEXT = [
        "account", "a/c", "acct", "bank account",
        "savings", "current account", "acc no",
    ]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="ACCOUNT_NUMBER",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 10. BiometricRecognizer ───────────────────────────────────────────────────

class BiometricRecognizer(PatternRecognizer):
    """
    Detects biometric data strings:
      - fp_hash_ / face_tmp_ prefixed tokens (structured storage formats)
      - Generic hex-encoded fingerprint hashes (32+ hex chars)
    """

    PATTERNS = [
        Pattern(
            name="biometric_fp_hash",
            regex=r"\bfp_hash_[A-Za-z0-9_\-]{8,}\b",
            score=0.99,
        ),
        Pattern(
            name="biometric_face_tmp",
            regex=r"\bface_tmp_[A-Za-z0-9_\-]{8,}\b",
            score=0.99,
        ),
        Pattern(
            name="biometric_hex_hash",
            # 32-char (MD5) or 64-char (SHA-256) lowercase hex string
            regex=r"\b[0-9a-f]{32}(?:[0-9a-f]{32})?\b",
            score=0.85,
        ),
    ]
    CONTEXT = ["fingerprint", "biometric", "face template", "iris", "fp hash"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="BIOMETRIC",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )


# ── 11. DeviceIDRecognizer ────────────────────────────────────────────────────

class DeviceIDRecognizer(PatternRecognizer):
    """
    Detects device identifiers:
      - android-<hex>  or  ios-<hex>  prefixed tokens
      - RFC 4122 UUID v1–v5
    """

    PATTERNS = [
        Pattern(
            name="device_android",
            regex=r"\bandroid-[0-9a-fA-F]{8,}\b",
            score=0.95,
        ),
        Pattern(
            name="device_ios",
            regex=r"\bios-[0-9a-fA-F]{8,}\b",
            score=0.95,
        ),
        Pattern(
            name="device_uuid",
            regex=(
                r"\b[0-9a-fA-F]{8}-"
                r"[0-9a-fA-F]{4}-"
                r"[1-5][0-9a-fA-F]{3}-"
                r"[89abAB][0-9a-fA-F]{3}-"
                r"[0-9a-fA-F]{12}\b"
            ),
            score=0.75,
        ),
    ]
    CONTEXT = ["device", "device id", "android", "ios", "imei", "uuid", "device_id"]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="DEVICE_ID",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
        )



# ── Public API ────────────────────────────────────────────────────────────────

def get_custom_recognizers() -> list[PatternRecognizer]:
    """Return one instance of every custom Indian-PII recognizer."""
    return [
        AadhaarRecognizer(),
        PANRecognizer(),
        IndianPhoneRecognizer(),
        UPIRecognizer(),
        IFSCRecognizer(),
        IndianPassportRecognizer(),
        AadhaarVIDRecognizer(),
        CVVRecognizer(),
        IndianAccountRecognizer(),
        BiometricRecognizer(),
        DeviceIDRecognizer(),
    ]


def get_all_entities() -> list[str]:
    """
    Exhaustive list of entity types handled by the full detection pipeline:
    custom Indian-PII recognizers + standard Presidio built-ins.
    """
    return [
        # Custom Indian PII (Layer 1 / Layer 2 custom)
        "AADHAAR",
        "PAN",
        "IN_PHONE",
        "UPI",
        "IFSC",
        "PASSPORT",
        "AADHAAR_VID",
        "CVV",
        "ACCOUNT_NUMBER",
        "BIOMETRIC",
        "DEVICE_ID",
        # Standard Presidio entities (Layer 2 built-in)
        "PERSON",
        "EMAIL_ADDRESS",
        "PHONE_NUMBER",
        "CREDIT_CARD",
        "IP_ADDRESS",
        "LOCATION",
        "DATE_TIME",
        "URL",
    ]

