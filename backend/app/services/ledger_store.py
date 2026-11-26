"""
backend/app/services/ledger_store.py — Shared ~/.aftermath/ledger.json & inbox.json store.

Provides atomic file persistence for synchronized extension ledger items and
MCP/Claude Desktop observation write-back events.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def get_data_dir() -> Path:
    custom = os.environ.get("AFTERMATH_DATA_DIR")
    base = Path(custom) if custom else (Path.home() / ".aftermath")
    base.mkdir(parents=True, exist_ok=True)
    return base


def get_ledger_path() -> Path:
    custom_file = os.environ.get("AFTERMATH_LEDGER_PATH")
    if custom_file:
        p = Path(custom_file)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p
    return get_data_dir() / "ledger.json"


def get_inbox_path() -> Path:
    return get_data_dir() / "inbox.json"


def _atomic_write_json(path: Path, payload: Any) -> None:
    tmp = path.with_suffix(f".{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def read_ledger() -> dict[str, Any]:
    path = get_ledger_path()
    if not path.exists():
        return {
            "schema_version": "1.0",
            "updated_at": None,
            "skew": 0,
            "items": [],
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return {"schema_version": "1.0", "updated_at": None, "skew": 0, "items": data}
        if isinstance(data, dict):
            data.setdefault("schema_version", "1.0")
            data.setdefault("skew", 0)
            data.setdefault("items", [])
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return {"schema_version": "1.0", "updated_at": None, "skew": 0, "items": []}


def write_ledger(items: list[dict[str, Any]], *, skew: int = 0) -> dict[str, Any]:
    payload = {
        "schema_version": "1.0",
        "updated_at": _now_iso(),
        "skew": skew,
        "items": items,
    }
    _atomic_write_json(get_ledger_path(), payload)
    return payload


def read_inbox() -> list[dict[str, Any]]:
    path = get_inbox_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def write_inbox(events: list[dict[str, Any]]) -> None:
    _atomic_write_json(get_inbox_path(), events)


def enqueue_observation(
    *,
    promise_id: int | str,
    ok: bool,
    note: str,
    at_ms: Optional[int] = None,
) -> tuple[dict[str, Any], bool]:
    """
    Record an observation write-back event in inbox.json and apply it
    immediately to ledger.json if a matching promise_id exists.
    """
    ts = at_ms if at_ms is not None else int(time.time() * 1000)
    event = {
        "event_id": uuid.uuid4().hex[:12],
        "promise_id": promise_id,
        "ok": ok,
        "note": note.strip(),
        "at": ts,
        "created_at": _now_iso(),
    }

    events = read_inbox()
    events.append(event)
    write_inbox(events)

    ledger = read_ledger()
    applied = False
    for item in ledger["items"]:
        if str(item.get("id")) == str(promise_id):
            item["observed"] = {"ok": ok, "note": note.strip(), "at": ts}
            if item.get("verified"):
                item["state"] = "VERIFIED"
            elif item.get("claimed") and not ok:
                item["state"] = "CONTRADICTION"
            else:
                item["state"] = "OBSERVED"
            applied = True
            break

    if applied:
        write_ledger(ledger["items"], skew=ledger.get("skew", 0))

    return event, applied


def ack_inbox_events(event_ids: list[str]) -> int:
    events = read_inbox()
    id_set = set(event_ids)
    remaining = [e for e in events if e.get("event_id") not in id_set]
    removed = len(events) - len(remaining)
    if removed > 0:
        write_inbox(remaining)
    return removed
