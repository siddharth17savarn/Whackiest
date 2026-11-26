import { normalizeRecord, toMcpRecord } from '../shared/schema.js';

export const DEFAULT_SYNC_URL = 'http://127.0.0.1:8000/sync';

export function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase();
}

/**
 * Privacy-preserving per-site opt-in: empty allowedSites is strictly DENY-ALL.
 */
export async function isSiteAllowed(hostname, storage = chrome.storage.local) {
  const host = normalizeHost(hostname);
  if (!host) return false;
  const { allowedSites = [] } = await storage.get('allowedSites');
  if (!Array.isArray(allowedSites) || allowedSites.length === 0) {
    return false;
  }
  return allowedSites.map(normalizeHost).includes(host);
}

export async function addAllowedSite(hostname, storage = chrome.storage.local) {
  const host = normalizeHost(hostname);
  if (!host) return false;
  const { allowedSites = [] } = await storage.get('allowedSites');
  const normalized = allowedSites.map(normalizeHost);
  if (!normalized.includes(host)) {
    normalized.push(host);
    await storage.set({ allowedSites: normalized });
  }
  return true;
}

export async function removeAllowedSite(hostname, storage = chrome.storage.local) {
  const host = normalizeHost(hostname);
  const { allowedSites = [] } = await storage.get('allowedSites');
  const updated = allowedSites.map(normalizeHost).filter(s => s !== host);
  await storage.set({ allowedSites: updated });
  return true;
}

export async function getAllowedSites(storage = chrome.storage.local) {
  const { allowedSites = [] } = await storage.get('allowedSites');
  return Array.isArray(allowedSites) ? allowedSites : [];
}

/**
 * Load unified ledger, automatically migrating legacy V0.2.0 `items` if present.
 */
export async function loadLedger(storage = chrome.storage.local, nowMs = Date.now()) {
  const { ledger, items } = await storage.get(['ledger', 'items']);
  if (Array.isArray(ledger)) {
    return ledger.map(r => normalizeRecord(r, nowMs));
  }
  if (Array.isArray(items) && items.length) {
    const migrated = items.map(r => normalizeRecord(r, nowMs));
    await storage.set({ ledger: migrated });
    return migrated;
  }
  return [];
}

export async function saveLedger(ledger, storage = chrome.storage.local) {
  await storage.set({ ledger });
}

export async function syncLedgerToBridge({ storage = chrome.storage.local, fetchImpl = fetch } = {}) {
  const { ledger = [], syncUrl = DEFAULT_SYNC_URL, syncEnabled = false } = await storage.get([
    'ledger',
    'syncUrl',
    'syncEnabled',
  ]);
  if (!syncEnabled || !syncUrl) return { synced: false, reason: 'disabled' };
  try {
    const res = await fetchImpl(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ledger: ledger.map(r => toMcpRecord(r)),
        updatedAt: new Date().toISOString(),
      }),
    });
    return { synced: res.ok, status: res.status };
  } catch (_err) {
    return { synced: false, reason: 'offline' };
  }
}
