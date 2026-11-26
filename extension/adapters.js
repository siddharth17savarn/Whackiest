/**
 * adapters.js — AFTERMATH LIVE v0.3.1
 * IIFE UMD: works as browser global (globalThis.AMXAdapters) and Node require().
 * Identifies the company and DOM selectors for the current page.
 * Security: GenericSupportAdapter NEVER trusts [data-company] from arbitrary pages.
 */
(function (root) {
  'use strict';

  /* ── Trusted origins for ShopKart adapter ── */
  const SHOPKART_ORIGINS = new Set(['localhost', '127.0.0.1']);

  /**
   * ShopKartAdapter — only activates on localhost / 127.0.0.1 demo pages.
   * Uses [data-company] only on these verified origins.
   */
  const ShopKartAdapter = {
    id: 'shopkart',
    name: 'ShopKart Demo',

    matches(loc /*, doc */) {
      return SHOPKART_ORIGINS.has(loc.hostname);
    },

    resolve(loc, doc) {
      // Safe: we checked the origin above
      const attr = doc.querySelector('[data-company]')?.dataset?.company;
      const company = attr && SHOPKART_ORIGINS.has(loc.hostname) ? String(attr) : 'ShopKart';
      return {
        company,
        companySource: 'verified-adapter',
        adapterId: this.id,
        selectors: [
          { root: '#chat', msg: '.msg', isAgent: n => n.classList.contains('agent') },
          { root: '#log', msg: '.msg', isAgent: n => n.classList.contains('agent') },
        ],
      };
    },

    /** Stream stabilisation: wait for text to stop changing for 400 ms */
    async waitForStable(el) {
      return waitForStableText(el, 400);
    },
  };

  /**
   * GenericSupportAdapter — fallback for any page.
   * Company is always derived from hostname, never from [data-company].
   */
  const GenericSupportAdapter = {
    id: 'generic',
    name: 'Generic Support',

    matches(/* loc, doc */) {
      return true; // always a fallback
    },

    resolve(loc /*, doc */) {
      // Hostname only — never trusts arbitrary DOM attributes
      const company = loc.hostname.replace(/^www\./, '') || 'Unknown';
      return {
        company,
        companySource: 'hostname',
        adapterId: this.id,
        selectors: [
          {
            root: '[role=log],[aria-live=polite],[class*=message-list i],[class*=messages i],[class*=chat-body i]',
            msg: null,
            isAgent: n =>
              /agent|bot|operator|support|incoming|received|assistant|them/i.test(n.className) &&
              !/user|customer|outgoing|sent|self|mine/i.test(n.className),
          },
        ],
      };
    },

    async waitForStable(el) {
      return waitForStableText(el, 600);
    },
  };

  /* ── Registry ── */
  const registry = [ShopKartAdapter, GenericSupportAdapter];

  /**
   * Resolve the best adapter for the current page.
   * Returns adapter.resolve() result merged with { wait } helper.
   * @param {Location} loc — window.location or equivalent
   * @param {Document} doc — document
   */
  function resolveAdapter(loc, doc) {
    for (const a of registry) {
      if (a.matches(loc, doc)) {
        const info = a.resolve(loc, doc);
        info.wait = el => a.waitForStable(el);
        return info;
      }
    }
    // Unreachable: GenericSupportAdapter always matches
    return null;
  }

  /**
   * Register a custom adapter at the front of the chain.
   * @param {object} adapter — must implement { matches, resolve, waitForStable, id, name }
   */
  function registerAdapter(adapter) {
    registry.unshift(adapter);
  }

  /* ── Streaming stabilisation helper ── */
  /**
   * Waits until el.innerText stops changing for `quietMs` ms, or 3 s timeout.
   * Returns the stable text.
   */
  function waitForStableText(el, quietMs = 500) {
    return new Promise(resolve => {
      const readText = () => (el.innerText ?? el.textContent ?? '').trim();
      let last = readText();
      let timer = null;
      let safetyTimer = null;
      const MAX = 3000;
      let elapsed = 0;

      const finish = text => {
        clearTimeout(timer);
        clearTimeout(safetyTimer);
        resolve(text);
      };

      const check = () => {
        if (el.dataset?.streaming === 'true') {
          elapsed += quietMs;
          if (elapsed < 8000) {
            timer = setTimeout(check, quietMs);
            return;
          }
        }
        const cur = readText();
        if (cur === last) {
          finish(cur);
        } else {
          last = cur;
          elapsed += quietMs;
          if (elapsed >= MAX) {
            finish(cur);
          } else {
            timer = setTimeout(check, quietMs);
          }
        }
      };

      timer = setTimeout(check, quietMs);

      // Safety: resolve after MAX ms regardless
      safetyTimer = setTimeout(() => {
        finish(readText());
      }, MAX + quietMs);
    });
  }

  /* ── Export ── */
  const api = {
    resolveAdapter,
    registerAdapter,
    ShopKartAdapter,
    GenericSupportAdapter,
    waitForStableText,
  };

  root.AMXAdapters = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
