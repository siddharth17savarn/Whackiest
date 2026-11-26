"""
backend/app/services/pii_masking.py — PII detection and masking before external AI calls.

Masks personal identifiers (emails, phone numbers, cards, bank accounts, UPI IDs,
physical addresses, and contextually identifiable personal names) using deterministic
placeholders ([EMAIL], [PHONE], [CARD], [ACCOUNT], [UPI], [ADDRESS], [PERSON])
while preserving company names, monetary amounts, dates, and deadline phrases.

Known Limitations (documented honestly):
  1. Regex + heuristic NER cannot achieve 100% recall on arbitrary unformatted names
     or international address formats without a full statistical/transformer NER model.
  2. Unusual name capitalizations or single-word nicknames without conversational cues
     (e.g., "Hi, I'm ...", "Dear ...") may not be masked to avoid false-positively
     masking company names or promise keywords.
  3. Order IDs (e.g., #SK-9042) are intentionally preserved unless they match a
     bank account or card pattern, because order references are often useful context.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# ── Patterns ordered from most specific to least specific ─────────────

_EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)

# Common Indian UPI handles (e.g. rahul@okaxis, 9876543210@ybl)
_UPI_RE = re.compile(
    r"\b[A-Za-z0-9._-]{2,}@(?:okaxis|okhdfcbank|okicici|oksbi|ybl|ibl|axl|paytm|upi|apl)\b",
    re.IGNORECASE,
)

# Credit / debit card numbers: 13-19 digits grouped by spaces or hyphens
_CARD_RE = re.compile(
    r"\b(?:\d{4}[-\s]?){3}\d{1,7}\b"
)

# Bank account / IFSC / SSN / PAN identifiers
_ACCOUNT_PATTERNS = [
    # Explicit labeled account / routing / card-last-4 / SSN / PAN
    re.compile(
        r"\b(?:account\s*(?:no\.?|number|#)?|a/c\s*(?:no\.?)?|acct\s*(?:no\.?)?|iban|routing\s*(?:no\.?|number)?|ifsc)\s*[:#-]?\s*[A-Z0-9]{6,24}\b",
        re.IGNORECASE,
    ),
    # US SSN: 123-45-6789
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    # Indian PAN: ABCDE1234F
    re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b"),
    # Indian IFSC: SBIN0001234
    re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b"),
]

# Phone numbers: +91 98765 43210, (555) 123-4567, +1-800-555-0199, 9876543210
# Negative lookbehind avoids matching currency like ₹2,499 or ISO dates like 2026-11-26
_PHONE_RE = re.compile(
    r"(?<![₹$€£\d-])"
    r"(?:"
    r"(?:\+\d{1,3}[-.\s]?)?(?:\(\d{2,4}\)[-.\s]?|\d{3,5}[-.\s]?)\d{3,5}(?:[-.\s]?\d{3,5})?"
    r"|\b\d{10}\b"
    r")"
    r"(?!\d)"
)

# Physical addresses (street/road/sector/apt + optional city/PIN/ZIP)
_ADDRESS_RE = re.compile(
    r"\b(?:\d{1,5}[A-Za-z]?(?:[-/]\d{1,4})?,?\s+)?"
    r"(?:[A-Z0-9][A-Za-z0-9.'-]+\s+){1,4}"
    r"(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Sector|Phase|Block|Nagar|Colony|Marg|Parkway|Pkwy)"
    r"(?:[,\s]+(?:Apt|Flat|Suite|Unit|Floor|#)\s*[A-Za-z0-9-]+)?"
    r"(?:[,\s]+[A-Za-z][A-Za-z\s]{1,25})?"
    r"(?:[,\s-]+\d{5,6}(?:-\d{4})?)?\b",
    re.IGNORECASE,
)

# Contextual personal name patterns (avoiding false positives on company names)
_NAME_PATTERNS = [
    # "Hi, I'm Priya" / "I am Rahul Sharma" / "My name is Ananya Verma"
    re.compile(
        r"\b(?:I'm|I am|my name is|this is)\s+([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)\b"
    ),
    # "Dear Mr. Vikram Patel" / "Hi Priya," / "Hello Rohan,"
    re.compile(
        r"\b(?:Dear|Hi|Hello|Hey)\s+(?:(?:Mr|Mrs|Ms|Dr)\.?\s+)?([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)(?=[,!.\s])"
    ),
    # "Mr. Vikram Patel" / "Ms. Neha Kapoor"
    re.compile(
        r"\b(?:Mr|Mrs|Ms|Dr)\.?\s+([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)\b"
    ),
    # "Agent: Neha Kapoor" / "Customer: Amit Singh"
    re.compile(
        r"\b(?:Agent|Customer|Representative|Rep)\s*:\s*([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20})?)\b"
    ),
]

_NON_NAME_WORDS = {
    "support", "team", "customer", "there", "everyone", "all",
    "sir", "madam", "shopkart", "quickbite", "monday", "tuesday",
    "wednesday", "thursday", "friday", "saturday", "sunday",
    "today", "tomorrow", "good", "sorry", "happy", "glad",
}


@dataclass
class PIIMaskResult:
    masked_text: str
    pii_detected: bool
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def total_masked(self) -> int:
        return sum(self.counts.values())


def _is_valid_phone_match(raw: str) -> bool:
    digits = re.sub(r"\D", "", raw)
    # Require 10-15 digits so dates (8 digits) or short order IDs aren't masked
    return 10 <= len(digits) <= 15


def mask_pii(text: str, *, company: Optional[str] = None) -> PIIMaskResult:
    """
    Mask PII in `text` while preserving company names, dates, amounts, and deadlines.

    Args:
        text: Raw customer-support message.
        company: Optional company name to explicitly protect from name masking.
    """
    if not text:
        return PIIMaskResult(masked_text=text, pii_detected=False, counts={})

    masked = text
    counts: dict[str, int] = {}

    def _record(kind: str, n: int = 1) -> None:
        if n > 0:
            counts[kind] = counts.get(kind, 0) + n

    # 1. UPI IDs (before generic email so UPI handles get [UPI])
    masked, n = _UPI_RE.subn("[UPI]", masked)
    _record("upi", n)

    # 2. Email addresses
    masked, n = _EMAIL_RE.subn("[EMAIL]", masked)
    _record("email", n)

    # 3. Payment cards (13-19 digits)
    def _card_sub(m: re.Match) -> str:
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19:
            _record("card")
            return "[CARD]"
        return m.group(0)

    masked = _CARD_RE.sub(_card_sub, masked)

    # 4. Bank accounts / SSN / PAN / IFSC
    for pat in _ACCOUNT_PATTERNS:
        masked, n = pat.subn("[ACCOUNT]", masked)
        _record("account", n)

    # 5. Phone numbers
    def _phone_sub(m: re.Match) -> str:
        if _is_valid_phone_match(m.group(0)):
            _record("phone")
            return "[PHONE]"
        return m.group(0)

    masked = _PHONE_RE.sub(_phone_sub, masked)

    # 6. Physical addresses
    def _addr_sub(m: re.Match) -> str:
        # Guard against short false positives that have no digits and < 3 words
        val = m.group(0).strip()
        if len(val.split()) < 2:
            return m.group(0)
        _record("address")
        return "[ADDRESS]"

    masked = _ADDRESS_RE.sub(_addr_sub, masked)

    # 7. Contextual personal names (preserving company name)
    protected_lower = {company.strip().lower()} if company and company.strip() else set()
    protected_lower |= _NON_NAME_WORDS

    for pat in _NAME_PATTERNS:
        def _name_sub(m: re.Match) -> str:
            candidate = m.group(1).strip()
            words = {w.lower() for w in candidate.split()}
            if candidate.lower() in protected_lower or words & protected_lower:
                return m.group(0)
            _record("person")
            start, end = m.span(1)
            full = m.group(0)
            rel_start = start - m.start(0)
            rel_end = end - m.start(0)
            return full[:rel_start] + "[PERSON]" + full[rel_end:]

        masked = pat.sub(_name_sub, masked)

    return PIIMaskResult(
        masked_text=masked,
        pii_detected=sum(counts.values()) > 0,
        counts=counts,
    )
