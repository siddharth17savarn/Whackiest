/**
 * shared/report_html.js — AFTERMATH LIVE v0.3.1
 * Generates a self-contained, print-friendly HTML dispute report from live ledger items.
 */
import { normalizeRecord } from './schema.js';

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDisputeReportHtml(
  rawLedger,
  { nowMs = Date.now(), filter = 'all', title = 'AFTERMATH LIVE — Dispute & Evidence Report' } = {}
) {
  const items = (rawLedger || []).map(r => normalizeRecord(r, nowMs));
  const filtered =
    filter === 'broken'
      ? items.filter(c => c.state !== 'VERIFIED' && (c.state === 'CONTRADICTION' || c.state === 'OVERDUE' || c.observedOk === false))
      : items;

  const stats = {
    total: items.length,
    overdue: items.filter(c => c.state === 'OVERDUE').length,
    contradictions: items.filter(c => c.state === 'CONTRADICTION' || c.observedOk === false).length,
    verified: items.filter(c => c.state === 'VERIFIED').length,
  };

  const fmtTs = ts => (ts ? new Date(ts).toLocaleString() : 'n/a');

  const cardsHtml = filtered.length
    ? filtered
        .map(c => {
          const isContra = c.state === 'CONTRADICTION' || c.observedOk === false;
          const isOverdue = c.state === 'OVERDUE';
          const badgeClass = isContra || isOverdue ? 'badge-red' : c.state === 'VERIFIED' ? 'badge-green' : 'badge-blue';
          const claimText = c.claimEvidence
            ? `${escapeHtml(c.claimEvidence)} (${fmtTs(c.claimedAt)})`
            : c.claimedAt
              ? `Marked claimed at ${fmtTs(c.claimedAt)}`
              : 'None recorded';
          const obsText =
            c.observedOk === true
              ? `Fulfilled / Received${c.observedNote ? ' — ' + escapeHtml(c.observedNote) : ''}`
              : c.observedOk === false
                ? `NOT received${c.observedNote ? ' — ' + escapeHtml(c.observedNote) : ''}`
                : 'No user observation yet';
          const origDl = c.originalDeadline || c.deadline || 'None';
          const currDl = c.deadline || 'None';
          const dlSummary =
            c.revisions && c.originalDeadline && c.originalDeadline !== c.deadline
              ? `${escapeHtml(origDl)} (revised ${c.revisions}x → now ${escapeHtml(currDl)})`
              : escapeHtml(currDl);

          const tlHtml = (c.timeline || [])
            .map(t => `<li><span class="ts">${escapeHtml(fmtTs(t.ts))}</span> <strong>${escapeHtml(t.status)}</strong>: ${escapeHtml(t.note)}</li>`)
            .join('');

          return `<article class="dispute-card">
  <div class="card-head">
    <div>
      <div class="company">${escapeHtml(c.company)}</div>
      <h2>${escapeHtml(c.promise)}</h2>
    </div>
    <span class="badge ${badgeClass}">${escapeHtml(c.state)}</span>
  </div>
  <dl class="meta-grid">
    <div><dt>Original / Current Deadline</dt><dd>${dlSummary}</dd></div>
    <div><dt>Conditions</dt><dd>${escapeHtml(c.conditions || 'None')}${c.condMet ? ' (Marked met)' : ''}</dd></div>
    <div><dt>Completion Claim</dt><dd>${claimText}</dd></div>
    <div><dt>User Observation</dt><dd>${obsText}</dd></div>
    <div><dt>Contradiction Status</dt><dd>${isContra ? '<strong class="txt-red">CONTRADICTION DETECTED</strong>' : 'No contradiction'}</dd></div>
    <div><dt>Source &amp; Evidence Hash</dt><dd>${escapeHtml(c.source || 'Manual / Local')}<br><code>SHA-256: ${escapeHtml((c.hash || 'n/a').slice(0, 24))}</code></dd></div>
  </dl>
  <div class="quote">Original agent statement: "${escapeHtml(c.evidence || c.promise)}"</div>
  <div class="timeline">
    <h3>Audit Timeline</h3>
    <ul>${tlHtml || '<li>No timeline events recorded.</li>'}</ul>
  </div>
</article>`;
        })
        .join('\n')
    : '<p class="empty">No matching commitments in the ledger for this view.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font:14px/1.5 system-ui,-apple-system,sans-serif;color:#1f2937;background:#f9fafb;margin:0;padding:24px}
  .container{max-width:860px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
  header{border-bottom:2px solid #1a73e8;padding-bottom:16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
  h1{margin:0;font-size:22px;color:#111827}
  .sub{font-size:12px;color:#6b7280;margin-top:4px}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}
  .stat{background:#f3f4f6;border-radius:8px;padding:10px;text-align:center}
  .stat b{display:block;font-size:20px;color:#111827}.stat span{font-size:11px;color:#4b5563;text-transform:uppercase}
  .dispute-card{border:1px solid #d1d5db;border-radius:10px;padding:18px;margin-bottom:18px;break-inside:avoid}
  .card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid #e5e7eb;padding-bottom:10px;margin-bottom:12px}
  .company{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280}
  .card-head h2{margin:4px 0 0;font-size:16px;color:#111827}
  .badge{font-size:11px;font-weight:700;padding:4px 10px;border-radius:99px;white-space:nowrap}
  .badge-red{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
  .badge-green{background:#dcfce7;color:#166534;border:1px solid #86efac}
  .badge-blue{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin:0 0 12px}
  .meta-grid dt{font-size:11px;text-transform:uppercase;color:#6b7280;font-weight:600}
  .meta-grid dd{margin:2px 0 0;font-size:13px;word-break:break-word}
  .txt-red{color:#b91c1c}
  .quote{background:#f9fafb;border-left:3px solid #9ca3af;padding:8px 12px;font-style:italic;color:#374151;margin-bottom:12px}
  .timeline h3{margin:0 0 6px;font-size:12px;text-transform:uppercase;color:#4b5563}
  .timeline ul{margin:0;padding-left:18px;font-size:12px}
  .timeline li{margin-bottom:4px}
  .ts{color:#6b7280}
  code{font-size:11px;color:#4b5563}
  .empty{text-align:center;color:#6b7280;padding:24px}
  @media print{
    body{background:#fff;padding:0}
    .container{box-shadow:none;padding:0;max-width:none}
    .no-print{display:none!important}
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="sub">Generated ${escapeHtml(fmtTs(nowMs))} &middot; Team NULL-MATRIX</div>
    </div>
    <div class="sub">Every promise leaves a trace.</div>
  </header>
  <section class="summary">
    <div class="stat"><b>${stats.total}</b><span>Tracked</span></div>
    <div class="stat"><b>${stats.overdue}</b><span>Overdue</span></div>
    <div class="stat"><b>${stats.contradictions}</b><span>Contradictions</span></div>
    <div class="stat"><b>${stats.verified}</b><span>Verified</span></div>
  </section>
  ${cardsHtml}
</div>
</body>
</html>`;
}
