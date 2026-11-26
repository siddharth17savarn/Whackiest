"""
backend/tests/test_day3.py — Day 3 tests for:
  - Confidence calibration methodology & 50-sample evaluation
  - /export valid response, missing evidence, schema validation, PII masking, timeline accuracy
  - Fake bank/order status page & judge reset functionality
  - backend/run.py startup module check
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.main import app  # noqa: E402
from backend.app.schemas import ExportResponse  # noqa: E402
from backend.app.services.calibration import evaluate_dataset  # noqa: E402

CREATED_MS = int(datetime(2026, 11, 26, 10, 0, 0).timestamp() * 1000)
CLAIMED_MS = int(datetime(2026, 11, 30, 10, 0, 0).timestamp() * 1000)
OBSERVED_MS = int(datetime(2026, 12, 1, 10, 0, 0).timestamp() * 1000)
DUE_MS = int(datetime(2026, 12, 3, 18, 0, 0).timestamp() * 1000)
NOW_AFTER_MS = int(datetime(2026, 12, 4, 10, 0, 0).timestamp() * 1000)


# ── Confidence calibration tests ────────────────────────────────────────

def test_calibration_methodology_and_sweep():
    report = asyncio.run(evaluate_dataset())
    assert report.total_samples == 50
    assert report.promise_existence.tp == 40
    assert report.promise_existence.tn == 10
    assert report.promise_existence.fp == 0
    assert report.promise_existence.fn == 0
    assert report.promise_existence.f1 == 1.0
    assert report.category_accuracy == 1.0
    assert report.recommended_threshold == 0.55

    # Verify FP decreases as threshold rises from 0.30 -> 0.55
    by_t = {p.threshold: p for p in report.threshold_sweep}
    assert by_t[0.30].auto_accept_vague_fp == 7
    assert by_t[0.55].auto_accept_vague_fp == 0
    assert by_t[0.55].manual_review_promises == 7
    assert by_t[0.55].rejected_tn == 10
    assert by_t[0.55].concrete_f1 == 1.0
    assert by_t[0.55].positive_coverage == 0.825
    # At 0.60, medium without deadline (0.58) is routed to manual review
    assert by_t[0.60].concrete_missed_to_review == 1


# ── /export endpoint tests ──────────────────────────────────────────────

def test_export_valid_contradiction_case_and_timeline():
    with TestClient(app) as tc:
        resp = tc.post(
            "/export",
            json={
                "items": [
                    {
                        "id": 101,
                        "company": "ShopKart",
                        "promise": "Your refund of ₹2,499 will be processed within 5 business days.",
                        "due": DUE_MS,
                        "confidence": 0.90,
                        "condition": "provided return is scanned",
                        "evidence": "Your refund of ₹2,499 will be processed within 5 business days.",
                        "chat": "http://localhost:8000/demo_shopkart_chat.html",
                        "created": CREATED_MS,
                        "claimed": {
                            "text": "Good news: your refund has been processed on our side.",
                            "at": CLAIMED_MS,
                        },
                        "observed": {
                            "ok": False,
                            "note": "My Bank shows ₹0.00 credited.",
                            "at": OBSERVED_MS,
                        },
                        "verified": False,
                    }
                ],
                "now_ms": NOW_AFTER_MS,
            },
        )
    assert resp.status_code == 200
    data = ExportResponse.model_validate(resp.json())
    assert data.total_cases == 1
    assert data.summary.contradictions == 1
    assert data.summary.overdue == 1
    case = data.cases[0]
    assert case.state == "CONTRADICTION"
    assert case.is_overdue is True
    assert case.claim_vs_observation.claimed is True
    assert case.claim_vs_observation.observed is True
    assert case.claim_vs_observation.observed_ok is False
    assert case.claim_vs_observation.contradiction is True

    # Timeline must be strictly chronological: PROMISED -> CLAIMED -> OBSERVED -> DEADLINE_PASSED
    events = [e.event for e in case.timeline]
    assert events == ["PROMISED", "CLAIMED", "OBSERVED", "DEADLINE_PASSED"]
    timestamps = [e.timestamp_ms for e in case.timeline]
    assert timestamps == sorted(timestamps)


def test_export_missing_incomplete_evidence_never_invents_fields():
    with TestClient(app) as tc:
        resp = tc.post(
            "/export",
            json={
                "items": [
                    {
                        "id": "partial-1",
                        "company": "SwiftPay",
                        "promise": "We will look into this.",
                        # due, evidence, chat, created, claimed, observed all omitted
                    }
                ],
                "now_ms": NOW_AFTER_MS,
            },
        )
    assert resp.status_code == 200
    data = ExportResponse.model_validate(resp.json())
    case = data.cases[0]
    assert case.state == "PROMISED"
    assert case.original_quote is None
    assert case.due_ms is None
    assert case.due_at is None
    assert case.created_ms is None
    assert case.created_at is None
    assert case.claim_vs_observation.claimed is False
    assert case.claim_vs_observation.observed is False
    assert [e.event for e in case.timeline] == ["PROMISED"]


def test_export_masks_pii_in_quotes_claims_and_observations():
    with TestClient(app) as tc:
        resp = tc.post(
            "/export",
            json={
                "items": [
                    {
                        "id": 202,
                        "company": "ShopKart",
                        "promise": "Hi, I'm Priya from ShopKart. Refund to rahul@okaxis within 5 business days.",
                        "evidence": "Contact me at priya@example.com or +91 98765 43210.",
                        "created": CREATED_MS,
                        "claimed": {
                            "text": "Sent to card 4532-1234-5678-9012.",
                            "at": CLAIMED_MS,
                        },
                        "observed": {
                            "ok": False,
                            "note": "Checked account no: 123456789012 — no credit.",
                            "at": OBSERVED_MS,
                        },
                    }
                ],
                "now_ms": CLAIMED_MS,
            },
        )
    assert resp.status_code == 200
    data = ExportResponse.model_validate(resp.json())
    case = data.cases[0]
    assert case.pii_masked is True
    assert "priya@example.com" not in (case.original_quote or "")
    assert "[EMAIL]" in (case.original_quote or "")
    assert "[PHONE]" in (case.original_quote or "")
    assert "[UPI]" in case.promise
    assert "[PERSON]" in case.promise
    assert "4532" not in (case.claim_vs_observation.claim_quote or "")
    assert "[CARD]" in (case.claim_vs_observation.claim_quote or "")
    assert "123456789012" not in (case.claim_vs_observation.observation_note or "")
    assert "[ACCOUNT]" in (case.claim_vs_observation.observation_note or "")


def test_export_schema_validation_rejects_invalid_item():
    with TestClient(app) as tc:
        resp = tc.post(
            "/export",
            json={"items": [{"id": 1, "company": "", "promise": ""}]},
        )
    assert resp.status_code == 422


# ── Fake bank page & startup script checks ──────────────────────────────

def test_fake_bank_page_features_and_judge_reset():
    html = (REPO_ROOT / "demo_bank_status.html").read_text(encoding="utf-8")
    assert "#SK-9042" in html
    assert "#SP-4410" in html
    assert "₹2,499.00" in html
    assert "NOT CREDITED" in html
    assert "COMPANY CLAIMED" in html
    assert "USER OBSERVED" in html
    assert "toggleStatusBtn" in html
    assert "judgeResetBtn" in html
    assert "localStorage.removeItem(STORAGE_KEY)" in html
    assert "demo_shopkart_chat.html" in html

    chat_html = (REPO_ROOT / "demo_shopkart_chat.html").read_text(encoding="utf-8")
    assert "(demo/fictional)" in chat_html


def test_backend_run_script_imports_cleanly():
    import backend.run as run_mod
    assert callable(run_mod.main)
