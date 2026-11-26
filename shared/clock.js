/**
 * shared/clock.js — AFTERMATH LIVE shared clock
 *
 * Provides a single now() that respects the simulated-clock skew stored
 * in chrome.storage.local.  Every module that needs "the current time"
 * MUST call this instead of Date.now() directly.
 *
 * Environments:
 *   Chrome extension (content script / background): reads chrome.storage.local.skew
 *   Node.js / tests: use setSkew(ms) to control the clock manually
 *
 * Usage:
 *   // Chrome extension
 *   const ts = await AftermathClock.now();
 *
 *   // Node.js
 *   const { now, setSkew } = require('./shared/clock');
 *   setSkew(3 * 86400000);
 *   console.log(await now());
 */
(function (root) {
  'use strict';

  /* ── private state (non-Chrome fallback) ─────────────────────────── */
  let _testSkew = 0;

  /* ── helpers ─────────────────────────────────────────────────────── */

  /** @returns {boolean} true when Chrome storage API is reachable */
  function hasChromeStorage() {
    return (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function'
    );
  }

  /**
   * Read the current skew (milliseconds) from storage or test state.
   * @returns {Promise<number>}
   */
  async function getSkew() {
    if (hasChromeStorage()) {
      const data = await chrome.storage.local.get('skew');
      return data.skew || 0;
    }
    return _testSkew;
  }

  /* ── public API ──────────────────────────────────────────────────── */

  /**
   * Returns the current timestamp (epoch ms), adjusted by the simulated
   * clock skew.  Every deadline calculation should use this.
   * @returns {Promise<number>}
   */
  async function now() {
    return Date.now() + (await getSkew());
  }

  /**
   * Synchronous variant — only valid in a non-Chrome / test context where
   * setSkew() has been called.  Throws if Chrome storage is detected
   * (storage reads are async).
   * @returns {number}
   */
  function nowSync() {
    if (hasChromeStorage()) {
      throw new Error(
        'nowSync() cannot be used when chrome.storage is available — use await now() instead'
      );
    }
    return Date.now() + _testSkew;
  }

  /**
   * Set the clock skew for tests (non-Chrome environments).
   * @param {number} ms  milliseconds to add to Date.now()
   */
  function setSkew(ms) {
    _testSkew = ms;
  }

  /** Reset the test skew to zero. */
  function resetSkew() {
    _testSkew = 0;
  }

  /* ── export ──────────────────────────────────────────────────────── */
  const exports = { now, nowSync, getSkew, setSkew, resetSkew };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.AftermathClock = exports;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
