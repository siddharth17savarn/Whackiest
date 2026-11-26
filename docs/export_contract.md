# `/export` Dispute Evidence Contract (Stage 3 / Day 3)

Owner: **Vishal** (backend `/export` endpoint)
Consumer: **Devashish** (printable dispute report generator & MCP `generate_dispute_summary`)

---

## Purpose

`POST /export` transforms one or more ledger items (from `chrome.storage.local.items` or `~/.aftermath/ledger.json`) into a validated, PII-masked, chronologically ordered dispute evidence bundle ready for Devashish's printable dispute report generator.

**Guarantees:**
- Never invents missing quotes, observations, or dates.
- Masks PII (`[EMAIL]`, `[PHONE]`, `[CARD]`, `[ACCOUNT]`, `[UPI]`, `[ADDRESS]`, `[PERSON]`) in all exported quotes, claim texts, and observation notes.
- Computes `state` consistently against `now_ms` (respecting simulated clock) if not explicitly provided.

---

## Request Schema (`POST /export`)

```json
{
  "items": [
    {
      "id": 1764131400000,
      "company": "ShopKart",
      "promise": "Your refund of ₹2,499 will be processed within 5 business days.",
      "due": 1764765000000,
      "confidence": 0.9,
      "condition": "provided the return package is scanned by the courier",
      "evidence": "Your refund of ₹2,499 will be processed within 5 business days.",
      "chat": "http://localhost:8000/demo_shopkart_chat.html",
      "created": 1764131400000,
      "claimed": {
        "text": "Good news: your refund has been processed on our side.",
        "at": 1764477000000
      },
      "observed": {
        "ok": false,
        "note": "Checked My Bank / Order Status: refund not credited.",
        "at": 1764563400000
      },
      "verified": false,
      "state": "CONTRADICTION"
    }
  ],
  "now_ms": 1764851400000
}
```

---

## Response Schema

```json
{
  "schema_version": "1.0",
  "exported_at": "2026-11-26T17:15:00+05:30",
  "now_ms": 1764851400000,
  "total_cases": 1,
  "summary": {
    "contradictions": 1,
    "overdue": 1,
    "verified": 0,
    "open": 0
  },
  "cases": [
    {
      "id": 1764131400000,
      "company": "ShopKart",
      "state": "CONTRADICTION",
      "promise": "Your refund of ₹2,499 will be processed within 5 business days.",
      "original_quote": "Your refund of ₹2,499 will be processed within 5 business days.",
      "condition": "provided the return package is scanned by the courier",
      "confidence": 0.9,
      "source_url": "http://localhost:8000/demo_shopkart_chat.html",
      "created_ms": 1764131400000,
      "created_at": "2025-11-26T10:00:00+05:30",
      "due_ms": 1764765000000,
      "due_at": "2025-12-03T18:00:00+05:30",
      "is_overdue": true,
      "pii_masked": false,
      "claim_vs_observation": {
        "claimed": true,
        "claim_quote": "Good news: your refund has been processed on our side.",
        "claimed_at_ms": 1764477000000,
        "claimed_at": "2025-11-30T10:00:00+05:30",
        "observed": true,
        "observed_ok": false,
        "observation_note": "Checked My Bank / Order Status: refund not credited.",
        "observed_at_ms": 1764563400000,
        "observed_at": "2025-12-01T10:00:00+05:30",
        "contradiction": true
      },
      "timeline": [
        {
          "event": "PROMISED",
          "timestamp_ms": 1764131400000,
          "timestamp_iso": "2025-11-26T10:00:00+05:30",
          "detail": "Your refund of ₹2,499 will be processed within 5 business days."
        },
        {
          "event": "CLAIMED",
          "timestamp_ms": 1764477000000,
          "timestamp_iso": "2025-11-30T10:00:00+05:30",
          "detail": "Good news: your refund has been processed on our side."
        },
        {
          "event": "OBSERVED",
          "timestamp_ms": 1764563400000,
          "timestamp_iso": "2025-12-01T10:00:00+05:30",
          "detail": "Checked My Bank / Order Status: refund not credited."
        },
        {
          "event": "DEADLINE_PASSED",
          "timestamp_ms": 1764765000000,
          "timestamp_iso": "2025-12-03T18:00:00+05:30",
          "detail": "Promised deadline elapsed without verification."
        }
      ]
    }
  ]
}
```
