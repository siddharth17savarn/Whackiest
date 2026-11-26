# AFTERMATH LIVE — Judge Q&A (MCP Server, Sync & Dispute Report)

Owner: **Devashish**

---

## 1. Why does AFTERMATH LIVE include an MCP server?

Model Context Protocol (MCP) lets AI assistants like Claude Desktop query the user's live promise ledger directly over a local `stdio` channel without uploading browsing history to a third-party cloud. Judges can ask *"What is overdue?"* in Claude Desktop and get an answer backed by `~/.aftermath/ledger.json`.

## 2. How does data stay synchronized between the Chrome extension and Claude Desktop?

`bg/sync.js` pushes the extension's `chrome.storage.local` (`items` and `skew`) to `POST /sync`, which atomically persists `~/.aftermath/ledger.json`. The MCP server reads `~/.aftermath/ledger.json` (and respects `skew` when evaluating overdue deadlines).

## 3. How does observation write-back work from Claude Desktop to the extension?

When the user records an observation in Claude Desktop via `add_observation`:
1. The MCP server updates `~/.aftermath/ledger.json` and appends an event to `~/.aftermath/inbox.json`.
2. On the next sync cycle, `bg/sync.js` calls `GET /inbox`, reads fresh `items` from `chrome.storage.local` immediately before writing (preventing stale-write overwrites), merges the observation, and acknowledges the event via `POST /inbox/ack`.

## 4. How is the printable dispute report shared between the browser and MCP?

[shared/report_generator.js](file:///c:/Users/Harshit/Projects/Whackiest/shared/report_generator.js) is a UMD module used by both [dispute_report.html](file:///c:/Users/Harshit/Projects/Whackiest/dispute_report.html) in the browser and `generate_dispute_summary` in `mcp-server/src/server.js`. Both produce identical chronological timelines (`PROMISED → CLAIMED → OBSERVED → DEADLINE_PASSED → VERIFIED`) and never invent missing quotes or timestamps.
