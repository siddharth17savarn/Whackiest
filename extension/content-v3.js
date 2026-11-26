/**
 * content-v3.js — AFTERMATH LIVE v0.3.1
 * Merged content script: V0.3.0 Shadow DOM panel + V0.2.0 FIFO toast queue,
 * streaming stabilisation, site opt-in, stale-write prevention, state machine.
 * Depends on: shared/matching.js (AMXMatching), adapters.js (AMXAdapters)
 */
(() => {
  if (window.__aftermathV3) return;
  window.__aftermathV3 = true;

  /* ───────────── Guards ───────────── */
  const CLAIM_RE =
    /(has|have|had) (now )?been (processed|completed|resolved|delivered|issued|initiated|fixed|credited)|is now (resolved|complete|done)|we('ve| have) (processed|issued|resolved|completed|refunded|shipped)/i;

  /* ───────────── DOM helpers ───────────── */
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    Object.assign(e, props);
    e.append(...kids);
    return e;
  };
  const sha = async t => {
    try {
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return '';
    }
  };

  /* ───────────── State ───────────── */
  const seenElements = new WeakSet();
  const seenFingerprints = new Set();
  let initTries = 0;
  let attachTries = 0;
  let started = false;

  /* ───────────── FIFO Toast Queue ───────────── */
  let toastActive = false;
  const toastQueue = [];

  function enqueue(fn) {
    toastQueue.push(fn);
    if (!toastActive) showNext();
  }

  function showNext() {
    if (!toastQueue.length) {
      toastActive = false;
      return;
    }
    toastActive = true;
    const fn = toastQueue.shift();
    fn(onToastClose);
  }

  function onToastClose() {
    setTimeout(showNext, 150);
  }

  /* ───────────── Shadow DOM panel ───────────── */
  const CSS = `
    .card{width:360px;background:#fff;color:#202124;border-radius:14px;
      box-shadow:0 10px 30px rgba(0,0,0,.3);font:14px system-ui,sans-serif;
      overflow:hidden;animation:pop .25s ease}
    @keyframes pop{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}
    .hd{padding:10px 14px;background:linear-gradient(135deg,#1a73e8,#6f42c1);
      color:#fff;font-weight:700;display:flex;justify-content:space-between;align-items:center}
    .tag{font-size:10px;background:rgba(255,255,255,.25);padding:2px 8px;border-radius:99px}
    .bd{padding:12px 14px}
    label{display:block;font-size:11px;color:#5f6368;margin:9px 0 3px;
      text-transform:uppercase;letter-spacing:.05em}
    textarea,input[type=text],input[type=date]{width:100%;box-sizing:border-box;
      border:1px solid #dadce0;border-radius:8px;padding:7px;font:13px system-ui}
    .q{font-style:italic;color:#5f6368;border-left:3px solid #dadce0;
      padding-left:8px;margin:6px 0}
    .rev{background:#fef7e0;color:#b06000;border-radius:8px;
      padding:8px;margin-top:8px;font-size:12px}
    .amb{background:#e8f0fe;color:#1a73e8;border-radius:8px;
      padding:8px;margin-top:8px;font-size:12px}
    select{width:100%;box-sizing:border-box;border:1px solid #dadce0;
      border-radius:8px;padding:7px;font:13px system-ui;margin-top:4px}
    .row{display:flex;gap:6px;margin-top:12px}
    button{flex:1;border:0;border-radius:8px;padding:9px 4px;
      cursor:pointer;color:#fff;font-weight:600;font-size:12px}
    .ok{background:#188038}.no{background:#80868b}.warn{background:#e37400}
  `;

  function panel(title, tag, body, actions, closeCb) {
    document.getElementById('aftermath-host')?.remove();
    const host = h('div', { id: 'aftermath-host' });
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    const close = () => { host.remove(); if (closeCb) closeCb(); };
    root.append(
      h('style', { textContent: CSS }),
      h('div', { className: 'card' },
        h('div', { className: 'hd' },
          h('span', { textContent: title }),
          h('span', { className: 'tag', textContent: tag })),
        h('div', { className: 'bd' },
          ...body,
          h('div', { className: 'row' },
            ...actions.map(([l, c, f]) =>
              h('button', { className: c, textContent: l, onclick: () => f(close) }))))));
    document.body.append(host);
    return close;
  }

  function mark(node, text, color) {
    node.style.outline = '3px solid ' + color;
    node.style.outlineOffset = '2px';
    const t = h('div', { textContent: text });
    t.style.cssText = `font-size:11px;font-weight:700;color:${color};margin-top:4px`;
    node.append(t);
  }

  /* ───────────── Ledger helpers (content script cannot import ES modules) ───────────── */
  const getLedger = async () => (await chrome.storage.local.get('ledger')).ledger || [];

  /* ───────────── Init with site opt-in ───────────── */
  async function init() {
    if (started) return;
    const hostname = location.hostname;
    let allowed = false;
    try {
      allowed = await chrome.runtime.sendMessage({ action: 'checkSite', hostname });
    } catch { return; }
    if (!allowed) {
      if (++initTries < 2) setTimeout(init, 5000);
      return;
    }
    started = true;
    start();
  }
  init();

  // Auto-activate if user enables this site in popup while tab is already open
  try {
    chrome.storage.onChanged.addListener(changes => {
      if (!started && changes.allowedSites) {
        const list = (changes.allowedSites.newValue || []).map(s => String(s).trim().toLowerCase());
        if (list.includes(location.hostname.trim().toLowerCase())) {
          started = true;
          start();
        }
      }
    });
  } catch {}

  /* ───────────── Adapter + DOM ───────────── */
  function start() {
    const adapter = (typeof AMXAdapters !== 'undefined')
      ? AMXAdapters.resolveAdapter(location, document)
      : null;

    const company = adapter ? adapter.company : location.hostname.replace(/^www\./, '') || 'Unknown';
    const selectors = adapter?.selectors || [
      {
        root: '#chat,[role=log],[aria-live=polite],[class*=message-list i],[class*=messages i]',
        msg: null,
        isAgent: n =>
          /agent|bot|operator|support|incoming|received|assistant|them/i.test(n.className) &&
          !/user|customer|outgoing|sent|self|mine/i.test(n.className),
      },
    ];

    function tryAttach() {
      for (const A of selectors) {
        const chat = document.querySelector(A.root);
        if (chat) { attachToChat(A, chat, company, adapter); return; }
      }
      if (++attachTries < 8) setTimeout(tryAttach, 2000);
    }
    tryAttach();
  }

  /* ───────────── Transcript ───────────── */
  function captureTranscript(msgs, isAgent) {
    return msgs().slice(-8).map(el => ({
      who: isAgent(el) ? 'AGENT' : 'CUSTOMER',
      text: (el.innerText || '').trim().slice(0, 400),
      ts: Date.now(),
    }));
  }

  /* ───────────── Chat observation ───────────── */
  function attachToChat(A, chat, company, adapter) {
    const msgs = () => [...(A.msg ? chat.querySelectorAll(A.msg) : chat.children)];

    // Skip historical messages
    for (const el of msgs()) {
      seenElements.add(el);
      const fp = `${company}::${(el.innerText || '').trim().slice(0, 120)}`;
      seenFingerprints.add(fp);
    }

    new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && !seenElements.has(n) && A.isAgent(n)) {
            seenElements.add(n);
            handle(n, company, A, msgs, adapter);
          }
        }
      }
    }).observe(chat, { childList: true });
  }

  /* ───────────── Message handler ───────────── */
  async function handle(node, company, A, msgs, adapter) {
    // Streaming stabilisation
    let text;
    if (adapter?.wait) {
      text = await adapter.wait(node);
    } else {
      text = (node.innerText || '').trim();
    }

    if (!text || text.length < 12 || text.length > 700) return;

    // Dynamic company on verified localhost demo pages (supports ShopKart <-> SwiftPay switch)
    const activeCompany =
      adapter?.adapterId === 'shopkart'
        ? document.querySelector('[data-company]')?.dataset?.company || company
        : company;

    // Fingerprint dedup
    const fp = `${activeCompany}::${text.slice(0, 120)}`;
    if (seenFingerprints.has(fp)) return;
    seenFingerprints.add(fp);

    if (CLAIM_RE.test(text)) {
      enqueue(close => offerClaim(text, node, activeCompany, A, msgs, close));
      return;
    }

    const context = captureTranscript(msgs, A.isAgent).map(t => t.who + ': ' + t.text);
    let res;
    try {
      res = await chrome.runtime.sendMessage({
        action: 'extract',
        text,
        context,
        company: activeCompany,
        chatUrl: location.href,
      });
    } catch { return; }
    if (!res?.ok || !res.data?.is_promise) return;

    enqueue(close => offerPromise(res.data, res.source, text, node, activeCompany, adapter, A, msgs, close));
  }

  /* ───────────── Promise toast ───────────── */
  async function offerPromise(d, source, evidence, node, company, adapter, A, msgs, closeCb) {
    // Stale-write prevention: read ledger inside the action, not outside
    const pr = h('textarea', { rows: 2 });
    pr.value = d.promise || evidence;
    const dl = h('input', { type: 'date' });
    dl.value = d.deadline_iso || '';
    const cd = h('input', { type: 'text', placeholder: 'none' });
    cd.value = d.conditions || '';

    // Revision detection (Jaccard similarity ≥ 0.25 with any existing open promise)
    const ledgerSnap = await getLedger();
    const toks = s => new Set((s || '').toLowerCase().match(/[a-z]{4,}/g) || []);
    const sim = (a, b) => {
      const A = toks(a), B = toks(b);
      const i = [...A].filter(x => B.has(x)).length;
      return i / (A.size + B.size - i || 1);
    };
    const prevMatch = ledgerSnap
      .filter(c => c.company === company && c.status !== 'VERIFIED' && c.state !== 'VERIFIED')
      .map(c => ({ c, s: sim(c.promise, pr.value) }))
      .sort((a, b) => b.s - a.s)[0];
    const rev = prevMatch && prevMatch.s >= 0.25 ? prevMatch.c : null;

    const conf = d.confidence != null ? ' · ' + Math.round(d.confidence * 100) + '%' : '';
    const srcLabel = source === 'gemini' ? 'Gemini' : source === 'backend' ? 'API' : 'Offline';

    const create = async (revises, panelClose) => {
      const ts = Date.now();
      const tr = captureTranscript(msgs, A.isAgent);
      // Stale-write prevention: always read fresh from storage using item.id
      const freshLedger = await getLedger();
      if (revises) {
        const x = freshLedger.find(y => y.id === revises.id);
        if (x) {
          const old = x.deadline;
          x.timeline = x.timeline || [];
          x.timeline.push({ status: x.status || x.state, ts, note: `REVISED: deadline ${old || 'none'} → ${dl.value || 'none'}. Company now says: "${pr.value.trim()}"` });
          x.originalDeadline = x.originalDeadline || old;
          x.deadline = dl.value || null;
          x.promise = pr.value.trim();
          x.revisions = (x.revisions || 0) + 1;
          x.nOver = 0; x.nSoon = 0;
          x.transcript = [...(x.transcript || []), ...tr].slice(-30);
          await chrome.storage.local.set({ ledger: freshLedger });
          mark(node, '↻ Revised promise logged (original kept)', '#e37400');
        }
        panelClose();
        return;
      }
      freshLedger.push({
        id: 'c' + ts,
        company,
        companySource: adapter?.companySource || 'hostname',
        promise: pr.value.trim(),
        deadline: dl.value || null,
        conditions: cd.value.trim() || null,
        evidence,
        source: location.href,
        hash: await sha(evidence + ts),
        transcript: tr,
        state: 'PROMISED',
        status: 'PROMISED',
        observedOk: null,
        condMet: null,
        created: ts,
        timeline: [{ status: 'PROMISED', ts, note: 'Confirmed by user on ' + company }],
      });
      await chrome.storage.local.set({ ledger: freshLedger });
      mark(node, '✓ Tracked by AFTERMATH', '#188038');
      panelClose();
    };

    const body = [
      h('label', { textContent: 'Company' }),
      h('div', { textContent: company }),
      h('label', { textContent: 'Promise (editable)' }), pr,
      h('label', { textContent: 'Deadline' }), dl,
      h('label', { textContent: 'Conditions' }), cd,
      ...(rev ? [h('div', { className: 'rev', textContent: `You already track: "${rev.promise}" (due ${rev.deadline || 'no date'}). This looks like a changed promise.` })] : []),
    ];

    const acts = [];
    if (rev) acts.push(['Revision of old', 'warn', async close => { await create(rev, close); }]);
    acts.push(['Track it', 'ok', async close => { await create(null, close); }]);
    acts.push(['Dismiss', 'no', close => { close(); }]);

    panel('Promise detected', srcLabel + conf, body, acts, closeCb);
  }

  /* ───────────── Claim toast ───────────── */
  async function offerClaim(text, node, company, A, msgs, closeCb) {
    const ledger = await getLedger();
    const open = ledger.filter(x =>
      x.company === company &&
      ['PROMISED', 'CLAIMED', 'OVERDUE'].includes(x.status || x.state));
    if (!open.length) { if (closeCb) closeCb(); return; }

    // Use AMXMatching for best match + ambiguity detection
    let best;
    let ambiguous = false;
    let candidates = [];
    if (typeof AMXMatching !== 'undefined') {
      const result = AMXMatching.rankPromiseMatches(text, open, company);
      ambiguous = result.ambiguous;
      candidates = result.candidates || [];
      best = result.best || (candidates[0]?.item ?? open[0]);
    } else {
      const toks = s => new Set((s || '').toLowerCase().match(/[a-z]{4,}/g) || []);
      const sim = (a, b) => {
        const A = toks(a), B = toks(b);
        const i = [...A].filter(x => B.has(x)).length;
        return i / (A.size + B.size - i || 1);
      };
      best = open.map(x => ({ x, s: sim(x.promise, text) }))
        .sort((a, b) => b.s - a.s)[0].x;
    }

    let selectedId = best.id;
    const body = [
      h('label', { textContent: 'Tracked promise' }),
      h('div', { textContent: best.promise }),
      h('label', { textContent: 'Company just said' }),
      h('div', { className: 'q', textContent: text }),
    ];

    if (ambiguous && candidates.length > 1) {
      const sel = h('select');
      for (const { item } of candidates.slice(0, 5)) {
        const opt = h('option', { value: item.id, textContent: item.promise.slice(0, 65) });
        if (item.id === selectedId) opt.selected = true;
        sel.append(opt);
      }
      sel.onchange = () => { selectedId = sel.value || best.id; };
      body.push(h('div', { className: 'amb' },
        h('div', { textContent: 'Multiple matching promises. Confirm which one this claim is for:' }),
        sel));
    }

    body.push(h('div', { textContent: 'Record as a CLAIM? It will NOT count as fulfilled until you verify it yourself.' }));

    panel('Company claims it\'s done', 'Claim ≠ proof', body, [
      ['Record claim', 'warn', async close => {
        // Stale-write prevention: re-read by selectedId
        const freshLedger = await getLedger();
        const x = freshLedger.find(y => y.id === selectedId);
        const ts = Date.now();
        if (x) {
          x.state = 'CLAIMED';
          x.status = 'CLAIMED';
          x.claimEvidence = text;
          x.claimedAt = ts;
          x.transcript = [...(x.transcript || []), ...captureTranscript(msgs, A.isAgent)].slice(-30);
          x.timeline = x.timeline || [];
          x.timeline.push({ status: 'CLAIMED', ts, note: 'Company said: ' + text });
          await chrome.storage.local.set({ ledger: freshLedger });
          mark(node, '⚠ Claimed, not verified', '#e37400');
        }
        close();
      }],
      ['Ignore', 'no', close => close()],
    ], closeCb);
  }
})();
