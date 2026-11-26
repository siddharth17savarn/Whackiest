# AFTERMATH LIVE

**Every promise leaves a trace.**

AFTERMATH LIVE is a Chrome extension, FastAPI extraction backend, and MCP-ready promise ledger that captures customer-support commitments, tracks deadlines against a simulated clock, and builds structured dispute evidence when claims contradict reality.

---

## Quick Start (Backend & Demo)

### 1. Start the FastAPI Backend (works offline without API keys)

```powershell
py -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
py backend\run.py
```

See [backend/README.md](backend/README.md) for environment configuration (`GEMINI_API_KEY`), `/extract`, and `/export` details.

### 2. Start the Demo Pages

```powershell
py -m http.server 8000
```

- **Support Chat Demo (6 scenarios, streaming, ShopKart & SwiftPay):** `http://localhost:8000/demo_shopkart_chat.html`
- **My Bank / Order Status (OBSERVED step + Judge Reset):** `http://localhost:8000/demo_bank_status.html`

### 3. Run All Tests

```powershell
py -m pytest backend\tests tests\test_deadline_30_phrases.py -v
py tests\test_deadline_parser.py
node tests\test_deadline_parser.js
node tests\test_deadline_30_phrases.js
```

---

## Documentation

- [docs/extract_api.md](docs/extract_api.md) — `/extract` API & ledger item contract
- [docs/export_contract.md](docs/export_contract.md) — `/export` dispute evidence contract
- [docs/scenarios.md](docs/scenarios.md) — Six ShopKart demo scenarios
- [docs/deadline_test_table.md](docs/deadline_test_table.md) — 30-phrase deadline test table
- [docs/confidence_calibration.md](docs/confidence_calibration.md) — Confidence threshold calibration report
- [docs/dataset.md](docs/dataset.md) — 50-message synthetic dataset documentation
- [docs/judge_qa.md](docs/judge_qa.md) — Judge Q&A (privacy, PII masking, prompt injection, accuracy, and limitations)
