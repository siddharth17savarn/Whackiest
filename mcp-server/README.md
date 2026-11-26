# AFTERMATH LIVE — Node.js MCP Server

Stdio Model Context Protocol (MCP) server exposing live promise ledger tools and resources to Claude Desktop or any MCP client.

---

## 1. Installation & Startup (Fresh Machine)

Requires **Node.js 18+**.

```powershell
cd mcp-server
npm ci
```

To verify the server starts cleanly over stdio:

```powershell
node src/server.js
```

*(The process waits on `stdin`/`stdout` for JSON-RPC MCP messages; press `Ctrl+C` to exit.)*

---

## 2. Tools Walkthrough

1. **`list_promises`**
   - Lists tracked promises from `~/.aftermath/ledger.json`.
   - Optional filters: `company` (case-insensitive), `state` (`PROMISED`, `CLAIMED`, `OBSERVED`, `VERIFIED`, `OVERDUE`, `CONTRADICTION`), `now_ms`.
   - Example prompt in Claude Desktop: *"List all ShopKart promises."*

2. **`check_overdue`**
   - Evaluates `!verified && due < now_ms` (respecting `ledger.skew`) and returns overdue items with `hours_overdue`.
   - Example prompt in Claude Desktop: *"What is overdue right now?"*

3. **`generate_dispute_summary`**
   - Reuses [shared/report_generator.js](file:///c:/Users/Harshit/Projects/Whackiest/shared/report_generator.js) to build a chronological dispute report (`PROMISED → CLAIMED → OBSERVED → DEADLINE_PASSED → VERIFIED`).
   - Supports `promise_id` (optional) and `format` (`"markdown"` or `"html"`).
   - Example prompt in Claude Desktop: *"Generate a dispute summary for ShopKart."*

4. **`add_observation`**
   - Parameters: `promise_id`, `ok` (`boolean`), `note` (`string`), optional `at_ms`.
   - Updates `~/.aftermath/ledger.json` immediately and queues a write-back event in `~/.aftermath/inbox.json` so `bg/sync.js` merges it into the extension.
   - Example prompt in Claude Desktop: *"Record that my ShopKart refund did not arrive in my bank account."*

---

## 3. Resources Walkthrough

| Resource URI | Name | Description |
|--------------|------|-------------|
| `aftermath://ledger` | `ledger` | Full synchronized ledger JSON from `~/.aftermath/ledger.json` |
| `aftermath://overdue` | `overdue` | Currently overdue unverified promises |
| `aftermath://stats` | `stats` | Aggregate counts (`total`, `overdue`, `contradictions`, `verified`, `open`, `by_company`) |

In Claude Desktop, click the **Attach / MCP Resource** icon and select any `aftermath://*` resource to attach live ledger context to your prompt.

---

## 4. Claude Desktop Configuration

1. Open your Claude Desktop config file:
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the `aftermath-live` entry from [claude_desktop_config.example.json](claude_desktop_config.example.json), replacing the path with the absolute path to `mcp-server/src/server.js` on your machine.
3. Restart Claude Desktop completely (quit from system tray/menu bar, then reopen).

---

## 5. Troubleshooting

| Issue | Fix |
|-------|-----|
| Claude Desktop says server disconnected | Ensure `npm ci` was run inside `mcp-server/` and the path in `claude_desktop_config.json` is absolute with forward slashes (`C:/.../mcp-server/src/server.js`). |
| `list_promises` returns `count: 0` | Confirm the FastAPI backend is running and `bg/sync.js` (or `POST /sync`) has written `~/.aftermath/ledger.json`. |
| Observation added in Claude not yet in extension | Ensure FastAPI is running (`py backend/run.py`) so `bg/sync.js` can pull `GET /inbox` and acknowledge it. |

---

## 6. Running Tests

```powershell
cd mcp-server
npm test
```
