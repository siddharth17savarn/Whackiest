# `/extract` API Specification & Mock Response (Stage 0)

Owner: **Vishal**
Consumers: **Siddharth** (`bg/llm.js`, extension background script), **Devashish** (MCP tools & sync schema alignment)

---

## Endpoint

`POST /extract`

Extracts structured company commitments (promises, deadlines, conditions, confidence scores) from a customer-support chat message.

### Request Schema

```json
{
  "text": "Your refund will be processed within 5 business days, provided the return is scanned at the courier.",
  "company": "ShopKart",
  "now_ms": 1764155400000,
  "chat_url": "http://localhost:8000/demo_shopkart_chat.html"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | Yes | Raw support agent message text |
| `company` | `string` | No | Company name detected on the page |
| `now_ms` | `integer` | No | Current clock timestamp in epoch ms (from `AftermathClock.now()`, respecting simulated clock skew). Defaults to server time if omitted. |
| `chat_url` | `string` | No | Source page URL for evidence metadata |

---

### Response Schema

```json
{
  "promises": [
    {
      "promise": "Your refund will be processed within 5 business days, provided the return is scanned at the courier.",
      "deadline_hours": 120.0,
      "deadline_date": "2026-12-03T18:00:00+05:30",
      "due_ms": 1764765000000,
      "condition": "provided the return is scanned at the courier",
      "confidence": 0.9,
      "extraction_method": "gemini",
      "deadline_method": "biz_days",
      "raw_deadline": "within 5 business days"
    }
  ],
  "is_claim": false,
  "pii_masked": true,
  "prompt_injection_detected": false,
  "raw_text_hash": "a1b2c3d4e5f67890"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `promises` | `array` | List of extracted commitments (empty `[]` if none detected) |
| `promises[].promise` | `string` | Concise summary or sentence of the commitment |
| `promises[].deadline_hours` | `number \| null` | Hours from `now_ms` until `due_ms` (for convenience) |
| `promises[].deadline_date` | `string \| null` | ISO 8601 timestamp of the resolved deadline |
| `promises[].due_ms` | `integer \| null` | Epoch milliseconds of the resolved deadline (computed relative to `now_ms`) |
| `promises[].condition` | `string \| null` | Conditional clause attached to the promise (e.g., `"provided ..."`) |
| `promises[].confidence` | `number` | Confidence score in `[0.0, 1.0]` |
| `promises[].extraction_method` | `"gemini" \| "offline"` | Which extractor produced this result |
| `promises[].deadline_method` | `string` | Parser rule matched (e.g., `biz_days`, `biz_range`, `tomorrow`, `vague_shortly`, `none`) |
| `promises[].raw_deadline` | `string` | Exact substring matched for the deadline |
| `is_claim` | `boolean` | `true` if the message claims a prior promise was completed |
| `pii_masked` | `boolean` | `true` if PII masking ran before any external LLM call |
| `prompt_injection_detected` | `boolean` | `true` if prompt-injection guard flagged suspicious instructions |
| `raw_text_hash` | `string` | SHA-256 prefix of the original message for deduplication/audit |

---

## Mock Responses (For Stage 0 / Day 1 Integration)

### 1. Refund Promise with Condition (Gemini / High Confidence)

```json
{
  "promises": [
    {
      "promise": "Your refund will be processed within 5 business days, provided the return is scanned at the courier.",
      "deadline_hours": 169.3,
      "deadline_date": "2026-12-03T18:00:00+05:30",
      "due_ms": 1764765000000,
      "condition": "provided the return is scanned at the courier",
      "confidence": 0.9,
      "extraction_method": "gemini",
      "deadline_method": "biz_days",
      "raw_deadline": "within 5 business days"
    }
  ],
  "is_claim": false,
  "pii_masked": true,
  "prompt_injection_detected": false,
  "raw_text_hash": "9f86d081884c7d65"
}
```

### 2. Vague Promise (Offline Fallback / Low Confidence)

```json
{
  "promises": [
    {
      "promise": "Our billing team will get back to you shortly.",
      "deadline_hours": 48.0,
      "deadline_date": "2026-11-28T16:50:00+05:30",
      "due_ms": 1764328800000,
      "condition": null,
      "confidence": 0.4,
      "extraction_method": "offline",
      "deadline_method": "vague_shortly",
      "raw_deadline": "shortly"
    }
  ],
  "is_claim": false,
  "pii_masked": false,
  "prompt_injection_detected": false,
  "raw_text_hash": "4b227777d4dd1fc6"
}
```

### 3. No Promise Detected (Greeting / Filler)

```json
{
  "promises": [],
  "is_claim": false,
  "pii_masked": true,
  "prompt_injection_detected": false,
  "raw_text_hash": "e3b0c44298fc1c14"
}
```

---

## Agreed Ledger Item Format (Shared Contract)

For reference across extension (`amx_watch.js`, `amx_ledger.js`), backend (`/export`), and MCP server (`ledger.json`):

```json
{
  "id": 1764155400000,
  "company": "ShopKart",
  "promise": "Your refund will be processed within 5 business days.",
  "due": 1764765000000,
  "confidence": 0.9,
  "condition": "provided the return is scanned at the courier",
  "evidence": "Your refund will be processed within 5 business days, provided the return is scanned at the courier.",
  "chat": "http://localhost:8000/demo_shopkart_chat.html",
  "created": 1764155400000,
  "claimed": null,
  "observed": null,
  "verified": false,
  "state": "PROMISED"
}
```

Valid `state` values: `PROMISED`, `CLAIMED`, `OBSERVED`, `VERIFIED`, `OVERDUE`, `CONTRADICTION`.
