/**
 * bg/sync.js — AFTERMATH LIVE extension-side ledger sync & observation write-back.
 *
 * Bridges chrome.storage.local (items, skew) with the FastAPI /sync and /inbox
 * endpoints so ~/.aftermath/ledger.json stays synchronized with the MCP server
 * and Claude Desktop observations write back cleanly without stale-write loss.
 *
 * Works in Chrome MV3 service worker (importScripts('bg/sync.js')) and Node.js tests.
 */
(function (root) {
  'use strict';

  const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

  function resolveState(item, nowMs) {
    if (item.verified) return 'VERIFIED';
    if (item.claimed && item.observed && item.observed.ok === false) return 'CONTRADICTION';
    if (item.due && item.due < nowMs) return 'OVERDUE';
    if (item.observed) return 'OBSERVED';
    if (item.claimed) return 'CLAIMED';
    return item.state || 'PROMISED';
  }

  /**
   * Merge pending /inbox observation events into a fresh copy of `items`.
   * Returns { items, appliedEventIds } without mutating the input array.
   */
  function mergeObservationsIntoItems(items, events, nowMs) {
    const refNow = typeof nowMs === 'number' ? nowMs : Date.now();
    const cloned = (items || []).map((it) => ({ ...it }));
    const appliedEventIds = [];

    for (const ev of events || []) {
      const target = cloned.find((it) => String(it.id) === String(ev.promise_id));
      if (!target) continue;
      target.observed = {
        ok: Boolean(ev.ok),
        note: String(ev.note || (ev.ok ? 'Outcome seen' : 'Outcome not seen')),
        at: ev.at || refNow,
      };
      target.state = resolveState(target, refNow);
      if (ev.event_id) appliedEventIds.push(ev.event_id);
    }

    return { items: cloned, appliedEventIds };
  }

  /**
   * Push current chrome.storage.local items + skew to POST /sync.
   */
  async function pushLedger(options = {}) {
    const backendUrl = options.backendUrl || DEFAULT_BACKEND_URL;
    const storage = options.storage || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local);
    const fetchFn = options.fetchFn || fetch;
    if (!storage) throw new Error('chrome.storage.local is not available');

    const { items = [], skew = 0 } = await storage.get(['items', 'skew']);
    const resp = await fetchFn(`${backendUrl}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, skew }),
    });
    if (!resp.ok) {
      throw new Error(`Sync push failed with HTTP ${resp.status}`);
    }
    return resp.json();
  }

  /**
   * Pull pending observation write-backs from GET /inbox, read fresh items right
   * before writing (avoiding stale overwrites), merge, persist, and POST /inbox/ack.
   */
  async function pullInbox(options = {}) {
    const backendUrl = options.backendUrl || DEFAULT_BACKEND_URL;
    const storage = options.storage || (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local);
    const fetchFn = options.fetchFn || fetch;
    if (!storage) throw new Error('chrome.storage.local is not available');

    const resp = await fetchFn(`${backendUrl}/inbox`);
    if (!resp.ok) {
      throw new Error(`Inbox pull failed with HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const events = Array.isArray(data.events) ? data.events : [];
    if (events.length === 0) {
      return { appliedCount: 0, acknowledged: 0 };
    }

    // Read fresh storage immediately before writing to avoid stale-write data loss
    const { items = [], skew = 0 } = await storage.get(['items', 'skew']);
    const nowMs = Date.now() + (skew || 0);
    const { items: updatedItems, appliedEventIds } = mergeObservationsIntoItems(
      items,
      events,
      nowMs
    );

    if (appliedEventIds.length > 0) {
      await storage.set({ items: updatedItems });
      await fetchFn(`${backendUrl}/inbox/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_ids: appliedEventIds }),
      });
    }

    return {
      appliedCount: appliedEventIds.length,
      acknowledged: appliedEventIds.length,
    };
  }

  /**
   * Full bidirectional sync cycle (pull inbox first so MCP observations are not
   * overwritten by push, then push updated ledger to ~/.aftermath/ledger.json).
   */
  async function syncCycle(options = {}) {
    try {
      const pullResult = await pullInbox(options);
      const pushResult = await pushLedger(options);
      return { ok: true, pull: pullResult, push: pushResult };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  const exports = {
    DEFAULT_BACKEND_URL,
    resolveState,
    mergeObservationsIntoItems,
    pushLedger,
    pullInbox,
    syncCycle,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.AftermathSync = exports;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
