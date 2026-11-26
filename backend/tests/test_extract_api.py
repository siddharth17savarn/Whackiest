"""
backend/tests/test_extract_api.py — Day 1 unit & API tests for AFTERMATH LIVE.

Covers all 12 required scenarios without making any paid/live Gemini API calls:
  1. Explicit refund promise
  2. Delivery commitment
  3. Vague "shortly" message
  4. Conditional promise
  5. Changed deadline
  6. No-promise message (and pure claim)
  7. Invalid API response from Gemini -> automatic offline fallback
  8. Missing Gemini API key -> offline fallback
  9. Gemini timeout -> automatic offline fallback
 10. Offline fallback preserves schema and shared business-day math
 11. Request & response Pydantic schema validation
 12. Confidence score correctness across tiers (high / medium / low / none)
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# Ensure repo root is on sys.path so `backend.*` and `shared.*` resolve cleanly
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.app.config import Settings, get_settings  # noqa: E402
from backend.app.extractor import extract_promises  # noqa: E402
from backend.app.gemini_client import GeminiFunctionArgs  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.schemas import ExtractRequest, ExtractResponse  # noqa: E402
from shared.deadline_parser import add_business_days  # noqa: E402

# Fixed anchor: Thursday 2026-11-26 10:00:00 local time
THU_MS = int(datetime(2026, 11, 26, 10, 0, 0).timestamp() * 1000)


def _make_fake_gemini_response(args_dict: dict) -> SimpleNamespace:
    """Build a minimal object matching google-genai GenerateContentResponse shape."""
    return SimpleNamespace(
        candidates=[
            SimpleNamespace(
                content=SimpleNamespace(
                    parts=[
                        SimpleNamespace(
                            function_call=SimpleNamespace(
                                name="extract_customer_promise",
                                args=args_dict,
                            )
                        )
                    ]
                )
            )
        ]
    )


def _offline_settings() -> Settings:
    return Settings(gemini_api_key=None, _env_file=None)


def _gemini_settings() -> Settings:
    return Settings(
        gemini_api_key="test-fake-key-never-sent",
        gemini_model="gemini-2.5-flash",
        gemini_timeout_seconds=1.0,
        _env_file=None,
    )


@pytest.fixture
def client():
    app.dependency_overrides[get_settings] = _offline_settings
    with TestClient(app) as tc:
        yield tc
    app.dependency_overrides.clear()


# ── /health endpoint ────────────────────────────────────────────────────

def test_health_offline_mode(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["gemini_configured"] is False
    assert body["extraction_mode"] == "offline_only"


def test_health_gemini_configured():
    app.dependency_overrides[get_settings] = _gemini_settings
    try:
        with TestClient(app) as tc:
            resp = tc.get("/health")
            assert resp.status_code == 200
            body = resp.json()
            assert body["gemini_configured"] is True
            assert body["extraction_mode"] == "gemini_with_offline_fallback"
    finally:
        app.dependency_overrides.clear()


# ── 1. Explicit refund promise ──────────────────────────────────────────

def test_1_explicit_refund_promise_offline(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "Your refund of Rs 2,499 will be processed within 5 business days.",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.is_promise is True
    assert data.is_claim is False
    assert data.extraction_method == "offline"
    assert len(data.promises) == 1
    p = data.promises[0]
    assert p.company == "ShopKart"
    assert p.due_ms == add_business_days(THU_MS, 5)
    assert p.deadline_method == "biz_days"
    assert p.confidence >= 0.85
    assert p.confidence_level == "high"


def test_1_explicit_refund_promise_gemini_mocked():
    fake_resp = _make_fake_gemini_response(
        {
            "is_promise": True,
            "is_claim": False,
            "company": "ShopKart",
            "promise": "Refund of Rs 2,499 will be processed within 5 business days.",
            "original_quote": "Your refund of Rs 2,499 will be processed within 5 business days.",
            "deadline_phrase": "within 5 business days",
            "deadline_hours": None,
            "condition": None,
            "clarity": "explicit",
        }
    )

    class FakeClient:
        def __init__(self, api_key: str):
            self.models = SimpleNamespace(generate_content=lambda **kwargs: fake_resp)

    app.dependency_overrides[get_settings] = _gemini_settings
    try:
        with patch("backend.app.gemini_client.genai.Client", FakeClient):
            with TestClient(app) as tc:
                resp = tc.post(
                    "/extract",
                    json={
                        "text": "Your refund of Rs 2,499 will be processed within 5 business days.",
                        "company": "ShopKart",
                        "now_ms": THU_MS,
                    },
                )
        assert resp.status_code == 200
        data = ExtractResponse.model_validate(resp.json())
        assert data.extraction_method == "gemini"
        assert data.is_promise is True
        assert data.promises[0].due_ms == add_business_days(THU_MS, 5)
        assert data.promises[0].confidence >= 0.85
        assert data.promises[0].confidence_level == "high"
    finally:
        app.dependency_overrides.clear()


# ── 2. Delivery commitment ──────────────────────────────────────────────

def test_2_delivery_commitment(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "Your replacement shipment will arrive within 3-5 business days.",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.is_promise is True
    assert data.promises[0].deadline_method == "biz_range"
    assert data.promises[0].due_ms == add_business_days(THU_MS, 5)
    assert data.promises[0].confidence == 0.80


# ── 3. Vague "shortly" message ──────────────────────────────────────────

def test_3_vague_shortly_message(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "Our escalations team will get back to you shortly.",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.is_promise is True
    p = data.promises[0]
    assert p.deadline_method == "vague_shortly"
    assert p.confidence == 0.40
    assert p.confidence_level == "low"


# ── 4. Conditional promise ──────────────────────────────────────────────

def test_4_conditional_promise(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "Your refund will be issued within 3 business days, provided the return package is scanned by the courier.",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.is_promise is True
    p = data.promises[0]
    assert p.condition == "provided the return package is scanned by the courier"
    assert p.due_ms == add_business_days(THU_MS, 3)
    assert p.confidence == 0.86
    assert p.confidence_level == "high"


# ── 5. Changed deadline ─────────────────────────────────────────────────

def test_5_changed_deadline(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "Apologies for the delay — your update will now arrive within 4 business days instead.",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.is_promise is True
    assert data.promises[0].due_ms == add_business_days(THU_MS, 4)


# ── 6. No-promise message & pure claim ──────────────────────────────────

def test_6_no_promise_greeting(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "Hi, I'm Priya from ShopKart Support. How can I help you today?",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.is_promise is False
    assert data.is_claim is False
    assert data.promises == []


def test_6_pure_claim_message(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "Good news: your refund has been processed on our side.",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.is_promise is False
    assert data.is_claim is True
    assert data.promises == []


# ── 7. Invalid API response -> fallback ─────────────────────────────────

def test_7_invalid_gemini_response_triggers_fallback():
    # Missing required fields in function call args
    bad_resp = _make_fake_gemini_response({"unexpected": "garbage"})

    class BadClient:
        def __init__(self, api_key: str):
            self.models = SimpleNamespace(generate_content=lambda **kwargs: bad_resp)

    app.dependency_overrides[get_settings] = _gemini_settings
    try:
        with patch("backend.app.gemini_client.genai.Client", BadClient):
            with TestClient(app) as tc:
                resp = tc.post(
                    "/extract",
                    json={
                        "text": "Your refund will be processed within 5 business days.",
                        "company": "ShopKart",
                        "now_ms": THU_MS,
                    },
                )
        assert resp.status_code == 200
        data = ExtractResponse.model_validate(resp.json())
        assert data.extraction_method == "offline"
        assert data.fallback_reason == "gemini_invalid_schema"
        assert data.is_promise is True
        assert data.promises[0].due_ms == add_business_days(THU_MS, 5)
    finally:
        app.dependency_overrides.clear()


# ── 8. Missing Gemini API key -> offline fallback ───────────────────────

def test_8_missing_api_key_uses_offline(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "We will update you by tomorrow.",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.extraction_method == "offline"
    assert data.fallback_reason == "no_api_key"
    assert data.is_promise is True


# ── 9. Gemini timeout -> offline fallback ───────────────────────────────

def test_9_gemini_timeout_triggers_fallback():
    async def slow_extract(*args, **kwargs):
        await asyncio.sleep(0.2)
        return GeminiFunctionArgs(is_promise=False)

    req = ExtractRequest(
        text="Your refund will be processed within 5 business days.",
        company="ShopKart",
        now_ms=THU_MS,
    )
    settings = Settings(
        gemini_api_key="test-fake-key",
        gemini_timeout_seconds=0.05,
        _env_file=None,
    )

    def blocking_generate(**kwargs):
        import time
        time.sleep(0.3)
        return _make_fake_gemini_response({})

    class SlowClient:
        def __init__(self, api_key: str):
            self.models = SimpleNamespace(generate_content=blocking_generate)

    result = asyncio.run(extract_promises(req, settings, client_factory=SlowClient))
    assert result.extraction_method == "offline"
    assert result.fallback_reason is not None
    assert "timeout" in result.fallback_reason
    assert result.is_promise is True
    assert result.promises[0].due_ms == add_business_days(THU_MS, 5)


# ── 10. Offline fallback works without network ──────────────────────────

def test_10_offline_fallback_no_network(client: TestClient):
    resp = client.post(
        "/extract",
        json={
            "text": "We have escalated your complaint, and you will receive an update by tomorrow.",
            "company": "ShopKart",
            "now_ms": THU_MS,
        },
    )
    assert resp.status_code == 200
    data = ExtractResponse.model_validate(resp.json())
    assert data.extraction_method == "offline"
    assert data.promises[0].extraction_method == "offline"
    assert data.promises[0].deadline_method == "tomorrow"
    assert data.promises[0].deadline_date is not None


# ── 11. Schema validation ───────────────────────────────────────────────

def test_11_schema_validation_rejects_blank_text(client: TestClient):
    resp = client.post("/extract", json={"text": "   ", "company": "ShopKart"})
    assert resp.status_code == 422


def test_11_schema_validation_rejects_negative_now_ms(client: TestClient):
    resp = client.post(
        "/extract",
        json={"text": "We will call you tomorrow.", "now_ms": -100},
    )
    assert resp.status_code == 422


# ── 12. Confidence score correctness ────────────────────────────────────

def test_12_confidence_tiers(client: TestClient):
    # High confidence: concrete deadline
    high = client.post(
        "/extract",
        json={"text": "We will refund you within 24 hours.", "now_ms": THU_MS},
    ).json()
    assert high["promises"][0]["confidence"] >= 0.80
    assert high["promises"][0]["confidence_level"] == "high"

    # Medium confidence: commitment without deadline
    med = client.post(
        "/extract",
        json={"text": "We will escalate this to our billing team.", "now_ms": THU_MS},
    ).json()
    assert 0.55 <= med["promises"][0]["confidence"] < 0.80
    assert med["promises"][0]["confidence_level"] == "medium"

    # Low confidence: vague phrase
    low = client.post(
        "/extract",
        json={"text": "We will resolve this ASAP.", "now_ms": THU_MS},
    ).json()
    assert low["promises"][0]["confidence"] < 0.55
    assert low["promises"][0]["confidence_level"] == "low"

    # None: no promise
    none_res = client.post(
        "/extract",
        json={"text": "Thank you for contacting ShopKart!", "now_ms": THU_MS},
    ).json()
    assert none_res["is_promise"] is False
    assert none_res["promises"] == []
