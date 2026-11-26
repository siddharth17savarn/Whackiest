"""
backend/tests/test_pii_masking.py — Unit tests for PII detection and masking.
"""
from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.app.services.pii_masking import mask_pii  # noqa: E402


def test_masks_email_and_phone():
    msg = "Please reach me at priya.sharma@example.com or +91 98765 43210; refund within 5 business days."
    res = mask_pii(msg, company="ShopKart")
    assert res.pii_detected is True
    assert "[EMAIL]" in res.masked_text
    assert "[PHONE]" in res.masked_text
    assert "priya.sharma@example.com" not in res.masked_text
    assert "98765" not in res.masked_text
    assert "within 5 business days" in res.masked_text


def test_masks_card_account_and_upi():
    msg = (
        "We will credit card 4532-1234-5678-9012 or account no: 123456789012 "
        "(UPI rahul@okaxis) within 3 business days."
    )
    res = mask_pii(msg, company="ShopKart")
    assert "[CARD]" in res.masked_text
    assert "[ACCOUNT]" in res.masked_text
    assert "[UPI]" in res.masked_text
    assert "4532" not in res.masked_text
    assert "123456789012" not in res.masked_text
    assert "rahul@okaxis" not in res.masked_text
    assert "within 3 business days" in res.masked_text


def test_masks_physical_address():
    msg = "Your replacement will be delivered to 42 MG Road, Indiranagar, Bengaluru 560038 by tomorrow."
    res = mask_pii(msg, company="ShopKart")
    assert "[ADDRESS]" in res.masked_text
    assert "MG Road" not in res.masked_text
    assert "by tomorrow" in res.masked_text


def test_masks_person_name_but_preserves_company_and_amounts():
    msg = "Hi, I'm Priya from ShopKart Support. Your refund of ₹2,499 will be processed within 5 business days."
    res = mask_pii(msg, company="ShopKart")
    assert "[PERSON]" in res.masked_text
    assert "Priya" not in res.masked_text
    assert "ShopKart" in res.masked_text
    assert "₹2,499" in res.masked_text
    assert "within 5 business days" in res.masked_text


def test_preserves_order_ids_and_dates_and_non_pii():
    msg = "Order #SK-9042 will ship on 2026-12-01 within 3-5 business days."
    res = mask_pii(msg, company="ShopKart")
    assert res.pii_detected is False
    assert res.masked_text == msg


def test_empty_input():
    res = mask_pii("", company="ShopKart")
    assert res.pii_detected is False
    assert res.masked_text == ""
