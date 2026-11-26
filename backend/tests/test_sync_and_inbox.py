"""
backend/tests/test_sync_and_inbox.py — Tests for /sync, /inbox, and ~/.aftermath/ledger.json.
"""
from __future__ import annotations

import concurrent.futures
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
        r0 = tc.get("/sync")
        assert r0.status_code == 200
        assert r0.json()["items"] == []

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

        assert (isolated_data_dir / "ledger.json").exists()
        r2 = tc.get("/sync")
        assert r2.status_code == 200
        assert len(r2.json()["items"]) == 1
        assert r2.json()["items"][0]["id"] == 1001


def test_sync_preserves_unacknowledged_inbox_observation(isolated_data_dir: Path):
    """POST /sync must not clobber an unacknowledged MCP/inbox observation."""
    with TestClient(app) as tc:
        tc.post(
            "/sync",
            json={
                "items": [
                    {
                        "id": 3003,
                        "company": "ShopKart",
                        "promise": "Refund within 5 business days.",
                        "claimed": {"text": "Processed.", "at": 1764477000000},
                    }
                ]
            },
        )
        tc.post(
            "/inbox",
            json={
                "promise_id": 3003,
                "ok": False,
                "note": "No refund received.",
                "at_ms": 1764563400000,
            },
        )
        # Extension pushes stale copy without the observation before pulling /inbox
        r_sync = tc.post(
            "/sync",
            json={
                "items": [
                    {
                        "id": 3003,
                        "company": "ShopKart",
                        "promise": "Refund within 5 business days.",
                        "claimed": {"text": "Processed.", "at": 1764477000000},
                    }
                ]
            },
        )
        assert r_sync.status_code == 200
        assert r_sync.json()["pending_inbox_count"] == 1
        synced = tc.get("/sync").json()
        assert synced["items"][0]["state"] == "CONTRADICTION"
        assert synced["items"][0]["observed"]["note"] == "No refund received."


def test_inbox_observation_write_back_dedup_and_ack(isolated_data_dir: Path):
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

        r_obs1 = tc.post(
            "/inbox",
            json={
                "promise_id": 2002,
                "ok": False,
                "note": "Checked My Bank: ₹0.00 credited.",
                "at_ms": 1764563400000,
            },
        )
        # Duplicate identical observation should deduplicate to the same event_id
        r_obs2 = tc.post(
            "/inbox",
            json={
                "promise_id": 2002,
                "ok": False,
                "note": "Checked My Bank: ₹0.00 credited.",
                "at_ms": 1764563400000,
            },
        )
        assert r_obs1.status_code == 200
        assert r_obs2.status_code == 200
        event_id = r_obs1.json()["event_id"]
        assert r_obs2.json()["event_id"] == event_id

        inbox_before = tc.get("/inbox").json()
        assert inbox_before["count"] == 1

        ack_resp = tc.post("/inbox/ack", json={"event_ids": [event_id]})
        assert ack_resp.status_code == 200
        assert ack_resp.json()["acknowledged"] == 1
        assert tc.get("/inbox").json()["count"] == 0


def test_malformed_json_files_handled_safely(isolated_data_dir: Path):
    (isolated_data_dir / "ledger.json").write_text("{broken json", encoding="utf-8")
    (isolated_data_dir / "inbox.json").write_text("{broken json", encoding="utf-8")
    with TestClient(app) as tc:
        assert tc.get("/sync").json()["items"] == []
        assert tc.get("/inbox").json()["events"] == []


def test_concurrent_inbox_writes_do_not_lose_events(isolated_data_dir: Path):
    with TestClient(app) as tc:
        tc.post(
            "/sync",
            json={
                "items": [
                    {"id": i, "company": "ShopKart", "promise": f"Promise {i}"}
                    for i in range(1, 6)
                ]
            },
        )

        def _post(i: int):
            return tc.post(
                "/inbox",
                json={"promise_id": i, "ok": False, "note": f"Observation {i}"},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(_post, range(1, 6)))
        assert all(r.status_code == 200 for r in results)
        assert tc.get("/inbox").json()["count"] == 5


def test_validation_rejects_invalid_sync_and_inbox():
    with TestClient(app) as tc:
        assert tc.post("/inbox", json={"promise_id": 1, "ok": False, "note": "   "}).status_code == 422
        assert tc.post("/sync", json={"items": [{"id": 1, "company": "", "promise": ""}]}).status_code == 422
