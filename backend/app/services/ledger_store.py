"""
backend/app/services/ledger_store.py — Shared ~/.aftermath/ledger.json & inbox.json store.

Provides atomic, lock-protected file persistence for synchronized extension
ledger items and MCP/Claude Desktop observation write-back events.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional


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


@contextmanager
def _data_lock(timeout_seconds: float = 5.0) -> Iterator[None]:
    """Cross-platform exclusive lockfile for ledger/inbox read-modify-write."""
    lock_path = get_data_dir() / ".aftermath.lock"
    deadline = time.monotonic() + timeout_seconds
    fd: Optional[int] = None
    while True:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
            break
        except FileExistsError:
            # Break stale locks older than 30 seconds
            try:
                if time.time() - lock_path.stat().st_mtime > 30:
                    lock_path.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            if time.monotonic() >= deadline:
                raise TimeoutError("Timed out acquiring aftermath ledger lock")
            time.sleep(0.01)
    try:
        yield
    finally:
        if fd is not None:
            os.close(fd)
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass


def _atomic_write_json(path: Path, payload: Any) -> None:
    tmp = path.with_suffix(f".{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _read_ledger_unlocked() -> dict[str, Any]:
    path = get_ledger_path()
    if not path.exists():
        return {"schema_version": "1.0", "updated_at": None, "skew": 0, "items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return {"schema_version": "1.0", "updated_at": None, "skew": 0, "items": data}
        if isinstance(data, dict):
            data.setdefault("schema_version", "1.0")
            data.setdefault("skew", 0)
            if not isinstance(data.get("items"), list):
                data["items"] = []
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return {"schema_version": "1.0", "updated_at": None, "skew": 0, "items": []}


def read_ledger() -> dict[str, Any]:
    return _read_ledger_unlocked()


def write_ledger(items: list[dict[str, Any]], *, skew: int = 0) -> dict[str, Any]:
    with _data_lock():
        return _write_ledger_unlocked(items, skew=skew)


def _write_ledger_unlocked(items: list[dict[str, Any]], *, skew: int = 0) -> dict[str, Any]:
    payload = {
        "schema_version": "1.0",
        "updated_at": _now_iso(),
        "skew": skew,
        "items": items,
    }
    _atomic_write_json(get_ledger_path(), payload)
    return payload


def _read_inbox_unlocked() -> list[dict[str, Any]]:
    path = get_inbox_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def read_inbox() -> list[dict[str, Any]]:
    return _read_inbox_unlocked()


def _apply_observation_to_item(item: dict[str, Any], *, ok: bool, note: str, at_ms: int) -> None:
    existing_obs = item.get("observed")
    if isinstance(existing_obs, dict) and isinstance(existing_obs.get("at"), int):
        if existing_obs["at"] > at_ms:
            return
    item["observed"] = {"ok": ok, "note": note, "at": at_ms}
    if item.get("verified"):
        item["state"] = "VERIFIED"
    elif item.get("claimed") and not ok:
        item["state"] = "CONTRADICTION"
    else:
        item["state"] = "OBSERVED"


def merge_and_write_ledger(items: list[dict[str, Any]], *, skew: int = 0) -> tuple[dict[str, Any], int]:
    """
    Persist extension-synced items while preserving any unacknowledged inbox
    observations so POST /sync never overwrites a recent Claude/MCP write-back.
    """
    with _data_lock():
        pending = _read_inbox_unlocked()
        by_promise: dict[str, list[dict[str, Any]]] = {}
        for ev in pending:
            pid = str(ev.get("promise_id"))
            by_promise.setdefault(pid, []).append(ev)

        merged: list[dict[str, Any]] = []
        for raw in items:
            item = dict(raw)
            for ev in by_promise.get(str(item.get("id")), []):
                _apply_observation_to_item(
                    item,
                    ok=bool(ev.get("ok")),
                    note=str(ev.get("note", "")),
                    at_ms=int(ev.get("at") or int(time.time() * 1000)),
                )
            merged.append(item)

        saved = _write_ledger_unlocked(merged, skew=skew)
        return saved, len(pending)


def enqueue_observation(
    *,
    promise_id: int | str,
    ok: bool,
    note: str,
    at_ms: Optional[int] = None,
) -> tuple[dict[str, Any], bool]:
    """
    Record an observation write-back event in inbox.json (deduplicating identical
    pending events) and apply it immediately to ledger.json if matching id exists.
    """
    clean_note = note.strip()
    ts = at_ms if at_ms is not None else int(time.time() * 1000)

    with _data_lock():
        events = _read_inbox_unlocked()
        duplicate = next(
            (
                e
                for e in events
                if str(e.get("promise_id")) == str(promise_id)
                and bool(e.get("ok")) is bool(ok)
                and str(e.get("note", "")).strip() == clean_note
            ),
            None,
        )

        if duplicate is not None:
            event = duplicate
        else:
            event = {
                "event_id": uuid.uuid4().hex[:12],
                "promise_id": promise_id,
                "ok": bool(ok),
                "note": clean_note,
                "at": ts,
                "created_at": _now_iso(),
            }
            events.append(event)
            _atomic_write_json(get_inbox_path(), events)

        ledger = _read_ledger_unlocked()
        applied = False
        for item in ledger["items"]:
            if str(item.get("id")) == str(promise_id):
                _apply_observation_to_item(item, ok=bool(ok), note=clean_note, at_ms=ts)
                applied = True
                break

        if applied:
            _write_ledger_unlocked(ledger["items"], skew=ledger.get("skew", 0))

        return event, applied


def ack_inbox_events(event_ids: list[str]) -> int:
    with _data_lock():
        events = _read_inbox_unlocked()
        id_set = set(event_ids)
        remaining = [e for e in events if e.get("event_id") not in id_set]
        removed = len(events) - len(remaining)
        if removed > 0:
            _atomic_write_json(get_inbox_path(), remaining)
        return removed
