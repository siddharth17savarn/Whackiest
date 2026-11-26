# AFTERMATH LIVE — Judge Q&A (MCP Server, Sync & Dispute Report)

Owner: **Devashish**

---

## 1. How does the MCP server connect to Claude Desktop?

`mcp-server/src/server.js` uses the official `@modelcontextprotocol/sdk` over **`StdioServerTransport`** (`stdin`/`stdout`). Claude Desktop launches `node mcp-server/src/server.js` as a local subprocess—no public ports or cloud relays are needed.

## 2. How is live ledger data accessed?

The Chrome extension's `bg/sync.js` pushes `chrome.storage.local` (`items` and `skew`) to `POST /sync`, which atomically writes `~/.aftermath/ledger.json`. The MCP server reads `~/.aftermath/ledger.json` directly (and respects `skew` when evaluating deadlines).

## 3. What does each of the four MCP tools do?

1. **`list_promises`:** Lists commitments with optional `company` and `state` filters.
2. **`check_overdue`:** Returns unverified commitments where `due < now_ms` (respecting simulated clock `skew`), including `hours_overdue`.
3. **`generate_dispute_summary`:** Reuses `shared/report_generator.js` to produce a Markdown or printable HTML dispute report with quotes, dates, timeline, and claim-vs-observation.
4. **`add_observation`:** Validates `promise_id`, `ok`, and `note`, updates `~/.aftermath/ledger.json`, and queues a write-back event in `~/.aftermath/inbox.json`.

## 4. What does each of the three MCP resources expose?

- **`aftermath://ledger` (`ledger`):** Full synchronized ledger JSON.
- **`aftermath://overdue` (`overdue`):** Filtered list of overdue unverified commitments.
- **`aftermath://stats` (`stats`):** Aggregate totals (`total`, `overdue`, `contradictions`, `verified`, `open`) and per-company breakdowns.

## 5. How are observations written back to the extension?

1. `add_observation` (or `POST /inbox`) records the observation in `~/.aftermath/inbox.json` and updates `~/.aftermath/ledger.json`.
2. `bg/sync.js` calls `GET /inbox`, reads fresh `items` from `chrome.storage.local` immediately before writing (preventing stale overwrites), deduplicates by `event_id`, merges the observation, and acknowledges via `POST /inbox/ack`.
3. `POST /sync` (`merge_and_write_ledger`) also preserves unacknowledged `inbox.json` observations so an extension push never clobbers a recent Claude write-back.

## 6. How is the dispute report generated?

[shared/report_generator.js](file:///c:/Users/Harshit/Projects/Whackiest/shared/report_generator.js) is shared between [dispute_report.html](file:///c:/Users/Harshit/Projects/Whackiest/dispute_report.html) in the browser and `generate_dispute_summary` in `mcp-server/src/server.js`. It never invents missing quotes, observations, or timestamps.

## 7. What are the privacy and data-storage boundaries?

- All synchronized ledger data and inbox events stay local on the user's machine (`~/.aftermath/ledger.json` and `~/.aftermath/inbox.json`).
- The MCP server runs locally over `stdio` and never calls external AI APIs or transmits raw chat logs over the network.

## 8. What are the known limitations?

- **Extension wiring:** `bg/sync.js` is implemented and tested as a standalone module; wiring it into Siddharth's `amx_bg.js` / `manifest.json` is deferred to final integration so Siddharth's files remain untouched.
- **Single-machine storage:** `~/.aftermath/ledger.json` assumes the browser and Claude Desktop run on the same local machine.
- **File locking:** Uses an exclusive lockfile (`.aftermath.lock`) with a 30s stale-lock timeout; suitable for local desktop concurrency, not multi-host distributed storage.
