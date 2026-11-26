# AFTERMATH LIVE — Extraction & Export Backend

FastAPI service providing structured customer-support promise extraction (`POST /extract`), PII masking, prompt-injection protection, shared business-day deadline resolution, calibrated confidence scoring, automatic offline fallback, and dispute evidence export (`POST /export`).

---

## 1. Requirements & Fresh-Clone Setup

- **Python:** `3.10+` (tested on Python `3.14`)
- **Node.js:** `18+` (optional, for running JS deadline parser tests)

From the repository root (`Whackiest/`):

```powershell
# 1. Create virtual environment
py -m venv backend\.venv

# 2. Activate (PowerShell)
.\backend\.venv\Scripts\Activate.ps1

# 3. Install dependencies
pip install -r backend\requirements.txt
```

*(Linux/macOS: `python3 -m venv backend/.venv && source backend/.venv/bin/activate && pip install -r backend/requirements.txt`)*

---

## 2. Environment Variables

Copy `backend/.env.example` to `backend/.env` (never commit `.env` or real keys):

```powershell
Copy-Item backend\.env.example backend\.env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | *(empty)* | Google AI Studio API key. Leave blank to run in offline-only mode. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model used for function calling. |
| `GEMINI_TIMEOUT_SECONDS` | `8.0` | Timeout before falling back to local extraction. |
| `CONFIDENCE_THRESHOLD` | `0.55` | Calibrated threshold separating concrete commitments from vague ones (see `docs/confidence_calibration.md`). |
| `HOST` | `127.0.0.1` | Bind host. |
| `PORT` | `8000` | Bind port. |
| `LOG_LEVEL` | `INFO` | Logging level. |

---

## 3. Starting FastAPI

Using the startup script (works from repo root or `backend/`):

```powershell
py backend\run.py
```

Or directly via Uvicorn from the repository root:

```powershell
py -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Interactive Swagger docs: `http://127.0.0.1:8000/docs`

---

## 4. Endpoints

### `GET /health`

```powershell
curl http://127.0.0.1:8000/health
```

```json
{
  "status": "ok",
  "service": "aftermath-live-backend",
  "version": "0.1.0",
  "gemini_configured": false,
  "extraction_mode": "offline_only"
}
```

### `POST /extract`

Extracts structured promises, deadlines (via `shared/deadline_parser.py`), conditions, and confidence scores. Automatically masks PII before any Gemini call and sanitizes prompt-injection attempts.

```powershell
curl -X POST http://127.0.0.1:8000/extract `
  -H "Content-Type: application/json" `
  -d '{"text":"Your refund will be processed within 5 business days, provided the return is scanned.","company":"ShopKart","now_ms":1764131400000}'
```

### `POST /export`

Transforms ledger items into PII-masked, chronologically ordered dispute evidence matching `docs/export_contract.md` for Devashish's printable dispute report generator.

```powershell
curl -X POST http://127.0.0.1:8000/export `
  -H "Content-Type: application/json" `
  -d '{"items":[{"id":1,"company":"ShopKart","promise":"Refund within 5 business days","due":1764765000000,"created":1764131400000,"claimed":{"text":"Your refund has been processed.","at":1764477000000},"observed":{"ok":false,"note":"Not in bank.","at":1764563400000}}],"now_ms":1764851400000}'
```

---

## 5. Offline Fallback Behaviour

1. If `GEMINI_API_KEY` is unset/empty, `/extract` routes directly to `backend/app/fallback.py` (`fallback_reason: "no_api_key"`).
2. If Gemini times out, hits rate limits (`429`), errors, or returns invalid arguments, `extractor.py` automatically falls back to `extract_offline()` and reports `extraction_method: "offline"` + `fallback_reason`.
3. Both paths share `shared/deadline_parser.py` and respect `now_ms`.

---

## 6. Running All Tests

```powershell
# All backend + 30-phrase Python tests (no paid API calls required)
py -m pytest backend\tests tests\test_deadline_30_phrases.py -v

# Stage 0 shared deadline parser tests
py tests\test_deadline_parser.py
node tests\test_deadline_parser.js
node tests\test_deadline_30_phrases.js
```

---

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| `ModuleNotFoundError: No module named 'shared'` | Run commands from the repository root (`Whackiest/`) or use `py backend\run.py`. |
| `422 Unprocessable Entity` on `/extract` | Ensure `text` is non-empty and `now_ms` (if provided) is a positive integer. |
| `gemini_timeout` in `fallback_reason` | Increase `GEMINI_TIMEOUT_SECONDS` in `backend/.env` or verify internet connectivity; offline fallback still returns valid results. |
