"""
backend/tests/test_sync_and_inbox.py — Tests for /sync and /inbox routers and ~/.aftermath/ledger.json.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.main import app  # noqa: E402


@pytest.fixture
def isolated_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AFTERMATH_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("AFTERMATH_LEDGER_PATH", raising=False)
    return tmp_path


def test_sync_get_and_post_persists_ledger_json(isolated_data_dir: Path):
    with TestClient(app) as tc:
        # Initially empty
        r0 = tc.get("/sync")
        assert r0.status_code == 200
        assert r0.json()["items"] == []

        # Push 1 item
        r1 = tc.post(
            "/sync",
            json={
                "skew": 259200000,
                "items": [
                    {
                        "id": 1001,
                        "company": "ShopKart",
                        "promise": "Refund within 5 business days.",
                        "due": 1764765000000,
                        "created": 1764131400000,
                        "claimed": {"text": "Refund processed.", "at": 1764477000000},
                    }
                ],
            },
        )
        assert r1.status_code == 200
        body = r1.json()
        assert body["synced_count"] == 1
        assert body["skew"] == 259200000

        # Verify file on disk and GET /sync
        assert (isolated_data_dir / "ledger.json").exists()
        r2 = tc.get("/sync")
        assert r2.status_code == 200
        assert len(r2.json()["items"]) == 1
        assert r2.json()["items"][0]["id"] == 1001


def test_inbox_observation_write_back_and_ack(isolated_data_dir: Path):
    with TestClient(app) as tc:
        tc.post(
            "/sync",
            json={
                "items": [
                    {
                        "id": 2002,
                        "company": "ShopKart",
                        "promise": "Refund within 5 business days.",
                        "claimed": {"text": "Processed.", "at": 1764477000000},
                    }
                ]
            },
        )

        # Post observation via /inbox
        r_obs = tc.post(
            "/inbox",
            json={
                "promise_id": 2002,
                "ok": False,
                "note": "Checked My Bank: ₹0.00 credited.",
                "at_ms": 1764563400000,
            },
        )
        assert r_obs.status_code == 200
        obs_body = r_obs.json()
        assert obs_body["applied_to_ledger"] is True
        event_id = obs_body["event_id"]

        # Verify ledger.json updated to CONTRADICTION
        synced = tc.get("/sync").json()
        assert synced["items"][0]["state"] == "CONTRADICTION"
        assert synced["items"][0]["observed"]["ok"] is False

        # Verify GET /inbox returns the pending event
        inbox_before = tc.get("/inbox").json()
        assert inbox_before["count"] == 1

        # Ack the event
        ack_resp = tc.post("/inbox/ack", json={"event_ids": [event_id]})
        assert ack_resp.status_code == 200
        assert ack_resp.json()["acknowledged"] == 1

        # Inbox is now empty
        assert tc.get("/inbox").json()["count"] == 0


def test_inbox_rejects_blank_note():
    with TestClient(app) as tc:
        resp = tc.post("/inbox", json={"promise_id": 1, "ok": False, "note": "   "})
    assert resp.status_code == 422
