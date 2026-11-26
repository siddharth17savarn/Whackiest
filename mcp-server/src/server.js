'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const reportGen = require('../../shared/report_generator');
const ledgerClient = require('./ledger_client');

function createServer() {
  const server = new McpServer({
    name: 'aftermath-live-mcp',
    version: '0.1.0',
  });

  // ── Tool 1: list_promises ───────────────────────────────────────────
  server.tool(
    'list_promises',
    'List tracked company promises from the live AFTERMATH ledger, optionally filtered by company or state.',
    {
      company: z.string().optional().describe('Filter by company name (case-insensitive).'),
      state: z.string().optional().describe('Filter by state (PROMISED, CLAIMED, OBSERVED, VERIFIED, OVERDUE, CONTRADICTION).'),
      now_ms: z.number().optional().describe('Optional reference epoch ms for state evaluation.'),
    },
    async ({ company, state, now_ms }) => {
      const ledger = ledgerClient.readLedger();
      const refNow = ledgerClient.getEffectiveNowMs(ledger, now_ms);
      let items = ledger.items.map((it) => ({
        ...it,
        state: ledgerClient.resolveState(it, refNow),
        is_overdue: !it.verified && it.due != null && it.due < refNow,
      }));

      if (company) {
        const needle = company.trim().toLowerCase();
        items = items.filter((it) => String(it.company || '').toLowerCase() === needle);
      }
      if (state) {
        const targetState = state.trim().toUpperCase();
        items = items.filter((it) => it.state === targetState);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: items.length, now_ms: refNow, items }, null, 2),
          },
        ],
      };
    }
  );

  // ── Tool 2: check_overdue ───────────────────────────────────────────
  server.tool(
    'check_overdue',
    'Check which unverified promises have passed their promised deadline.',
    {
      now_ms: z.number().optional().describe('Optional reference epoch ms (defaults to clock + ledger skew).'),
    },
    async ({ now_ms }) => {
      const ledger = ledgerClient.readLedger();
      const refNow = ledgerClient.getEffectiveNowMs(ledger, now_ms);
      const overdue = ledger.items
        .filter((it) => !it.verified && it.due != null && it.due < refNow)
        .map((it) => ({
          id: it.id,
          company: it.company,
          promise: it.promise,
          state: ledgerClient.resolveState(it, refNow),
          due: it.due,
          hours_overdue: Math.round(((refNow - it.due) / 3_600_000) * 100) / 100,
          claimed: it.claimed || null,
          observed: it.observed || null,
        }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ overdue_count: overdue.length, now_ms: refNow, overdue }, null, 2),
          },
        ],
      };
    }
  );

  // ── Tool 3: generate_dispute_summary ────────────────────────────────
  server.tool(
    'generate_dispute_summary',
    'Generate a structured dispute summary (or printable HTML report) reusing the shared report generator.',
    {
      promise_id: z.union([z.string(), z.number()]).optional().describe('Optional specific promise ID; omits to include all promises.'),
      format: z.enum(['markdown', 'html']).optional().default('markdown').describe('Output format: markdown or printable html.'),
      now_ms: z.number().optional().describe('Optional reference epoch ms.'),
    },
    async ({ promise_id, format, now_ms }) => {
      const ledger = ledgerClient.readLedger();
      const refNow = ledgerClient.getEffectiveNowMs(ledger, now_ms);
      let items = ledger.items;
      if (promise_id !== undefined && promise_id !== null) {
        items = items.filter((it) => String(it.id) === String(promise_id));
      }

      const output =
        format === 'html'
          ? reportGen.generatePrintableReportHtml(items, { nowMs: refNow })
          : reportGen.generateDisputeMarkdown(items, { nowMs: refNow });

      return {
        content: [{ type: 'text', text: output }],
      };
    }
  );

  // ── Tool 4: add_observation ─────────────────────────────────────────
  server.tool(
    'add_observation',
    'Record a user observation (whether a promised outcome actually happened) and write it back to the shared ledger and extension inbox.',
    {
      promise_id: z.union([z.string(), z.number()]).describe('ID of the promise to update.'),
      ok: z.boolean().describe('True if the promised outcome occurred; false if it did not.'),
      note: z.string().min(1).describe('Concrete observation note (e.g., "Checked My Bank: ₹0.00 credited").'),
      at_ms: z.number().optional().describe('Optional observation timestamp in epoch ms.'),
    },
    async ({ promise_id, ok, note, at_ms }) => {
      try {
        const result = ledgerClient.addObservation({
          promiseId: promise_id,
          ok,
          note,
          atMs: at_ms,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'ok',
                  event_id: result.event.event_id,
                  updated_item: result.item,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: err.message }],
        };
      }
    }
  );

  // ── Resources: ledger, overdue, stats ───────────────────────────────
  server.resource(
    'ledger',
    'aftermath://ledger',
    { description: 'Full synchronized AFTERMATH LIVE promise ledger.', mimeType: 'application/json' },
    async (uri) => {
      const ledger = ledgerClient.readLedger();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(ledger, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'overdue',
    'aftermath://overdue',
    { description: 'Currently overdue unverified promises.', mimeType: 'application/json' },
    async (uri) => {
      const ledger = ledgerClient.readLedger();
      const refNow = ledgerClient.getEffectiveNowMs(ledger);
      const overdue = ledger.items.filter((it) => !it.verified && it.due != null && it.due < refNow);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ now_ms: refNow, count: overdue.length, overdue }, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'stats',
    'aftermath://stats',
    { description: 'Aggregate promise reliability and dispute statistics.', mimeType: 'application/json' },
    async (uri) => {
      const ledger = ledgerClient.readLedger();
      const stats = ledgerClient.computeStats(ledger);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal MCP server error:', err);
    process.exit(1);
  });
}

module.exports = { createServer };
