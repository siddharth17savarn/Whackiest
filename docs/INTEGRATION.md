# Integration Guide — AFTERMATH LIVE v0.3.1

This document describes the contracts for integrating Vishal's FastAPI backend and Devashish's Node MCP bridge.

---

## Vishal's Backend Contract (`POST /extract`)

**Base URL:** `http://127.0.0.1:8000` (configurable via `backendUrl` storage key)

### Request

```json
POST /extract
Content-Type: application/json

{
  "text": "We will process your refund within 3 business days",
  "context": [
    "CUSTOMER: I haven't received my refund",
    "AGENT: We will process your refund within 3 business days"
  ]
}
```

### Response (success)

```json
{
  "is_promise": true,
  "promise": "We will process your refund within 3 business days",
  "deadline_iso": "2026-11-29",
  "conditions": null,
  "confidence": 0.92
}
```

### Response (not a promise)

```json
{ "is_promise": false }
```

### Notes

- `deadline_iso` must be `YYYY-MM-DD` or `null`
- Fallback: If backend returns `deadline_hours` (number), it is converted to `deadline_iso` by `bg/llm.js`
- Timeout: 4 seconds. After timeout, falls back to Gemini API or offline regex.
- PII masking (Vishal): apply before sending `text` and `context` to any external model
- 6-scenario picker (Vishal): select which company scenario to simulate in the demo

---

## Devashish's MCP Bridge Contract (`POST /sync`)

**Base URL:** `http://127.0.0.1:8000` (configurable via `syncUrl` storage key)
**Enable:** Set `syncEnabled: true` in extension storage

### Request

```json
POST /sync
Content-Type: application/json

{
  "ledger": [ /* array of toMcpRecord() output — see LEDGER_SCHEMA.md */ ],
  "updatedAt": "2026-11-26T12:00:00.000Z"
}
```

### MCP Server (Python stdio)

The existing `mcp/aftermath_mcp_v3.py` server is fully functional.

**Run:**
```powershell
$env:AFTERMATH_LEDGER = "path/to/ledger.json"
python mcp/aftermath_mcp_v3.py
```

**Tools exposed:**
- `broken_promises` — returns list of OVERDUE and CONTRADICTION items
- `get_ledger` — returns full ledger
- `update_status` — update an item's status

### HTML Dispute Report (Devashish)

Expected to generate a printable HTML report from ledger data.
Input: Same `toMcpRecord()` format as `/sync`.
Output: HTML file — not yet implemented (dependency on Devashish).

---

## Extension → Backend Message Flow

```
content-v3.js
  → chrome.runtime.sendMessage({action:'extract', text, context})
  → background-v3.js
  → bg/llm.js: extractPromise()
      1. POST /extract (Vishal's backend, 4s timeout)
      2. POST Gemini API (x-goog-api-key header, never in content script)
      3. regexExtract() offline fallback
  → response: {ok, data: {is_promise, promise, deadline_iso, conditions, confidence}, source}
  → content-v3.js: show offerPromise() toast
```

---

## Security Notes

- API key is stored in `chrome.storage.local` as `apiKey` and used only in `bg/llm.js` via `x-goog-api-key` header. It is **never** passed to content scripts.
- `[data-company]` attributes are trusted only on `localhost`/`127.0.0.1` by `ShopKartAdapter`. All other pages use hostname only.
- `allowedSites` is strictly deny-all when empty.
