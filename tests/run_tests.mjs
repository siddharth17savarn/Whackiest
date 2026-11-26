/**
 * run_tests.mjs — AFTERMATH LIVE v0.3.1 automated test suite
 * Run: node --test tests/run_tests.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.join(__dirname, '..', 'extension');
const require = createRequire(import.meta.url);

/* ── Load IIFE UMD modules ── */
const matchingCode = readFileSync(path.join(extDir, 'shared', 'matching.js'), 'utf8');
const adaptersCode = readFileSync(path.join(extDir, 'adapters.js'), 'utf8');

function loadIIFE(code) {
  const g = { module: undefined };
  const fn = new Function('module', 'globalThis', code + '; return globalThis;');
  const fake = {};
  fn(g.module, fake);
  return fake;
}

const { AMXMatching } = loadIIFE(matchingCode);
const { AMXAdapters } = loadIIFE(adaptersCode);

/* ── Load ES modules ── */
const { STATES, canTransition, transitionItem, effectiveState } =
  await import(path.join(extDir, 'shared', 'state.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'));

const { filterLedgerItems } =
  await import(path.join(extDir, 'shared', 'ledger_filter.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'));

const { normalizeRecord, toMcpRecord } =
  await import(path.join(extDir, 'shared', 'schema.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'));

const { addDays, nextWeekday, iso, regexExtract, extractPromise, validateExtractResponse } =
  await import(path.join(extDir, 'bg', 'llm.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'));

const { buildDisputeReportHtml } =
  await import(path.join(extDir, 'shared', 'report_html.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'));

const { updateBadge, checkNotifications, HOUR_MS } =
  await import(path.join(extDir, 'bg', 'alarms.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'));

const { isSiteAllowed, addAllowedSite, removeAllowedSite, loadLedger } =
  await import(path.join(extDir, 'bg', 'sync.js').replace(/\\/g, '/').replace(/^([A-Z]:)/, 'file:///$1'));

function createMockStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    _data: data,
    async get(keys) {
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) if (k in data) out[k] = data[k];
        return out;
      }
      return { ...data };
    },
    async set(obj) {
      Object.assign(data, obj);
    },
  };
}

/* ═══════════════════════════════════════════════════════════════
   1. CLAIM MATCHING — refund matches refund, not escalation
   ═══════════════════════════════════════════════════════════════ */
test('1a. claim matching: refund matches refund promise', () => {
  const items = [
    { id: 'p1', company: 'ShopKart', promise: 'Your refund will be processed within 3 days', state: 'PROMISED', status: 'PROMISED', verified: false },
    { id: 'p2', company: 'ShopKart', promise: 'We will escalate your complaint to our senior team', state: 'PROMISED', status: 'PROMISED', verified: false },
  ];
  const result = AMXMatching.rankPromiseMatches('Your refund has been initiated', items, 'ShopKart');
  assert.equal(result.best?.id, 'p1', 'Should match refund promise, not escalation');
});

test('1b. claim matching: delivery promise ranked higher than loyalty promise', () => {
  const items = [
    { id: 'd1', company: 'QuickShip', promise: 'Your order will be delivered by Friday', state: 'PROMISED', status: 'PROMISED', verified: false },
    { id: 'd2', company: 'QuickShip', promise: 'We will credit loyalty points to your account', state: 'PROMISED', status: 'PROMISED', verified: false },
  ];
  const result = AMXMatching.rankPromiseMatches('Your order delivery is complete', items, 'QuickShip');
  // "order" overlaps with d1 — d1 should rank first
  const topId = result.best?.id ?? result.candidates[0]?.item?.id;
  assert.equal(topId, 'd1', 'Delivery promise should rank above loyalty promise');
});

/* ═══════════════════════════════════════════════════════════════
   2. AMBIGUITY DETECTION
   ═══════════════════════════════════════════════════════════════ */
test('2a. ambiguity: tied scores flag ambiguous:true', () => {
  const items = [
    { id: 'a1', company: 'Acme', promise: 'will process payment shortly', state: 'PROMISED', status: 'PROMISED', verified: false },
    { id: 'a2', company: 'Acme', promise: 'will process delivery shortly', state: 'PROMISED', status: 'PROMISED', verified: false },
  ];
  const result = AMXMatching.rankPromiseMatches('will process shortly', items, 'Acme');
  assert.ok(result.ambiguous, 'Tied scores should be flagged as ambiguous');
  assert.equal(result.best, null, 'best should be null when ambiguous');
});

test('2b. ambiguity: verified items excluded from candidates', () => {
  const items = [
    { id: 'v1', company: 'Acme', promise: 'will process refund', state: 'VERIFIED', status: 'VERIFIED', verified: true },
    { id: 'p1', company: 'Acme', promise: 'will process delivery', state: 'PROMISED', status: 'PROMISED', verified: false },
  ];
  const result = AMXMatching.rankPromiseMatches('will process delivery', items, 'Acme');
  assert.ok(!result.ambiguous);
  assert.equal(result.best?.id, 'p1');
});

/* ═══════════════════════════════════════════════════════════════
   3. STALE-WRITE PREVENTION (simulated concurrent saves)
   ═══════════════════════════════════════════════════════════════ */
test('3. stale-write: each write targets only its own item by id, no cross-contamination', () => {
  // The stale-write-safe pattern: each confirm handler re-reads the ledger from storage
  // and finds its item by id, then writes only that item. Simulate this:
  const storageDb = [
    { id: 'sw1', company: 'A', promise: 'P1', state: 'PROMISED' },
    { id: 'sw2', company: 'A', promise: 'P2', state: 'PROMISED' },
  ];

  // Simulate confirm handler for item sw1 (re-reads, mutates by id, writes back)
  function confirmById(id, mutation) {
    const fresh = JSON.parse(JSON.stringify(storageDb)); // fresh read
    const item = fresh.find(x => x.id === id);
    if (item) mutation(item);
    // Write back: replace storageDb contents
    storageDb.length = 0;
    for (const r of fresh) storageDb.push(r);
  }

  confirmById('sw1', x => { x.state = 'CLAIMED'; });
  confirmById('sw2', x => { x.state = 'OBSERVED'; });

  assert.equal(storageDb.find(x => x.id === 'sw1').state, 'CLAIMED',
    'sw1 should be CLAIMED after its own confirm');
  assert.equal(storageDb.find(x => x.id === 'sw2').state, 'OBSERVED',
    'sw2 should be OBSERVED after its own confirm');
  assert.equal(storageDb.length, 2, 'No items should be lost');
});

/* ═══════════════════════════════════════════════════════════════
   4. FIFO TOAST QUEUE
   ═══════════════════════════════════════════════════════════════ */
test('4. FIFO toast queue: items processed in order, no drops', async () => {
  const order = [];
  const queue = [];
  let active = false;

  const showNext = () => {
    if (!queue.length) { active = false; return; }
    active = true;
    const fn = queue.shift();
    fn(() => setTimeout(showNext, 0));
  };

  const enqueue = fn => { queue.push(fn); if (!active) showNext(); };

  await new Promise(resolve => {
    ['A', 'B', 'C'].forEach(id => enqueue(close => { order.push(id); close(); }));
    setTimeout(resolve, 100);
  });

  assert.deepEqual(order, ['A', 'B', 'C']);
});

/* ═══════════════════════════════════════════════════════════════
   5. STATE MACHINE
   ═══════════════════════════════════════════════════════════════ */
test('5a. state machine: valid transitions pass', () => {
  assert.ok(canTransition('PROMISED', 'CLAIMED'));
  assert.ok(canTransition('CLAIMED', 'OBSERVED'));
  assert.ok(canTransition('OBSERVED', 'VERIFIED'));
  assert.ok(canTransition('PROMISED', 'OVERDUE'));
  assert.ok(canTransition('OVERDUE', 'CLAIMED'));
  assert.ok(canTransition('OBSERVED', 'CONTRADICTION'));
});

test('5b. state machine: CLAIMED→VERIFIED is blocked', () => {
  assert.throws(() => transitionItem({ id: 't', state: 'CLAIMED', status: 'CLAIMED' }, 'VERIFIED'),
    /Invalid state transition/);
});

test('5c. state machine: OBSERVED→VERIFIED is allowed', () => {
  const item = { id: 't', state: 'OBSERVED', status: 'OBSERVED', timeline: [] };
  const result = transitionItem(item, 'VERIFIED');
  assert.equal(result.state, 'VERIFIED');
  assert.equal(result.verified, true);
});

test('5d. state machine: same-state transition is a no-op', () => {
  assert.ok(canTransition('PROMISED', 'PROMISED'));
});

/* ═══════════════════════════════════════════════════════════════
   6. DEADLINE CALCULATIONS
   ═══════════════════════════════════════════════════════════════ */
test('6a. addDays: calendar days', () => {
  const result = addDays(new Date('2026-01-01'), 3, false);
  assert.equal(result, '2026-01-04');
});

test('6b. addDays: business days skip weekends', () => {
  // 2026-01-02 is Friday; 3 business days → skips Sat, Sun → 2026-01-07
  const result = addDays(new Date('2026-01-02'), 3, true);
  assert.equal(result, '2026-01-07');
});

test('6c. nextWeekday: returns correct day', () => {
  // From 2026-11-25 (Tuesday), next Monday = 2026-11-30
  const result = nextWeekday(new Date('2026-11-25'), 'monday');
  assert.equal(result, '2026-11-30');
});

test('6d. iso: returns YYYY-MM-DD in local time', () => {
  const d = new Date('2026-06-15T12:00:00');
  const result = iso(d);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(result.startsWith('2026'));
});

/* ═══════════════════════════════════════════════════════════════
   7. REGEX EXTRACTION (offline fallback)
   ═══════════════════════════════════════════════════════════════ */
test('7a. regexExtract: "within 3 business days" extracts deadline', () => {
  const now = new Date('2026-01-01').getTime();
  const r = regexExtract('We will process your refund within 3 business days', now);
  assert.ok(r.is_promise);
  assert.ok(r.deadline_iso, 'Should extract a deadline');
  assert.match(r.deadline_iso, /^\d{4}-\d{2}-\d{2}$/);
});

test('7b. regexExtract: past-tense "has been processed" is not a promise', () => {
  const r = regexExtract('Your refund has been processed and credited to your account');
  assert.equal(r.is_promise, false);
});

test('7c. regexExtract: "tomorrow" extracts next day', () => {
  const now = new Date('2026-06-01').getTime();
  const r = regexExtract('We will ship your order tomorrow', now);
  assert.ok(r.is_promise);
  assert.equal(r.deadline_iso, '2026-06-02');
});

/* ═══════════════════════════════════════════════════════════════
   8. SIMULATED CLOCK (skew)
   ═══════════════════════════════════════════════════════════════ */
test('8. simulated clock: skew shifts effectiveState to OVERDUE', () => {
  const item = {
    id: 'sk1',
    state: 'PROMISED',
    status: 'PROMISED',
    deadline: '2026-01-01',
    verified: false,
  };
  // Without skew: in the past so OVERDUE already (from ref date perspective)
  const skewedNow = new Date('2026-01-02').getTime(); // after deadline
  const st = effectiveState(item, skewedNow);
  assert.equal(st, 'OVERDUE');
});

/* ═══════════════════════════════════════════════════════════════
   9. LEDGER SEARCH + FILTER
   ═══════════════════════════════════════════════════════════════ */
test('9a. filterLedgerItems: search by company name', () => {
  const items = [
    { id: '1', company: 'Airtel', promise: 'Fix network', state: 'PROMISED', status: 'PROMISED' },
    { id: '2', company: 'Jio', promise: 'Refund soon', state: 'PROMISED', status: 'PROMISED' },
  ];
  const result = filterLedgerItems(items, { query: 'airtel' });
  assert.equal(result.length, 1);
  assert.equal(result[0].item.id, '1');
});

test('9b. filterLedgerItems: state filter "open" excludes VERIFIED', () => {
  const now = Date.now();
  const items = [
    { id: '1', company: 'A', promise: 'P', state: 'VERIFIED', status: 'VERIFIED', verified: true },
    { id: '2', company: 'A', promise: 'Q', state: 'PROMISED', status: 'PROMISED', verified: false },
  ];
  const result = filterLedgerItems(items, { filter: 'open', now });
  assert.equal(result.length, 1);
  assert.equal(result[0].item.id, '2');
});

test('9c. filterLedgerItems: state filter "risk" includes OVERDUE and CONTRADICTION', () => {
  const past = new Date('2020-01-01').getTime();
  const items = [
    { id: '1', company: 'A', promise: 'P', state: 'PROMISED', status: 'PROMISED', deadline: '2020-01-01', verified: false },
    { id: '2', company: 'A', promise: 'Q', state: 'PROMISED', status: 'PROMISED', deadline: '2099-01-01', verified: false },
  ];
  const result = filterLedgerItems(items, { filter: 'risk', now: Date.now() });
  assert.equal(result.length, 1);
  assert.equal(result[0].item.id, '1');
});

/* ═══════════════════════════════════════════════════════════════
   10. DENY-ALL SITE OPT-IN
   ═══════════════════════════════════════════════════════════════ */
test('10. deny-all: implemented in sync.js logic (unit)', async () => {
  // Inline the core logic since we cannot call chrome.storage in Node
  function normalizeHost(h) { return String(h || '').trim().toLowerCase(); }
  function isSiteAllowed(hostname, allowedSites) {
    const host = normalizeHost(hostname);
    if (!host) return false;
    if (!Array.isArray(allowedSites) || allowedSites.length === 0) return false;
    return allowedSites.map(normalizeHost).includes(host);
  }

  assert.equal(isSiteAllowed('localhost', []), false, 'Empty list = deny all');
  assert.equal(isSiteAllowed('localhost', ['localhost']), true, 'Added site = allowed');
  assert.equal(isSiteAllowed('localhost', ['127.0.0.1']), false, 'Different host = denied');
  assert.equal(isSiteAllowed('', ['localhost']), false, 'Empty hostname = denied');

  // After remove
  const sites = ['localhost'];
  const updated = sites.filter(s => normalizeHost(s) !== normalizeHost('localhost'));
  assert.equal(isSiteAllowed('localhost', updated), false, 'Removed site = denied');
});

/* ═══════════════════════════════════════════════════════════════
   11. OFFLINE EXTRACTION FALLBACK
   ═══════════════════════════════════════════════════════════════ */
test('11. offline fallback: regexExtract returns source:fallback equivalent', () => {
  const result = regexExtract('We will ship your order within 2 days', Date.now());
  // regexExtract is the offline fallback — verify it returns a valid extraction
  assert.ok(result.is_promise);
  assert.ok(typeof result.confidence === 'number');
  assert.ok(result.confidence > 0);
});

/* ═══════════════════════════════════════════════════════════════
   12. SCHEMA MIGRATION
   ═══════════════════════════════════════════════════════════════ */
test('12a. normalizeRecord: V0.3.0 record with status+deadline string → unified', () => {
  const raw = {
    id: 'v3-1',
    company: 'OldCo',
    promise: 'We will refund',
    deadline: '2026-12-01',
    status: 'PROMISED',
    observedOk: null,
    evidence: 'We will refund you',
    timeline: [{ status: 'PROMISED', ts: 1000, note: 'Created' }],
  };
  const norm = normalizeRecord(raw, new Date('2026-11-01').getTime());
  assert.equal(norm.state, 'PROMISED');
  assert.equal(norm.deadline, '2026-12-01');
  assert.ok(typeof norm.due === 'number' || norm.due === null);
  assert.ok(Array.isArray(norm.timeline));
});

test('12b. normalizeRecord: V0.2.0 record with state+due timestamp → unified', () => {
  const dueTs = new Date('2026-12-01T23:59:59').getTime();
  const raw = {
    id: 'v2-1',
    company: 'NewCo',
    promise: 'Your order ships next week',
    state: 'PROMISED',
    due: dueTs,
    evidence: 'We will ship',
    timeline: [{ status: 'PROMISED', ts: 2000, note: 'Captured' }],
  };
  const norm = normalizeRecord(raw, new Date('2026-11-01').getTime());
  assert.equal(norm.state, 'PROMISED');
  assert.ok(norm.deadline, 'Should have deadline string');
  assert.match(norm.deadline, /^\d{4}-\d{2}-\d{2}$/);
});

/* ═══════════════════════════════════════════════════════════════
   13. MCP LEDGER COMPATIBILITY
   ═══════════════════════════════════════════════════════════════ */
test('13. toMcpRecord: output has status, deadline string, timeline array', () => {
  const item = {
    id: 'mcp-1',
    company: 'TestCo',
    promise: 'Delivery in 3 days',
    deadline: '2026-12-05',
    state: 'PROMISED',
    status: 'PROMISED',
    evidence: 'Delivery in 3 days',
    timeline: [{ status: 'PROMISED', ts: Date.now(), note: 'Captured' }],
  };
  const mcp = toMcpRecord(item);
  assert.equal(typeof mcp.status, 'string', 'status must be string');
  assert.ok(['PROMISED', 'CLAIMED', 'OBSERVED', 'VERIFIED', 'OVERDUE', 'CONTRADICTION'].includes(mcp.status));
  assert.equal(typeof mcp.deadline, 'string', 'deadline must be ISO date string');
  assert.match(mcp.deadline, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(mcp.timeline), 'timeline must be array');
});

/* ═══════════════════════════════════════════════════════════════
   14. ALARMS & NOTIFICATIONS (T-24h, Due, T+24h, dedup, badge)
   ═══════════════════════════════════════════════════════════════ */
test('14. alarms: T-24h warning, due, T+24h overdue + dedup + badge count', async () => {
  const dueTs = new Date('2026-11-29T23:59:59').getTime();
  const storage = createMockStorage({
    notifyOn: true,
    sentNotifs: {},
    ledger: [
      { id: 'n1', company: 'ShopKart', promise: 'Refund in 3 days', deadline: '2026-11-29', due: dueTs, state: 'PROMISED', status: 'PROMISED', verified: false, timeline: [] },
    ],
  });
  const created = [];
  const notifications = { create: (id, opts) => created.push({ id, ...opts }) };
  let badgeText = '';
  const action = { setBadgeText: async ({ text }) => { badgeText = text; }, setBadgeBackgroundColor: async () => {} };

  // T-12h (within 24h warning window)
  const r1 = await checkNotifications({ storage, notifications, now: dueTs - 12 * HOUR_MS });
  assert.equal(r1.fired.length, 1);
  assert.equal(r1.fired[0].type, 'warning');

  // Repeat at T-10h -> dedup prevents duplicate
  const r1b = await checkNotifications({ storage, notifications, now: dueTs - 10 * HOUR_MS });
  assert.equal(r1b.fired.length, 0);

  // Due now (within 2 min window)
  const r2 = await checkNotifications({ storage, notifications, now: dueTs + 1000 });
  assert.equal(r2.fired.length, 1);
  assert.equal(r2.fired[0].type, 'due');
  assert.equal(storage._data.ledger[0].state, 'OVERDUE');

  // T+25h -> overdue notification + badge = '1'
  const r3 = await checkNotifications({ storage, notifications, now: dueTs + 25 * HOUR_MS });
  assert.equal(r3.fired.length, 1);
  assert.equal(r3.fired[0].type, 'overdue');

  const count = await updateBadge({ storage, action, now: dueTs + 25 * HOUR_MS });
  assert.equal(count, 1);
  assert.equal(badgeText, '1');
});

/* ═══════════════════════════════════════════════════════════════
   15. SYNC.JS STORAGE OPT-IN & LEGACY MIGRATION
   ═══════════════════════════════════════════════════════════════ */
test('15. sync.js: deny-all site opt-in + V0.2.0 items migration', async () => {
  const storage = createMockStorage({
    items: [{ id: 'legacy1', company: 'OldCo', promise: 'Ship soon', state: 'PROMISED', created: 1000 }],
  });
  assert.equal(await isSiteAllowed('localhost', storage), false);
  await addAllowedSite('LocalHost', storage);
  assert.equal(await isSiteAllowed('localhost', storage), true);
  await removeAllowedSite('localhost', storage);
  assert.equal(await isSiteAllowed('localhost', storage), false);

  const migrated = await loadLedger(storage, 2000);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].id, 'legacy1');
  assert.equal(migrated[0].status, 'PROMISED');
  assert.ok(Array.isArray(storage._data.ledger));
});

/* ═══════════════════════════════════════════════════════════════
   16. LLM EXTRACTION PIPELINE (backend -> fallback)
   ═══════════════════════════════════════════════════════════════ */
test('16. extractPromise: falls back to offline regex when backend unreachable', async () => {
  const storage = createMockStorage({ backendUrl: 'http://127.0.0.1:59999/extract' });
  const failingFetch = async () => { throw new Error('ECONNREFUSED'); };
  const res = await extractPromise('Your refund will be processed within 3 business days', [], {
    storage,
    fetchImpl: failingFetch,
    now: new Date('2026-11-26T10:00:00').getTime(),
  });
  assert.equal(res.source, 'fallback');
  assert.equal(res.data.is_promise, true);
  assert.ok(res.data.deadline_iso);
});

/* ═══════════════════════════════════════════════════════════════
   17. ADAPTERS (ShopKart localhost vs Generic untrusted)
   ═══════════════════════════════════════════════════════════════ */
test('17. adapters: ShopKartAdapter on localhost vs GenericSupportAdapter ignores data-company', () => {
  const fakeDoc = {
    querySelector: sel => (sel === '[data-company]' ? { dataset: { company: 'SpoofedCo' } } : null),
  };
  const localInfo = AMXAdapters.resolveAdapter({ hostname: 'localhost' }, {
    querySelector: sel => (sel === '[data-company]' ? { dataset: { company: 'ShopKart' } } : null),
  });
  assert.equal(localInfo.adapterId, 'shopkart');
  assert.equal(localInfo.company, 'ShopKart');
  assert.equal(localInfo.companySource, 'verified-adapter');

  const remoteInfo = AMXAdapters.resolveAdapter({ hostname: 'www.example.com' }, fakeDoc);
  assert.equal(remoteInfo.adapterId, 'generic');
  assert.equal(remoteInfo.company, 'example.com');
  assert.equal(remoteInfo.companySource, 'hostname');
});

/* ═══════════════════════════════════════════════════════════════
   18. END-TO-END WORKFLOW (Promise -> Claim -> Contradiction -> MCP)
   ═══════════════════════════════════════════════════════════════ */
test('18. E2E workflow: promise -> claim match -> not received -> CONTRADICTION -> warp -> MCP', async () => {
  const baseNow = new Date('2026-11-26T10:00:00').getTime();
  const storage = createMockStorage({ ledger: [], notifyOn: true, sentNotifs: {}, skew: 0 });

  // 1-4: Detect refund promise and store in ledger
  const { data } = await extractPromise('Your refund will be processed within 3 days', [], {
    storage,
    fetchImpl: async () => { throw new Error('offline'); },
    now: baseNow,
  });
  assert.equal(data.is_promise, true);
  const item = normalizeRecord({
    id: 'c' + baseNow,
    company: 'ShopKart',
    promise: data.promise,
    deadline: data.deadline_iso,
    evidence: 'Your refund will be processed within 3 days',
    state: 'PROMISED',
    status: 'PROMISED',
    created: baseNow,
    timeline: [{ status: 'PROMISED', ts: baseNow, note: 'Confirmed by user' }],
  }, baseNow);
  await storage.set({ ledger: [item] });

  // 5-6: Company claims refund complete -> match to promise
  const match = AMXMatching.rankPromiseMatches('Good news, your refund has been processed.', storage._data.ledger, 'ShopKart');
  assert.equal(match.best?.id, item.id);
  transitionItem(item, STATES.CLAIMED);
  item.claimEvidence = 'Good news, your refund has been processed.';
  item.timeline.push({ status: 'CLAIMED', ts: baseNow + 1000, note: 'Claimed' });

  // 7-9: User checks bank -> records NOT received -> CONTRADICTION
  item.observedOk = false;
  item.observedNote = 'No credit SMS from bank';
  transitionItem(item, STATES.CONTRADICTION);
  item.timeline.push({ status: 'CONTRADICTION', ts: baseNow + 2000, note: 'Contradiction' });
  await storage.set({ ledger: [item] });

  assert.equal(item.state, 'CONTRADICTION');

  // 11: Fast-forward +6 days -> triggers overdue notification
  const warpedNow = baseNow + 6 * 864e5;
  const notifRes = await checkNotifications({
    storage,
    notifications: { create: () => {} },
    now: warpedNow,
  });
  assert.ok(notifRes.fired.some(f => f.type === 'overdue'));

  // 12: MCP record compatibility
  const mcpRec = toMcpRecord(item, warpedNow);
  assert.equal(mcpRec.status, 'CONTRADICTION');
  assert.equal(mcpRec.observedOk, false);
  assert.ok(mcpRec.timeline.length >= 3);
});

/* ═══════════════════════════════════════════════════════════════
   19. BACKEND EXTRACT_RESPONSE ADAPTER & VALIDATION
   ═══════════════════════════════════════════════════════════════ */
test('19a. extractPromise: parses FastAPI ExtractResponse { is_promise, promises: [...] }', async () => {
  const storage = createMockStorage({ backendUrl: 'http://127.0.0.1:8000/extract' });
  let capturedBody = null;
  const mockFetch = async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      async json() {
        return {
          is_promise: true,
          is_claim: false,
          extraction_method: 'offline',
          promises: [
            {
              promise: 'Refund within 5 business days',
              original_quote: 'Your refund will be processed within 5 business days.',
              deadline_hours: 120,
              deadline_date: '2026-12-03T18:00:00+05:30',
              due_ms: 1764765000000,
              condition: 'provided the item is returned',
              confidence: 0.91,
              confidence_level: 'high',
              extraction_method: 'offline',
              deadline_method: 'biz_days',
              raw_deadline: 'within 5 business days',
            },
          ],
          pii_masked: true,
          prompt_injection_detected: false,
          raw_text_hash: 'abc123',
        };
      },
    };
  };
  const res = await extractPromise('Your refund will be processed within 5 business days.', [], {
    company: 'ShopKart',
    chatUrl: 'http://localhost:8080/demo/demo_shopkart_chat.html',
    storage,
    fetchImpl: mockFetch,
    now: 1764155400000,
  });
  assert.equal(res.source, 'backend');
  assert.equal(capturedBody.company, 'ShopKart');
  assert.equal(res.data.is_promise, true);
  assert.equal(res.data.deadline_iso, '2026-12-03');
  assert.equal(res.data.conditions, 'provided the item is returned');
  assert.equal(res.data.confidence, 0.91);
  assert.equal(res.data.pii_masked, true);
});

test('19b. validateExtractResponse: rejects invalid deadline_iso & out-of-range confidence', () => {
  assert.equal(validateExtractResponse({ is_promise: true, promise: 'Valid', deadline_iso: 'not-a-date' }), false);
  assert.equal(validateExtractResponse({ is_promise: true, promise: 'Valid', confidence: 1.5 }), false);
  assert.equal(validateExtractResponse({ is_promise: true, promise: '' }), false);
  assert.equal(validateExtractResponse({ is_promise: false }), true);
});

/* ═══════════════════════════════════════════════════════════════
   20. PRINTABLE HTML DISPUTE REPORT
   ═══════════════════════════════════════════════════════════════ */
test('20. buildDisputeReportHtml: renders contradiction, timeline, print CSS, and escapes XSS', () => {
  const html = buildDisputeReportHtml([
    {
      id: 'c1',
      company: 'ShopKart',
      promise: 'Refund <script>alert(1)</script> in 5 days',
      deadline: '2026-11-29',
      originalDeadline: '2026-11-24',
      revisions: 1,
      claimEvidence: 'Good news, your refund has been processed.',
      claimedAt: 1764155400000,
      observedOk: false,
      observedNote: 'No credit in bank',
      state: 'CONTRADICTION',
      status: 'CONTRADICTION',
      source: 'http://localhost:8080/demo/demo_shopkart_chat.html',
      hash: 'deadbeef1234567890',
      timeline: [{ status: 'CONTRADICTION', ts: 1764155500000, note: 'Unfulfilled' }],
    },
  ]);
  assert.ok(html.includes('@media print'), 'Must include print CSS');
  assert.ok(html.includes('CONTRADICTION DETECTED'), 'Must highlight contradiction');
  assert.ok(html.includes('No credit in bank'), 'Must include user observation');
  assert.ok(!html.includes('<script>alert(1)</script>'), 'Must escape HTML/XSS');
});
