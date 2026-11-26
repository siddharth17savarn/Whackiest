# AFTERMATH LIVE

**Team NULL-MATRIX** | *Every promise leaves a trace.*

AFTERMATH LIVE is a unified promise-tracking system combining:
1. **Chrome MV3 Extension (`extension/`)** — Live promise & claim detection, 6-state machine (`PROMISED → CLAIMED → OBSERVED → VERIFIED` + `OVERDUE` + `CONTRADICTION`), FIFO toast queue, per-site opt-in (deny-all by default), company reliability scores, simulated clock warp, and printable HTML/PDF dispute report.
2. **FastAPI Extraction & Security Backend (`backend/`)** — `/health`, `/extract`, and `/export` with PII masking, prompt-injection guard, Gemini extraction + offline fallback, and confidence calibration.
3. **Python MCP Server (`mcp/`)** — Stdio JSON-RPC server exposing `list_promises`, `check_overdue`, `generate_dispute_summary`, `add_observation` (write-back), and live resources (`aftermath://ledger`, `aftermath://overdue`, `aftermath://stats`).
4. **Interactive Demos** — Root `demo_shopkart_chat.html` (6 scenarios, streaming, ShopKart & SwiftPay), root `demo_bank_status.html` (bank/order status for `OBSERVED` verification & Judge Reset), and `demo/index-v3.html` (V3 ShopKart demo).

---

## Architecture

```
┌───────────────────────────┐     chrome.runtime      ┌────────────────────────────┐
│  content-v3.js +          │ ──────────────────────► │  background-v3.js (MV3 SW) │
│  adapters.js              │   { action: 'extract' } │  ├── bg/llm.js             │
│  (Shadow DOM FIFO toasts) │                         │  ├── bg/alarms.js          │
└───────────────────────────┘                         │  └── bg/sync.js            │
                                                      └──────┬───────────────┬───────┘
                                                             │ POST /extract │
                                                             ▼               │
┌───────────────────────────┐   chrome.storage.local  ┌──────────────┐       │
│  popup-v3.html/js         │ ◄─────────────────────► │ FastAPI :8000│       │
│  report.html/js (PDF)     │                         │ (PII mask +  │       │
└────────────┬──────────────┘                         │  Gemini/re)  │       │
             │ Export JSON (ledger.json)              └──────────────┘       │
             ▼                                                               │
┌───────────────────────────┐   stdio JSON-RPC                               │
│  mcp/aftermath_mcp_v3.py  │ ◄────────────────► Claude Desktop / MCP Client │
└───────────────────────────┘
```

---

## Quick Start

### 1. Load the Chrome Extension
1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder inside this repository (not the repository root).
3. Click the extension icon → **Manage allowed sites (Privacy)** → **Enable localhost (Demo)**.

### 2. Start the FastAPI Backend (Port 8000, works offline without API keys)

```powershell
py -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
py backend\run.py
```

See [backend/README.md](backend/README.md) for environment configuration (`GEMINI_API_KEY`), `/extract`, and `/export` details.

### 3. Start the Demo Pages (Port 8080)

```powershell
py -m http.server 8080
```

- **Support Chat Demo (6 scenarios, streaming, ShopKart & SwiftPay):** `http://localhost:8080/demo_shopkart_chat.html`
- **My Bank / Order Status (`OBSERVED` step + Judge Reset):** `http://localhost:8080/demo_bank_status.html`
- **ShopKart V3 Demo:** `http://localhost:8080/demo/index-v3.html`

### 4. Run Python MCP Server (Stdio)

```powershell
cd mcp
$env:AFTERMATH_LEDGER = "ledger-sample-v3.json"
py aftermath_mcp_v3.py
```

**Claude Desktop config (`claude_desktop_config.json`)** (replace `<repo-root>` with your local clone path):
```json
{
  "mcpServers": {
    "aftermath-live": {
      "command": "python",
      "args": ["<repo-root>\\mcp\\aftermath_mcp_v3.py"],
      "env": {
        "AFTERMATH_LEDGER": "<repo-root>\\mcp\\ledger-sample-v3.json"
      }
    }
  }
}
```

### 5. Run All Tests

```powershell
node --test tests/run_tests.mjs
node tests/test_deadline_parser.js
node tests/test_deadline_30_phrases.js
py -m pytest backend\tests tests\test_deadline_30_phrases.py -v
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
- [docs/LEDGER_SCHEMA.md](docs/LEDGER_SCHEMA.md) — Unified ledger & MCP schema
- [docs/INTEGRATION.md](docs/INTEGRATION.md) — Extension, backend, and MCP integration contracts
- [docs/DEMO_SCRIPT_3MIN.md](docs/DEMO_SCRIPT_3MIN.md) — 3-minute live demo script
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — Release history
