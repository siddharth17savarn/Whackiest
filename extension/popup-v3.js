/**
 * popup-v3.js — AFTERMATH LIVE v0.3.1
 * ES module. Merged V0.3.0 card rendering + V0.2.0 search/filter/sites/warp-skew.
 */
import { effectiveState } from './shared/state.js';
import { filterLedgerItems } from './shared/ledger_filter.js';
import { normalizeRecord } from './shared/schema.js';

const ALL_STATES = ['PROMISED', 'CLAIMED', 'OBSERVED', 'VERIFIED', 'OVERDUE', 'CONTRADICTION'];
const DAY = 864e5;
const $ = s => document.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};
const T = (cls, text) => h('div', { className: cls, textContent: text });

let FILTER = 'all';
let QUERY = '';
let skewMs = 0;

/* ───────────── Storage helpers ───────────── */
async function load() {
  const { ledger, items, apiKey = '', notifyOn = true, skew = 0 } =
    await chrome.storage.local.get(['ledger', 'items', 'apiKey', 'notifyOn', 'skew']);
  skewMs = Number(skew) || 0;
  const nowMs = Date.now() + skewMs;

  let raw = [];
  if (Array.isArray(ledger)) raw = ledger;
  else if (Array.isArray(items) && items.length) raw = items;

  const normalized = raw.map(r => normalizeRecord(r, nowMs));
  return { ledger: normalized, apiKey, notifyOn };
}

async function saveLedger(l) {
  await chrome.storage.local.set({ ledger: l });
  await render();
}

async function mutate(id, fn) {
  const { ledger } = await load();
  const c = ledger.find(x => x.id === id);
  if (c) { fn(c); await saveLedger(ledger); }
}

/* ───────────── Date helpers ───────────── */
const nowSim = () => new Date(Date.now() + skewMs);
const endOf = c => c.deadline ? new Date(c.deadline + 'T23:59:59') : null;
const isOverdue = c => !!c.deadline && c.state !== 'VERIFIED' && endOf(c) < nowSim();
const isBroken = c =>
  c.state !== 'VERIFIED' &&
  (isOverdue(c) || c.observedOk === false || c.state === 'CONTRADICTION' || c.state === 'OVERDUE');
const urgency = c =>
  c.state === 'VERIFIED' ? 9e15
    : isBroken(c) ? 0
    : c.deadline ? endOf(c).getTime()
    : 8e15;

function dueChip(c) {
  if (c.state === 'VERIFIED') return ['Fulfilled', 'green'];
  if (!c.deadline) return ['No deadline', ''];
  const diff = endOf(c) - nowSim();
  if (diff < 0) {
    const d = Math.floor(-diff / DAY);
    return ['Overdue' + (d ? ` by ${d}d` : ''), 'red'];
  }
  const d = Math.ceil(diff / DAY);
  return [d <= 1 ? 'Due today' : `Due in ${d}d`, d <= 1 ? 'amber' : ''];
}

const btn = (label, cls, fn) => h('button', { className: 'b ' + cls, textContent: label, onclick: fn });

/* ───────────── Escalation draft ───────────── */
function escalation(c) {
  const fmt = ts => new Date(ts).toLocaleDateString();
  const lines = (c.timeline || []).map(t => `- ${fmt(t.ts)}: ${t.status} - ${t.note}`).join('\n');
  return `Subject: Unfulfilled commitment - ${c.promise.slice(0, 70)}\n\nDear ${c.company} Support / Grievance Officer,\n\n` +
    `On ${fmt((c.timeline || [{}])[0].ts || Date.now())} your representative committed: "${c.evidence}"\n` +
    (c.deadline ? `The agreed deadline was ${c.originalDeadline || c.deadline}${c.revisions ? ` (revised ${c.revisions}x, now ${c.deadline})` : ''}. ` : '') +
    `As of ${fmt(Date.now())} this has not been fulfilled${c.observedNote ? ` (${c.observedNote})` : ''}.\n\nTimeline of record:\n${lines}\n\n` +
    `Please resolve this within 3 working days or escalate it to a senior officer and share a reference number. Evidence ID: ${(c.hash || 'n/a').slice(0, 12)}.\n\nRegards`;
}

/* ───────────── Card builder ───────────── */
function buildCard(c) {
  const [chipText, chipCls] = dueChip(c);
  const st = c.state;
  const stepperStates = ['PROMISED', 'CLAIMED', 'OBSERVED', 'VERIFIED'];
  const idx = stepperStates.indexOf(st.replace('OVERDUE', 'CLAIMED').replace('CONTRADICTION', 'OBSERVED'));

  const card = h('div', { className: 'card' + (st === 'VERIFIED' ? ' done' : isBroken(c) ? ' bad' : '') });
  const title = T('pr', c.promise);
  if (c.revisions) title.append(h('span', { className: 'pill rev', textContent: `revised ${c.revisions}x` }));

  card.append(h('div', { className: 'top' },
    T('av', (c.company || '?')[0].toUpperCase()),
    h('div', { className: 'tt' }, T('co', c.company), title),
    T('chip ' + chipCls, chipText)));

  card.append(h('div', { className: 'stepper' },
    ...stepperStates.map((s, i) =>
      T('step' + (i <= idx ? ' on' : '') + (s === 'VERIFIED' ? ' v' : ''), s))));

  // State overlays for OVERDUE / CONTRADICTION
  if (st === 'OVERDUE') card.append(T('alert red', 'OVERDUE: deadline passed and not verified.'));
  if (st === 'CONTRADICTION') card.append(T('alert red', 'CONTRADICTION: company claim vs your observation' + (c.observedNote ? ` (${c.observedNote})` : '')));

  if (c.revisions) card.append(T('alert amber', `Deadline slipped: originally ${c.originalDeadline || 'n/a'}, now ${c.deadline || 'none'}.`));
  if (c.conditions) {
    card.append(T('alert amber', 'Condition: ' + c.conditions));
    card.append(h('label', { className: 'cond' },
      h('input', {
        type: 'checkbox', checked: !!c.condMet,
        onchange: e => mutate(c.id, x => {
          x.condMet = e.target.checked;
          x.timeline.push({ status: x.state, ts: Date.now(), note: 'You marked condition as ' + (e.target.checked ? 'MET' : 'NOT met') });
        })
      }), ' I have met this condition'));
    if (isOverdue(c) && !c.condMet) card.append(T('alert amber', 'They may cite your unmet condition.'));
  }
  if (isOverdue(c) && st !== 'OVERDUE') card.append(T('alert red', 'Deadline passed and this is not verified as fulfilled.'));
  if (st === 'CLAIMED') card.append(T('alert amber', 'The company CLAIMS this is done. A claim is not proof.'));
  if (st === 'OBSERVED' && c.observedOk === false) card.append(T('alert red', 'CONTRADICTION: company claim vs your observation' + (c.observedNote ? ' (' + c.observedNote + ')' : '')));
  if (st === 'VERIFIED') card.append(T('alert green', 'Verified by your own evidence' + (c.observedNote ? ': ' + c.observedNote : '')));

  const act = h('div', { className: 'act' });
  if (st === 'PROMISED' || st === 'OVERDUE') {
    act.append(btn('Company says it\'s done', '', () => mutate(c.id, x => {
      x.state = 'CLAIMED'; x.status = 'CLAIMED'; x.claimedAt = Date.now();
      x.timeline.push({ status: 'CLAIMED', ts: Date.now(), note: 'Company claimed completion' });
    })));
  }
  if (['PROMISED', 'CLAIMED', 'OVERDUE'].includes(st)) {
    const note = h('input', { placeholder: 'What actually happened? (e.g. no credit SMS from bank)' });
    const go = ok => () => {
      const n = note.value.trim();
      if (ok && !n) { note.classList.add('err'); note.placeholder = 'Describe your evidence to mark Received'; return; }
      mutate(c.id, x => {
        const ts = Date.now();
        x.observedOk = ok;
        x.observedNote = n || null;
        x.observed = { ok, note: n, at: ts };
        x.timeline.push({ status: 'OBSERVED', ts, note: (ok ? 'Observed: received' : 'Observed: NOT received') + (n ? ' - ' + n : '') });
        if (ok) {
          x.state = 'OBSERVED';
          x.status = 'OBSERVED';
        } else {
          x.state = 'CONTRADICTION';
          x.status = 'CONTRADICTION';
          x.timeline.push({ status: 'CONTRADICTION', ts, note: 'Contradiction recorded: promised/claimed but not received' });
        }
      });
    };
    act.append(note, btn('Not received', 'red', go(false)), btn('Received', 'green', go(true)));
  }
  if (st === 'OBSERVED' && c.observedOk) {
    act.append(btn('Mark VERIFIED', 'green', () => mutate(c.id, x => {
      x.state = 'VERIFIED'; x.status = 'VERIFIED'; x.verified = true;
      x.timeline.push({ status: 'VERIFIED', ts: Date.now(), note: 'Evidence supports fulfilment' });
    })));
  }
  if (st === 'OBSERVED' && c.observedOk === false) {
    act.append(btn('It got fixed, verify', 'green', () => mutate(c.id, x => {
      x.state = 'VERIFIED'; x.status = 'VERIFIED'; x.observedOk = true; x.verified = true;
      x.timeline.push({ status: 'VERIFIED', ts: Date.now(), note: 'Later fulfilled and verified' });
    })));
  }
  if (st === 'CONTRADICTION') {
    act.append(btn('Mark VERIFIED', 'green', () => mutate(c.id, x => {
      x.state = 'VERIFIED'; x.status = 'VERIFIED'; x.verified = true;
      x.timeline.push({ status: 'VERIFIED', ts: Date.now(), note: 'Resolved after contradiction' });
    })));
  }

  if (isBroken(c)) {
    const box = h('textarea', { className: 'draft', value: escalation(c), hidden: true });
    act.append(btn('Draft escalation', 'amber', async () => {
      box.hidden = false; box.select();
      try { await navigator.clipboard.writeText(box.value); } catch {}
    }));
    card.append(act, box);
  } else {
    card.append(act);
  }
  act.append(btn('Remove', 'ghost', async () => {
    const { ledger } = await load(); await saveLedger(ledger.filter(x => x.id !== c.id));
  }));

  const tr = c.transcript || [];
  card.append(h('details', {},
    h('summary', { textContent: 'Evidence and timeline' }),
    T('q', '\u201C' + (c.evidence || c.promise) + '\u201D'),
    h('div', { className: 'tl' }, ...(c.timeline || []).map(t =>
      T('', new Date(t.ts).toLocaleString() + ' | ' + t.status + ': ' + t.note))),
    ...(tr.length ? [T('co', 'Chat context captured'),
      h('div', { className: 'tl' }, ...tr.map(t => T('', t.who + ': ' + t.text)))] : []),
    ...(c.hash ? [T('hash', 'SHA-256 ' + c.hash.slice(0, 24) + '\u2026')] : [])));

  return card;
}

/* ───────────── Reliability scores ───────────── */
function reliability(ledger) {
  const by = {};
  ledger.forEach(c => (by[c.company] ||= []).push(c));
  return Object.entries(by).map(([co, cs]) => {
    const kept = cs.filter(c => c.state === 'VERIFIED').length;
    const broken = cs.filter(isBroken).length;
    const slips = cs.reduce((n, c) => n + (c.revisions || 0), 0);
    return { co, kept, broken, slips, total: cs.length, pct: kept + broken ? Math.round(100 * kept / (kept + broken)) : null };
  });
}

/* ───────────── Render ───────────── */
async function render() {
  const { ledger } = await load();
  const nowMs = Date.now() + skewMs;

  const risk = ledger.filter(isBroken).length;
  const done = ledger.filter(c => c.state === 'VERIFIED').length;
  const contra = ledger.filter(c => c.state === 'CONTRADICTION').length;

  $('#stats').replaceChildren(
    ...[['Tracked', ledger.length], ['At risk', risk], ['Verified', done], ['Contradicted', contra]].map(([l, n]) =>
      h('div', { className: 'stat' }, h('b', { textContent: n }), h('span', { textContent: l }))));

  $('#tabs').replaceChildren(
    ...['all', 'risk', 'open', 'done'].map((k, _, arr) => {
      const labels = { all: 'All', risk: 'At risk', open: 'Open', done: 'Verified' };
      return h('button', { className: FILTER === k ? 'on' : '', textContent: labels[k],
        onclick: () => { FILTER = k; $('#state-filter').value = k === 'done' ? 'verified' : k; render(); } });
    }));

  // Use filterLedgerItems for search + state filter
  const filterVal = $('#state-filter')?.value || 'all';
  const filtered = filterLedgerItems(ledger, { query: QUERY, filter: filterVal, now: nowMs });
  const shown = filtered.map(({ item }) => item).sort((a, b) => urgency(a) - urgency(b));

  $('#list').replaceChildren(
    ...(shown.length
      ? shown.map(buildCard)
      : [T('empty', ledger.length
          ? 'Nothing in this view.'
          : 'No commitments yet. Enable a site below, then confirm a detected promise, or select text on any page and right-click \u2192 Track as promise.')]));

  const rel = reliability(ledger);
  $('#scores').replaceChildren(
    ...(rel.length
      ? rel.map(r => h('div', { className: 'score' },
          T('nm', r.co),
          h('div', { className: 'bar' }, Object.assign(h('i'), { style: `width:${r.pct ?? 0}%` })),
          T('pc', r.pct === null ? 'n/a' : r.pct + '%'),
          T('', `${r.kept}/${r.total}` + (r.slips ? ` · ${r.slips} slip${r.slips > 1 ? 's' : ''}` : ''))))
      : [T('empty', 'Scores appear once promises are tracked.')]));

  renderSites();
}

/* ───────────── Site management ───────────── */
async function renderSites() {
  let sites = [];
  try { sites = await chrome.runtime.sendMessage({ action: 'getSites' }); } catch {}
  const list = $('#sites-list');
  if (!sites || !sites.length) {
    list.textContent = 'No sites enabled yet.';
    return;
  }
  list.replaceChildren(...sites.map(s => {
    const row = h('div', { className: 'site-row' });
    row.append(h('span', { textContent: s }));
    row.append(h('button', {
      textContent: 'Remove',
      onclick: async () => {
        await chrome.runtime.sendMessage({ action: 'removeSite', hostname: s });
        renderSites();
      },
    }));
    return row;
  }));
}

/* ───────────── Download helper ───────────── */
function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

/* ───────────── Event listeners ───────────── */
// Search
$('#q').oninput = e => { QUERY = e.target.value; render(); };

// State filter dropdown
$('#state-filter').onchange = e => {
  const val = e.target.value;
  FILTER = val === 'verified' ? 'done' : val;
  render();
};

// Keep popup in sync if background updates ledger or skew
try {
  chrome.storage.onChanged.addListener(changes => {
    if (changes.ledger || changes.skew) {
      render();
    }
  });
} catch {}

// Tabs sync state filter
// (tabs update state-filter value above in onclick)

$('#exp-html').onclick = () => {
  const url = chrome.runtime.getURL('report.html');
  if (chrome.tabs?.create) chrome.tabs.create({ url });
  else window.open(url, '_blank');
};

$('#exp-md').onclick = async () => {
  const { ledger } = await load();
  let md = `# AFTERMATH LIVE: Evidence Report\nGenerated ${new Date().toLocaleString()}\n\n`;
  const by = {}; ledger.forEach(c => (by[c.company] ||= []).push(c));
  for (const [co, cs] of Object.entries(by)) {
    md += `## ${co}\n`;
    cs.forEach(c => {
      md += `### ${c.promise}\n- Status: **${c.state}**${isOverdue(c) ? ' (OVERDUE)' : ''}${c.observedOk === false ? ' (CONTRADICTION)' : ''}${c.revisions ? ` (REVISED ${c.revisions}x)` : ''}\n`;
      md += `- Deadline: ${c.deadline || 'none'}${c.originalDeadline ? ` (originally ${c.originalDeadline})` : ''}\n`;
      md += `- Conditions: ${c.conditions || 'none'}${c.condMet ? ' (marked met by user)' : ''}\n`;
      md += `- Original message: "${c.evidence}"\n- Evidence hash (SHA-256): ${c.hash || 'n/a'}\n- Source: ${c.source || 'n/a'}\n- Timeline:\n`;
      (c.timeline || []).forEach(t => { md += `  - ${new Date(t.ts).toLocaleString()} ${t.status}: ${t.note}\n`; });
      if ((c.transcript || []).length) {
        md += '- Chat context:\n';
        c.transcript.forEach(t => { md += `  > ${t.who}: ${t.text}\n`; });
      }
      md += '\n';
    });
  }
  download('aftermath-report-v3.md', md, 'text/markdown');
};

$('#exp-json').onclick = async () => {
  const { ledger } = await load();
  download('ledger.json', JSON.stringify(ledger, null, 2), 'application/json');
};

$('#save').onclick = async () => {
  await chrome.storage.local.set({ apiKey: $('#key').value.trim() });
  $('#save').textContent = 'Saved';
};

$('#notif').onchange = e => chrome.storage.local.set({ notifyOn: e.target.checked });

$('#allsites').onclick = async () => {
  try {
    if (!(await chrome.permissions.request({ origins: ['<all_urls>'] }))) return;
    try { await chrome.scripting.unregisterContentScripts({ ids: ['aml-all'] }); } catch {}
    await chrome.scripting.registerContentScripts([{
      id: 'aml-all',
      matches: ['<all_urls>'],
      js: ['shared/matching.js', 'adapters.js', 'content-v3.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]);
    $('#allsites').textContent = 'Enabled on all sites (reload tabs)';
  } catch (e) {
    $('#allsites').textContent = 'Failed: ' + e.message;
  }
};

$('#m-add').onclick = async () => {
  const co = $('#m-co').value.trim(), pr = $('#m-pr').value.trim();
  if (!co || !pr) return;
  const { ledger } = await load();
  const ts = Date.now() + skewMs;
  ledger.push({
    id: 'c' + ts, company: co, promise: pr, deadline: $('#m-dl').value || null,
    conditions: null, evidence: pr, transcript: [],
    state: 'PROMISED', status: 'PROMISED', observedOk: null, condMet: null,
    created: ts, timeline: [{ status: 'PROMISED', ts, note: 'Added manually' }],
  });
  ['#m-co', '#m-pr', '#m-dl'].forEach(s => $(s).value = '');
  await saveLedger(ledger);
};

// Warp: advance simulated clock by +6 days (does NOT mutate deadlines)
$('#warp').onclick = async () => {
  const { skew = 0 } = await chrome.storage.local.get('skew');
  const newSkew = Number(skew) + 6 * DAY;
  await chrome.storage.local.set({ skew: newSkew, sentNotifs: {} });
  skewMs = newSkew;
  await render();
};

let armed = false;
$('#clear').onclick = async () => {
  if (!armed) { armed = true; $('#clear').textContent = 'Click again to confirm'; return; }
  armed = false; $('#clear').textContent = 'Clear';
  await chrome.storage.local.set({ skew: 0, sentNotifs: {} });
  skewMs = 0;
  await saveLedger([]);
};

// Site management buttons
$('#site-add-btn').onclick = async () => {
  const val = $('#site-add-input').value.trim();
  if (!val) return;
  await chrome.runtime.sendMessage({ action: 'addSite', hostname: val });
  $('#site-add-input').value = '';
  renderSites();
};

$('#site-localhost').onclick = async () => {
  await chrome.runtime.sendMessage({ action: 'addSite', hostname: 'localhost' });
  await chrome.runtime.sendMessage({ action: 'addSite', hostname: '127.0.0.1' });
  renderSites();
};

// Load settings on open
(async () => {
  const { apiKey = '', notifyOn = true } = await chrome.storage.local.get(['apiKey', 'notifyOn']);
  $('#key').value = apiKey;
  $('#notif').checked = notifyOn;
})();

render();
