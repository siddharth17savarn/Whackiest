# Unified Ledger Schema — AFTERMATH LIVE v0.3.1

## Item Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID, format `c<timestamp>` |
| `company` | string | Company name |
| `companySource` | string | `verified-adapter`, `hostname` |
| `promise` | string | Extracted promise text |
| `deadline` | string \| null | ISO date `YYYY-MM-DD` |
| `originalDeadline` | string \| null | First deadline (before any revision) |
| `revisions` | number | Count of promise revisions |
| `due` | number \| null | Deadline as Unix ms (derived) |
| `conditions` | string \| null | Conditions text |
| `condMet` | boolean | User marked condition met |
| `state` | string | Canonical state (see below) |
| `status` | string | Same as `state` (compat alias) |
| `confidence` | number | 0–1 extraction confidence |
| `source` | string | Source page URL |
| `evidence` | string | Original detected text |
| `hash` | string | SHA-256 of evidence (tamper evidence) |
| `transcript` | array | Last 8 chat messages at detection time |
| `created` | number | Unix ms timestamp of creation |
| `claimed` | object \| null | `{text, at}` when CLAIMED |
| `claimedAt` | number \| null | Unix ms timestamp of claim |
| `claimEvidence` | string \| null | Text of company's claim |
| `observed` | object \| null | `{ok, note, at}` when OBSERVED |
| `observedOk` | boolean \| null | `true`=received, `false`=not received |
| `observedNote` | string \| null | User observation note |
| `verified` | boolean | `true` only when VERIFIED |
| `timeline` | array | `[{status, ts, note}]` audit trail |

## Six-State Machine

```
PROMISED ──→ CLAIMED ──→ OBSERVED ──→ VERIFIED
    │            │            │
    └──→ OVERDUE ┘            └──→ CONTRADICTION
    └──→ CONTRADICTION
```

| State | Meaning |
|-------|---------|
| `PROMISED` | Company made a commitment |
| `CLAIMED` | Company says it's done (not proof) |
| `OBSERVED` | User checked and recorded result |
| `VERIFIED` | User confirmed fulfilment with evidence |
| `OVERDUE` | Deadline passed, not yet verified |
| `CONTRADICTION` | Company claimed done, user observed otherwise |

## Storage Keys

| Key | Description |
|-----|-------------|
| `ledger` | Array of unified items (this schema) |
| `items` | Legacy V0.2.0 key — auto-migrated on load |
| `allowedSites` | String array of permitted hostnames |
| `skew` | Number (ms) — simulated clock offset for demo |
| `sentNotifs` | Object keyed `${id}:${type}` for notification dedup |

## MCP Export (`toMcpRecord`)

The `toMcpRecord()` function in `shared/schema.js` converts a unified item to the format expected by `mcp/aftermath_mcp_v3.py`:

- `status` and `state` — always present, same value
- `deadline` — always ISO date string or `null`
- `timeline` — always array
- `observedOk`, `observedNote`, `evidence`, `hash`, `transcript` — passed through

## Migration

`normalizeRecord()` automatically migrates:
- V0.2.0 items (`state` field, `due` as ms) → unified schema
- V0.3.0 items (`status` field, `deadline` as ISO string) → unified schema
