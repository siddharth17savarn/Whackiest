# Changelog — AFTERMATH LIVE

## v0.3.1 (2026-11-26) — Unified Final

**Merged V0.3.0 + V0.2.0 into single product.**

### Added (from V0.2.0 / Siddharth's work)
- Modular background architecture: `bg/alarms.js`, `bg/llm.js`, `bg/sync.js`
- Explicit six-state machine: PROMISED → CLAIMED → OBSERVED → VERIFIED + OVERDUE + CONTRADICTION
- FIFO toast queue in content script (no dropped or stacked toasts)
- Streaming stabilisation: waits for DOM text to settle before processing
- Site opt-in (deny-all by default): `allowedSites` storage key
- Stale-write prevention: all confirm handlers re-read ledger by item ID
- Fingerprint deduplication: skip messages already seen this session
- Keyword claim matching: `AMXMatching.rankPromiseMatches()` with Jaccard + word overlap
- Ambiguity detection: disambiguation dropdown when multiple promises tied
- Search bar in popup (live query across company + promise text)
- State filter dropdown (All / Open / At risk / Verified)
- Manage allowed sites panel in popup
- `Demo: +6 days` warp now uses simulated clock offset (`skew` key) — does NOT mutate deadlines
- Shared schema: `normalizeRecord()` migrates V0.2.0 ↔ V0.3.0 records
- MCP export: `toMcpRecord()` for Python MCP server compatibility
- 26-test automated suite (`tests/run_tests.mjs`, Node.js)

### Preserved (from V0.3.0)
- Popup design and CSS
- Company reliability scoring
- Conditions tracker with checkbox
- 6-step ShopKart demo (typing indicator, deadline slip)
- Python MCP server (`aftermath_mcp_v3.py`)
- Markdown evidence report export
- Escalation draft generator
- Revision detection (Jaccard similarity ≥ 0.25)
- Context menu "Track as promise" (right-click selected text)
- SHA-256 tamper evidence hash

---

## v0.3.0 (2026-11-24) — V3 Release

- Shadow DOM panel (no style leakage)
- Revision detection (similarity ≥ 0.25)
- Timeline, transcript capture
- Reliability scores bar chart
- Escalation draft
- Markdown export
- Python MCP server
- 6-step demo page

## v0.2.0 (2026-11-24) — Siddharth's Implementation

- Modular background scripts
- Six-state machine
- FIFO toast queue
- Site opt-in (deny-all)
- Streaming stabilisation
- Automated test suite

## v0.1.0 (Initial)

- Basic promise detection
- Simple ledger storage
