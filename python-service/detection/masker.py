"""
PII Masker — applies one of three masking modes to detected PII spans.

Modes
-----
redact   → replace span with "[REDACTED]"
mask     → partial masking, type-aware (preserves structural hints, e.g. 9876******, j***@g***.com)
tokenize → replace span with a reversible token <<ENTITY_TYPE_NNN>>; original value stored in token_map

Pipeline position: runs AFTER ConfidenceScorer.deduplicate(), as the final step.

Note: Presidio AnonymizerEngine is initialised here but the core span-replacement
logic is implemented directly so that all three modes share the same code path and
the token_map can be maintained per-document.
"""

from __future__ import annotations

import re
from typing import Any

from presidio_anonymizer import AnonymizerEngine


class PIIMasker:
    """
    Applies redact / mask / tokenize modes to a list of scored PII spans.
    """

    def __init__(self) -> None:
        self._anonymizer = AnonymizerEngine()
        self.token_counters: dict[str, int] = {}

    # ── Partial masking helpers ───────────────────────────────────────────────

    def get_partial_mask(self, value: str, entity_type: str) -> str:
        """
        Return a type-aware partially masked string, matching Slide 10 examples.
        Falls back to "[REDACTED]" for unrecognised types.
        """
        try:
            if entity_type == "EMAIL_ADDRESS":
                return self._mask_email(value)

            if entity_type in {"IN_PHONE", "PHONE_NUMBER"}:
                return self._mask_phone(value)

            if entity_type == "CREDIT_CARD":
                return self._mask_credit_card(value)

            if entity_type == "AADHAAR":
                return self._mask_aadhaar(value)

            if entity_type == "PAN":
                return self._mask_pan(value)

            if entity_type == "PERSON":
                return self._mask_person(value)

            if entity_type == "DATE_TIME":
                return self._mask_date(value)

            if entity_type == "ACCOUNT_NUMBER":
                return self._mask_account(value)

            if entity_type == "LOCATION":
                return self._mask_location(value)

        except Exception:  # noqa: BLE001 — graceful fallback on any parse error
            pass

        return "[REDACTED]"

    # ── Type-specific maskers ─────────────────────────────────────────────────

    @staticmethod
    def _mask_email(value: str) -> str:
        """r***@g***.com"""
        if "@" not in value:
            return "[REDACTED]"
        local, domain = value.split("@", 1)
        masked_local = (local[0] if local else "*") + "***"
        parts = domain.rsplit(".", 1)
        if len(parts) == 2:
            masked_domain = (parts[0][0] if parts[0] else "*") + "***." + parts[1]
        else:
            masked_domain = "***"
        return f"{masked_local}@{masked_domain}"

    @staticmethod
    def _mask_phone(value: str) -> str:
        """9876******"""
        digits = re.sub(r"\D", "", value)
        # Strip country prefix (+91 / 0) if present to get 10-digit number
        if digits.startswith("91") and len(digits) == 12:
            digits = digits[2:]
        elif digits.startswith("0") and len(digits) == 11:
            digits = digits[1:]
        keep = digits[:4] if len(digits) >= 4 else digits
        return keep + "*" * 6

    @staticmethod
    def _mask_credit_card(value: str) -> str:
        """**** **** **** 1234"""
        digits = re.sub(r"\D", "", value)
        last4 = digits[-4:] if len(digits) >= 4 else digits
        return f"**** **** **** {last4}"

    @staticmethod
    def _mask_aadhaar(value: str) -> str:
        """**** **** 9012"""
        digits = re.sub(r"\D", "", value)
        last4 = digits[-4:] if len(digits) >= 4 else digits
        return f"**** **** {last4}"

    @staticmethod
    def _mask_pan(value: str) -> str:
        """AB***4F  (first 2 + *** + last digit + check letter)"""
        v = value.strip()
        if len(v) < 3:
            return "[REDACTED]"
        prefix = v[:2]
        suffix = v[-2:] if len(v) >= 4 else v[-1:]
        return f"{prefix}***{suffix}"

    @staticmethod
    def _mask_person(value: str) -> str:
        """Rahul S****"""
        parts = value.strip().split()
        if not parts:
            return "[REDACTED]"
        first = parts[0]
        if len(parts) == 1:
            return first[0] + "****" if first else "[REDACTED]"
        last_initial = parts[-1][0] if parts[-1] else "*"
        return f"{first} {last_initial}****"

    @staticmethod
    def _mask_date(value: str) -> str:
        """**/**: 1997  (mask day+month, keep year)"""
        # Attempt to find a 4-digit year anywhere in the string
        year_match = re.search(r"\b(19|20)\d{2}\b", value)
        year = year_match.group(0) if year_match else "****"
        return f"**/**/{year}"

    @staticmethod
    def _mask_account(value: str) -> str:
        """**********1234"""
        digits = re.sub(r"\D", "", value)
        last4 = digits[-4:] if len(digits) >= 4 else digits
        stars = "*" * max(len(digits) - 4, 4)
        return f"{stars}{last4}"

    @staticmethod
    def _mask_location(value: str) -> str:
        """
        Keep the last comma-separated component (usually the city/state),
        mask street-level details.  Falls back to [REDACTED].
        """
        parts = [p.strip() for p in value.split(",")]
        if len(parts) >= 2:
            # Assume last part is city/state
            return f"[STREET REDACTED], {parts[-1]}"
        return "[REDACTED]"

    # ── Token generation ──────────────────────────────────────────────────────

    def get_token(self, entity_type: str) -> str:
        """
        Return the next sequential token for *entity_type*.
        Example: <<AADHAAR_001>>, <<PERSON_002>>
        """
        self.token_counters[entity_type] = (
            self.token_counters.get(entity_type, 0) + 1
        )
        count = str(self.token_counters[entity_type]).zfill(3)
        return f"<<{entity_type}_{count}>>"

    def reset_counters(self) -> None:
        """Reset token counters.  Call once at the start of each new document."""
        self.token_counters = {}

    # ── Main masking entry point ──────────────────────────────────────────────

    def mask(
        self,
        text: str,
        results_to_mask: list[dict[str, Any]],
        mode: str = "redact",
    ) -> dict[str, Any]:
        """
        Apply *mode* masking to every span in *results_to_mask*.

        Parameters
        ----------
        text            : the cleaned source text (from preprocessor)
        results_to_mask : list of result dicts with "start", "end", "type" keys
        mode            : "redact" | "mask" | "tokenize"

        Returns
        -------
        {
            "masked_text": str,
            "token_map":   dict  (populated only in tokenize mode)
        }
        """
        self.reset_counters()

        # Process in reverse order so earlier positions are not invalidated
        sorted_spans = sorted(results_to_mask, key=lambda r: r["start"], reverse=True)

        masked_text: str = text
        token_map: dict[str, str] = {}

        for result in sorted_spans:
            start: int = result["start"]
            end: int = result["end"]
            entity_type: str = result.get("type", "PII")
            original_value: str = text[start:end]

            if mode == "redact":
                replacement = "[REDACTED]"

            elif mode == "mask":
                replacement = self.get_partial_mask(original_value, entity_type)

            elif mode == "tokenize":
                token = self.get_token(entity_type)
                token_map[token] = original_value
                replacement = token

            else:
                replacement = "[REDACTED]"

            masked_text = masked_text[:start] + replacement + masked_text[end:]

        return {
            "masked_text": masked_text,
            "token_map": token_map,
        }


# ── Module-level singleton ────────────────────────────────────────────────────
pii_masker = PIIMasker()

