'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getDataDir() {
  const dir = process.env.AFTERMATH_DATA_DIR || path.join(os.homedir(), '.aftermath');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLedgerPath() {
  if (process.env.AFTERMATH_LEDGER_PATH) {
    const p = process.env.AFTERMATH_LEDGER_PATH;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
  }
  return path.join(getDataDir(), 'ledger.json');
}

function getInboxPath() {
  return path.join(getDataDir(), 'inbox.json');
}

function atomicWriteJson(targetPath, data) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(targetPath)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, targetPath);
}

function readLedger() {
  const ledgerPath = getLedgerPath();
  if (!fs.existsSync(ledgerPath)) {
    return { schema_version: '1.0', updated_at: null, skew: 0, items: [] };
  }
  const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (Array.isArray(raw)) {
    return { schema_version: '1.0', updated_at: null, skew: 0, items: raw };
  }
  return {
    schema_version: raw.schema_version || '1.0',
    updated_at: raw.updated_at || null,
    skew: typeof raw.skew === 'number' ? raw.skew : 0,
    items: Array.isArray(raw.items) ? raw.items : [],
  };
}

function writeLedger(items, skew = 0) {
  const payload = {
    schema_version: '1.0',
    updated_at: new Date().toISOString(),
    skew,
    items,
  };
  atomicWriteJson(getLedgerPath(), payload);
  return payload;
}

function resolveState(item, nowMs) {
  if (item.verified) return 'VERIFIED';
  if (item.claimed && item.observed && item.observed.ok === false) return 'CONTRADICTION';
  if (item.due != null && item.due < nowMs) return 'OVERDUE';
  if (item.observed) return 'OBSERVED';
  if (item.claimed) return 'CLAIMED';
  return item.state || 'PROMISED';
}

function getEffectiveNowMs(ledger, overrideNowMs) {
  if (typeof overrideNowMs === 'number' && Number.isFinite(overrideNowMs)) {
    return overrideNowMs;
  }
  return Date.now() + (ledger.skew || 0);
}

function readInbox() {
  const p = getInboxPath();
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function addObservation({ promiseId, ok, note, atMs }) {
  const trimmedNote = String(note || '').trim();
  if (!trimmedNote) {
    throw new Error('Observation note must not be empty');
  }
  const ledger = readLedger();
  const nowMs = getEffectiveNowMs(ledger, atMs);
  const target = ledger.items.find((it) => String(it.id) === String(promiseId));
  if (!target) {
    throw new Error(`Promise ID ${promiseId} not found in ledger`);
  }

  target.observed = {
    ok: Boolean(ok),
    note: trimmedNote,
    at: nowMs,
  };
  target.state = resolveState(target, nowMs);

  writeLedger(ledger.items, ledger.skew || 0);

  // Also queue write-back event in inbox.json so bg/sync.js pulls it into chrome.storage.local
  const events = readInbox();
  const event = {
    event_id: crypto.randomBytes(6).toString('hex'),
    promise_id: target.id,
    ok: Boolean(ok),
    note: trimmedNote,
    at: nowMs,
    created_at: new Date().toISOString(),
  };
  events.push(event);
  atomicWriteJson(getInboxPath(), events);

  return { item: target, event };
}

function computeStats(ledger, nowMs) {
  const refNow = getEffectiveNowMs(ledger, nowMs);
  const byCompany = {};
  let overdue = 0;
  let contradictions = 0;
  let verified = 0;
  let open = 0;

  for (const it of ledger.items) {
    const co = it.company || 'Unknown';
    if (!byCompany[co]) {
      byCompany[co] = { total: 0, overdue: 0, contradictions: 0, verified: 0 };
    }
    byCompany[co].total++;

    const st = resolveState(it, refNow);
    const isOverdue = !it.verified && it.due != null && it.due < refNow;
    if (isOverdue) {
      overdue++;
      byCompany[co].overdue++;
    }
    if (st === 'CONTRADICTION') {
      contradictions++;
      byCompany[co].contradictions++;
    } else if (st === 'VERIFIED') {
      verified++;
      byCompany[co].verified++;
    } else if (!isOverdue) {
      open++;
    }
  }

  return {
    total: ledger.items.length,
    overdue,
    contradictions,
    verified,
    open,
    by_company: byCompany,
    now_ms: refNow,
  };
}

module.exports = {
  getDataDir,
  getLedgerPath,
  getInboxPath,
  readLedger,
  writeLedger,
  readInbox,
  resolveState,
  getEffectiveNowMs,
  addObservation,
  computeStats,
};
