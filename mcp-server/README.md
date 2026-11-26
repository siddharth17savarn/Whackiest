# AFTERMATH LIVE — Node.js MCP Server

Stdio Model Context Protocol (MCP) server exposing live promise ledger tools and resources to Claude Desktop or any MCP client.

---

## 1. Fresh-Machine Setup

```powershell
cd mcp-server
npm install
```

*(Requires Node.js 18+.)*

---

## 2. Tools & Resources

### Tools
1. `list_promises` — List promises (optional `company`, `state` filters).
2. `check_overdue` — Return unverified promises past their deadline.
3. `generate_dispute_summary` — Generate Markdown or printable HTML dispute summary via `shared/report_generator.js`.
4. `add_observation` — Record an observed outcome (`ok`, `note`) and write it back to `~/.aftermath/ledger.json` and `~/.aftermath/inbox.json` for extension sync.

### Resources
- `aftermath://ledger` — Full synchronized ledger JSON.
- `aftermath://overdue` — Overdue unverified promises.
- `aftermath://stats` — Aggregate counts and per-company breakdown.

---

## 3. Claude Desktop Walkthrough

1. Open your Claude Desktop config file:
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the `aftermath-live` entry from [claude_desktop_config.example.json](claude_desktop_config.example.json) with the absolute path to `mcp-server/src/server.js`.
3. Restart Claude Desktop.
4. Ask Claude:
   - *"What promises are overdue?"* (`check_overdue`)
   - *"Generate a dispute summary for ShopKart."* (`generate_dispute_summary`)
   - *"Log an observation that my ShopKart refund did not arrive in my bank."* (`add_observation`)

---

## 4. Running Tests

```powershell
cd mcp-server
npm test
```
