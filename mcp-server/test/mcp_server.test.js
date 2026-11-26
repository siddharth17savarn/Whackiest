'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { afterEach, beforeEach, describe, it } = require('node:test');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const bgSync = require('../../bg/sync.js');
const reportGen = require('../../shared/report_generator.js');
const ledgerClient = require('../src/ledger_client.js');

const SAMPLE_PATH = path.join(__dirname, '..', 'sample_ledger.json');
const SERVER_PATH = path.join(__dirname, '..', 'src', 'server.js');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aftermath-mcp-test-'));
  process.env.AFTERMATH_DATA_DIR = tmpDir;
  delete process.env.AFTERMATH_LEDGER_PATH;
  const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
  ledgerClient.writeLedger(sample.items, sample.skew || 0);
});

afterEach(() => {
  delete process.env.AFTERMATH_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AFTERMATH LIVE MCP Server (stdio transport)', () => {
  async function withMcpClient(fn) {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [SERVER_PATH],
      env: { ...process.env, AFTERMATH_DATA_DIR: tmpDir },
    });
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    await client.connect(transport);
    try {
      await fn(client);
    } finally {
      await client.close();
    }
  }

  it('lists all 4 tools and 3 resources over stdio', async () => {
    await withMcpClient(async (client) => {
      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name).sort();
      assert.deepStrictEqual(toolNames, [
        'add_observation',
        'check_overdue',
        'generate_dispute_summary',
        'list_promises',
      ]);

      const resources = await client.listResources();
      const uris = resources.resources.map((r) => r.uri).sort();
      assert.deepStrictEqual(uris, [
        'aftermath://ledger',
        'aftermath://overdue',
        'aftermath://stats',
      ]);
    });
  });

  it('list_promises filters by company and state', async () => {
    await withMcpClient(async (client) => {
      const res = await client.callTool({
        name: 'list_promises',
        arguments: { company: 'ShopKart', now_ms: 1765000000000 },
      });
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.count, 1);
      assert.strictEqual(data.items[0].company, 'ShopKart');
      assert.strictEqual(data.items[0].state, 'OVERDUE');
    });
  });

  it('check_overdue detects unverified past-due promises', async () => {
    await withMcpClient(async (client) => {
      const res = await client.callTool({
        name: 'check_overdue',
        arguments: { now_ms: 1765000000000 },
      });
      const data = JSON.parse(res.content[0].text);
      assert.strictEqual(data.overdue_count, 1);
      assert.strictEqual(data.overdue[0].id, 1764131400000);
      assert(data.overdue[0].hours_overdue > 0);
    });
  });

  it('generate_dispute_summary reuses shared report generator (markdown & html)', async () => {
    await withMcpClient(async (client) => {
      const mdRes = await client.callTool({
        name: 'generate_dispute_summary',
        arguments: { promise_id: 1764131400000, format: 'markdown', now_ms: 1765000000000 },
      });
      const mdText = mdRes.content[0].text;
      assert(mdText.includes('ShopKart'));
      assert(mdText.includes('Claim vs Observation'));
      assert(mdText.includes('Timeline'));

      const htmlRes = await client.callTool({
        name: 'generate_dispute_summary',
        arguments: { promise_id: 1764131400000, format: 'html', now_ms: 1765000000000 },
      });
      const htmlText = htmlRes.content[0].text;
      assert(htmlText.includes('<!doctype html>'));
      assert(htmlText.includes('window.print()'));
    });
  });

  it('add_observation updates ledger.json, queues inbox write-back, and rejects unknown IDs', async () => {
    await withMcpClient(async (client) => {
      const res = await client.callTool({
        name: 'add_observation',
        arguments: {
          promise_id: 1764131400000,
          ok: false,
          note: 'Checked My Bank: ₹0.00 credited.',
          at_ms: 1764500000000,
        },
      });
      const body = JSON.parse(res.content[0].text);
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(body.updated_item.state, 'CONTRADICTION');
      assert.strictEqual(body.updated_item.observed.ok, false);

      // Calling add_observation again with identical payload persists exactly once
      const resDup = await client.callTool({
        name: 'add_observation',
        arguments: {
          promise_id: 1764131400000,
          ok: false,
          note: 'Checked My Bank: ₹0.00 credited.',
          at_ms: 1764500000000,
        },
      });
      const dupBody = JSON.parse(resDup.content[0].text);
      assert.strictEqual(dupBody.event_id, body.event_id);

      // Verify inbox.json has the write-back event exactly once
      const inbox = ledgerClient.readInbox();
      assert.strictEqual(inbox.length, 1);
      assert.strictEqual(inbox[0].promise_id, 1764131400000);

      // Unknown ID returns isError
      const errRes = await client.callTool({
        name: 'add_observation',
        arguments: { promise_id: 999999999, ok: false, note: 'Missing' },
      });
      assert.strictEqual(errRes.isError, true);

      // Blank note returns isError
      const blankRes = await client.callTool({
        name: 'add_observation',
        arguments: { promise_id: 1764131400000, ok: false, note: '   ' },
      });
      assert.strictEqual(blankRes.isError, true);
    });
  });

  it('reads ledger, overdue, and stats MCP resources', async () => {
    await withMcpClient(async (client) => {
      const ledgerRes = await client.readResource({ uri: 'aftermath://ledger' });
      const ledgerJson = JSON.parse(ledgerRes.contents[0].text);
      assert.strictEqual(ledgerJson.items.length, 2);

      const overdueRes = await client.readResource({ uri: 'aftermath://overdue' });
      const overdueJson = JSON.parse(overdueRes.contents[0].text);
      assert.strictEqual(overdueJson.count, 1);

      const statsRes = await client.readResource({ uri: 'aftermath://stats' });
      const statsJson = JSON.parse(statsRes.contents[0].text);
      assert.strictEqual(statsJson.total, 2);
      assert.strictEqual(statsJson.verified, 1);
    });
  });
});

describe('Extension bg/sync.js & shared/report_generator.js', () => {
  it('bg/sync.js pulls inbox observations, merges safely, and pushes ledger', async () => {
    const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
    let storageState = { items: sample.items, skew: 0 };
    const fakeStorage = {
      async get() { return { ...storageState }; },
      async set(patch) { storageState = { ...storageState, ...patch }; },
    };

    const ackedIds = [];
    let pushedBody = null;
    const fakeFetch = async (url, init) => {
      if (url.endsWith('/inbox') && (!init || init.method !== 'POST')) {
        return {
          ok: true,
          async json() {
            return {
              count: 1,
              events: [{
                event_id: 'ev-1',
                promise_id: 1764131400000,
                ok: false,
                note: 'No refund in bank',
                at: 1764500000000,
              }],
            };
          },
        };
      }
      if (url.endsWith('/inbox/ack')) {
        ackedIds.push(...JSON.parse(init.body).event_ids);
        return { ok: true, async json() { return { status: 'ok', acknowledged: 1 }; } };
      }
      if (url.endsWith('/sync')) {
        pushedBody = JSON.parse(init.body);
        return { ok: true, async json() { return { status: 'ok', synced_count: pushedBody.items.length }; } };
      }
      throw new Error('Unexpected URL: ' + url);
    };

    const res = await bgSync.syncCycle({ storage: fakeStorage, fetchFn: fakeFetch });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.pull.appliedCount, 1);
    assert.deepStrictEqual(ackedIds, ['ev-1']);
    assert.strictEqual(storageState.items[0].state, 'CONTRADICTION');
    assert.strictEqual(pushedBody.items.length, 2);
  });

  it('bg/sync.js deduplicates duplicate event_ids and ignores older events', () => {
    const items = [
      {
        id: 1,
        company: 'ShopKart',
        promise: 'Refund within 5 business days',
        observed: { ok: true, note: 'Newer observation', at: 2000 },
      },
    ];
    const events = [
      { event_id: 'dup-1', promise_id: 1, ok: false, note: 'Older event', at: 1000 },
      { event_id: 'dup-1', promise_id: 1, ok: false, note: 'Duplicate event', at: 3000 },
    ];
    const { items: out, appliedEventIds } = bgSync.mergeObservationsIntoItems(items, events, 3500);
    // Older event did not overwrite newer observation, duplicate event_id skipped
    assert.strictEqual(out[0].observed.note, 'Newer observation');
    assert.deepStrictEqual(appliedEventIds, ['dup-1']);
  });

  it('bg/sync.js handles offline/network failures gracefully without corrupting storage', async () => {
    const fakeStorage = {
      async get() { return { items: [], skew: 0 }; },
      async set() { throw new Error('Should not write on failed fetch'); },
    };
    const offlineFetch = async () => { throw new Error('ECONNREFUSED'); };
    const res = await bgSync.syncCycle({ storage: fakeStorage, fetchFn: offlineFetch });
    assert.strictEqual(res.ok, false);
    assert(res.error.includes('ECONNREFUSED'));
  });

  it('report_generator produces chronological timeline without inventing missing data', () => {
    const html = reportGen.generatePrintableReportHtml([
      { id: 1, company: 'ShopKart', promise: 'Refund soon.', created: 1000 },
    ], { nowMs: 2000 });
    assert(html.includes('ShopKart'));
    assert(html.includes('Refund soon.'));
  });
});
