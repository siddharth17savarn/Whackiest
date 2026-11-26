#!/usr/bin/env python3
"""AFTERMATH LIVE MCP server (stdio, zero external dependencies).
Exposes live commitment ledger (AFTERMATH_LEDGER) tools & resources to MCP clients (e.g. Claude Desktop).
Run: AFTERMATH_LEDGER=/path/to/ledger.json python aftermath_mcp_v3.py"""
import json
import os
import sys
import tempfile
import time
from datetime import date

PATH = os.environ.get("AFTERMATH_LEDGER", "ledger.json")


def _load_ledger():
    try:
        with open(PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except FileNotFoundError:
        return []
    except Exception as exc:
        raise RuntimeError(f"Failed to read ledger at {PATH}: {exc}") from exc


def _save_ledger(items):
    directory = os.path.dirname(os.path.abspath(PATH)) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".ledger_", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=2)
        os.replace(tmp_path, PATH)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _status(c):
    return (c.get("state") or c.get("status") or "PROMISED").upper()


def _is_overdue(c):
    st = _status(c)
    if st == "VERIFIED" or c.get("verified") is True:
        return False
    if st == "OVERDUE":
        return True
    dl = c.get("deadline")
    return bool(dl) and dl < date.today().isoformat()


def _is_contradiction(c):
    st = _status(c)
    return st != "VERIFIED" and (st == "CONTRADICTION" or c.get("observedOk") is False)


def _is_broken(c):
    st = _status(c)
    return st != "VERIFIED" and (_is_overdue(c) or _is_contradiction(c))


def _brief(c):
    st = _status(c)
    return {
        "id": c.get("id"),
        "company": c.get("company"),
        "promise": c.get("promise"),
        "deadline": c.get("deadline"),
        "originalDeadline": c.get("originalDeadline"),
        "status": st,
        "state": st,
        "conditions": c.get("conditions"),
        "revisions": c.get("revisions"),
        "claimEvidence": c.get("claimEvidence"),
        "observedOk": c.get("observedOk"),
        "observedNote": c.get("observedNote"),
        "overdue": _is_overdue(c),
        "contradiction": _is_contradiction(c),
    }


def _find(item_id):
    return next((c for c in _load_ledger() if c.get("id") == item_id), None)


def _dispute_summary(c):
    tl = "\n".join(
        f"- {t.get('status', '?')}: {t.get('note', '')}" for t in (c.get("timeline") or [])
    )
    st = _status(c)
    contradiction_line = (
        f"Contradiction: YES ({c.get('observedNote') or 'User observed unfulfilled'})"
        if _is_contradiction(c)
        else "Contradiction: No"
    )
    return (
        f"Subject: Unfulfilled commitment - {(c.get('promise') or '')[:70]}\n\n"
        f"Company: {c.get('company', 'Unknown')}\n"
        f"Promise: {c.get('promise', '')}\n"
        f"Original statement: \"{c.get('evidence', '')}\"\n"
        f"Original deadline: {c.get('originalDeadline') or c.get('deadline') or 'none'}\n"
        f"Current deadline: {c.get('deadline') or 'none'}\n"
        f"Completion claim: {c.get('claimEvidence') or 'None recorded'}\n"
        f"User observation: {c.get('observedNote') or ('Received' if c.get('observedOk') else 'Not recorded')}\n"
        f"Status: {st} | Overdue: {'YES' if _is_overdue(c) else 'No'} | {contradiction_line}\n"
        f"Source: {c.get('source') or 'n/a'}\n\n"
        f"Timeline:\n{tl}\n\n"
        f"Evidence ID (SHA-256): {(c.get('hash') or 'n/a')[:16]}\n"
        "Please resolve or escalate with a grievance reference number."
    )


def _stats():
    items = _load_ledger()
    counts = {}
    by_company = {}
    for c in items:
        st = _status(c)
        counts[st] = counts.get(st, 0) + 1
        co = c.get("company") or "Unknown"
        entry = by_company.setdefault(co, {"total": 0, "verified": 0, "overdue": 0, "contradictions": 0})
        entry["total"] += 1
        if st == "VERIFIED":
            entry["verified"] += 1
        if _is_overdue(c):
            entry["overdue"] += 1
        if _is_contradiction(c):
            entry["contradictions"] += 1
    return {
        "total": len(items),
        "overdue": sum(1 for c in items if _is_overdue(c)),
        "contradictions": sum(1 for c in items if _is_contradiction(c)),
        "by_state": counts,
        "by_company": by_company,
    }


def _tool_list_promises(args):
    status_filter = (args.get("status") or "").strip().upper()
    items = _load_ledger()
    if status_filter:
        items = [c for c in items if _status(c) == status_filter]
    return [_brief(c) for c in items]


def _tool_check_overdue(_args):
    return [_brief(c) for c in _load_ledger() if _is_broken(c)]


def _tool_generate_dispute_summary(args):
    item_id = args.get("id")
    if not item_id:
        return {"error": "Missing required argument: id"}
    c = _find(item_id)
    if not c:
        return {"error": f"Promise not found: {item_id}"}
    return _dispute_summary(c)


def _tool_get_evidence(args):
    item_id = args.get("id")
    if not item_id:
        return {"error": "Missing required argument: id"}
    return _find(item_id) or {"error": f"Promise not found: {item_id}"}


def _tool_add_observation(args):
    item_id = args.get("id")
    ok = args.get("ok")
    note = str(args.get("note") or "").strip()
    if not item_id or not isinstance(ok, bool):
        return {"error": "Arguments required: id (string), ok (boolean), optional note (string)"}
    items = _load_ledger()
    target = next((c for c in items if c.get("id") == item_id), None)
    if not target:
        return {"error": f"Promise not found: {item_id}"}
    ts = int(time.time() * 1000)
    target["observedOk"] = ok
    target["observedNote"] = note or None
    target["observed"] = {"ok": ok, "note": note, "at": ts}
    tl = target.setdefault("timeline", [])
    tl.append({
        "status": "OBSERVED",
        "ts": ts,
        "note": ("Observed: received" if ok else "Observed: NOT received") + (f" - {note}" if note else ""),
    })
    next_state = "OBSERVED" if ok else "CONTRADICTION"
    if not ok:
        tl.append({
            "status": "CONTRADICTION",
            "ts": ts,
            "note": "Contradiction recorded via MCP observation",
        })
    target["state"] = next_state
    target["status"] = next_state
    _save_ledger(items)
    return _brief(target)


TOOLS = {
    "list_promises": (
        "List tracked company promises, optionally filtered by status (PROMISED/CLAIMED/OBSERVED/VERIFIED/OVERDUE/CONTRADICTION)",
        {"status": {"type": "string"}},
        _tool_list_promises,
    ),
    "check_overdue": (
        "Return promises that are currently overdue or contradicted by user observation",
        {},
        _tool_check_overdue,
    ),
    "generate_dispute_summary": (
        "Generate an evidence-backed dispute summary for a commitment ID",
        {"id": {"type": "string"}},
        _tool_generate_dispute_summary,
    ),
    "add_observation": (
        "Record a user observation (ok: boolean, note: string) for a promise ID and persist to the ledger",
        {
            "id": {"type": "string"},
            "ok": {"type": "boolean"},
            "note": {"type": "string"},
        },
        _tool_add_observation,
    ),
    # Backwards-compatible V0.3.0 aliases
    "list_commitments": (
        "Alias for list_promises",
        {"status": {"type": "string"}},
        _tool_list_promises,
    ),
    "broken_promises": (
        "Alias for check_overdue",
        {},
        _tool_check_overdue,
    ),
    "get_evidence": (
        "Full evidence timeline, original message and chat context for one commitment",
        {"id": {"type": "string"}},
        _tool_get_evidence,
    ),
    "draft_escalation": (
        "Alias for generate_dispute_summary",
        {"id": {"type": "string"}},
        _tool_generate_dispute_summary,
    ),
}

RESOURCES = [
    {
        "uri": "aftermath://ledger",
        "name": "Promise Ledger",
        "description": "Complete live promise ledger JSON",
        "mimeType": "application/json",
    },
    {
        "uri": "aftermath://overdue",
        "name": "Overdue Promises",
        "description": "Currently overdue and contradicted promises",
        "mimeType": "application/json",
    },
    {
        "uri": "aftermath://stats",
        "name": "Statistics",
        "description": "Live promise counts and company reliability stats",
        "mimeType": "application/json",
    },
]


def _read_resource(uri):
    if uri == "aftermath://ledger":
        return json.dumps([_brief(c) for c in _load_ledger()], indent=2)
    if uri == "aftermath://overdue":
        return json.dumps([_brief(c) for c in _load_ledger() if _is_broken(c)], indent=2)
    if uri == "aftermath://stats":
        return json.dumps(_stats(), indent=2)
    return None


def reply(id_, result=None, error=None):
    m = {"jsonrpc": "2.0", "id": id_}
    m.update({"error": error} if error else {"result": result})
    print(json.dumps(m), flush=True)


def main():
    for line in sys.stdin:
        try:
            r = json.loads(line)
        except Exception:
            continue
        m, id_ = r.get("method"), r.get("id")
        if id_ is None:
            continue
        params = r.get("params") or {}
        try:
            if m == "initialize":
                reply(id_, {
                    "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                    "capabilities": {"tools": {}, "resources": {}},
                    "serverInfo": {"name": "aftermath-live", "version": "0.3.1"},
                })
            elif m == "tools/list":
                reply(id_, {
                    "tools": [
                        {
                            "name": name,
                            "description": desc,
                            "inputSchema": {"type": "object", "properties": props},
                        }
                        for name, (desc, props, _) in TOOLS.items()
                    ]
                })
            elif m == "tools/call":
                name = params.get("name")
                args = params.get("arguments") or {}
                if name not in TOOLS:
                    reply(id_, error={"code": -32602, "message": f"Unknown tool: {name}"})
                else:
                    out = TOOLS[name][2](args)
                    reply(id_, {
                        "content": [{
                            "type": "text",
                            "text": out if isinstance(out, str) else json.dumps(out, indent=2),
                        }]
                    })
            elif m == "resources/list":
                reply(id_, {"resources": RESOURCES})
            elif m == "resources/read":
                uri = params.get("uri")
                content = _read_resource(uri)
                if content is None:
                    reply(id_, error={"code": -32602, "message": f"Unknown resource: {uri}"})
                else:
                    reply(id_, {
                        "contents": [{"uri": uri, "mimeType": "application/json", "text": content}]
                    })
            elif m == "ping":
                reply(id_, {})
            else:
                reply(id_, error={"code": -32601, "message": f"Method not found: {m}"})
        except Exception as exc:
            reply(id_, error={"code": -32000, "message": str(exc)})


if __name__ == "__main__":
    main()
