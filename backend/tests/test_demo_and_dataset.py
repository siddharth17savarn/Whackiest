"""
backend/tests/test_demo_and_dataset.py — Tests for:
  - Upgraded ShopKart + SwiftPay demo HTML (6 scenarios, typing, streaming, half-written)
  - Incomplete streaming message guard in /extract
  - 50-message labelled dataset schema, distribution, and offline extraction baseline
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.config import Settings, get_settings  # noqa: E402
from backend.app.main import app  # noqa: E402

THU_MS = int(datetime(2026, 11, 26, 10, 0, 0).timestamp() * 1000)


def _offline_settings() -> Settings:
    return Settings(gemini_api_key=None, _env_file=None)


# ── ShopKart demo HTML checks ───────────────────────────────────────────

def test_demo_html_has_six_scenarios_two_companies_and_streaming():
    html = (REPO_ROOT / "demo_shopkart_chat.html").read_text(encoding="utf-8")
    for key in ("refund", "delivery", "shortly", "conditional", "moved_deadline", "claim_vs_reality"):
        assert key in html, f"Missing scenario key: {key}"
    assert "ShopKart" in html
    assert "SwiftPay" in html
    assert "is typing" in html
    assert "data-streaming" in html
    assert "halfWritten" in html


def test_incomplete_streaming_message_is_not_extracted():
    app.dependency_overrides[get_settings] = _offline_settings
    try:
        with TestClient(app) as tc:
            resp = tc.post(
                "/extract",
                json={
                    "text": "Your refund of ₹2,499 will be processed within...",
                    "company": "ShopKart",
                    "now_ms": THU_MS,
                    "is_streaming": True,
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_promise"] is False
        assert body["promises"] == []
        assert body["fallback_reason"] == "streaming_incomplete"
    finally:
        app.dependency_overrides.clear()


# ── 50-message labelled dataset checks ──────────────────────────────────

def test_labelled_dataset_schema_and_counts():
    data = json.loads((REPO_ROOT / "datasets" / "labelled_50.json").read_text(encoding="utf-8"))
    assert len(data) == 50

    required_keys = {
        "message_id",
        "scenario",
        "company",
        "message",
        "expected_promise",
        "expected_company",
        "expected_deadline",
        "expected_condition",
        "expected_confidence_category",
    }
    ids = set()
    for row in data:
        assert required_keys.issubset(row.keys())
        assert row["message_id"] not in ids
        ids.add(row["message_id"])
        assert row["company"] in {"ShopKart", "SwiftPay"}
        assert row["expected_confidence_category"] in {"high", "medium", "low", "none"}

    positives = sum(1 for r in data if r["expected_promise"])
    negatives = sum(1 for r in data if not r["expected_promise"])
    assert positives == 40
    assert negatives == 10


def test_labelled_dataset_offline_extraction_matches_labels():
    data = json.loads((REPO_ROOT / "datasets" / "labelled_50.json").read_text(encoding="utf-8"))
    app.dependency_overrides[get_settings] = _offline_settings
    try:
        with TestClient(app) as tc:
            for row in data:
                resp = tc.post(
                    "/extract",
                    json={
                        "text": row["message"],
                        "company": row["company"],
                        "now_ms": THU_MS,
                    },
                )
                assert resp.status_code == 200
                body = resp.json()
                assert body["is_promise"] == row["expected_promise"], (
                    f"{row['message_id']} is_promise mismatch: {body['is_promise']} != {row['expected_promise']}"
                )
                if row["expected_promise"]:
                    p = body["promises"][0]
                    assert p["deadline_method"] == row["expected_deadline"], (
                        f"{row['message_id']} deadline_method mismatch"
                    )
                    assert p["confidence_level"] == row["expected_confidence_category"], (
                        f"{row['message_id']} confidence_level mismatch"
                    )
                    if row["expected_condition"]:
                        assert p["condition"] == row["expected_condition"], (
                            f"{row['message_id']} condition mismatch"
                        )
    finally:
        app.dependency_overrides.clear()
