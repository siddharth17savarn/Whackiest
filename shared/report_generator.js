/**
 * shared/report_generator.js — Shared printable dispute report generator.
 *
 * Reused by:
 *   1. mcp-server's `generate_dispute_summary` tool (Markdown & HTML)
 *   2. dispute_report.html (browser printable report page)
 *
 * Never invents missing quotes, observations, or dates.
 */
(function (root) {
  'use strict';

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    }[c]));
  }

  function fmtDate(ms) {
    if (ms == null) return 'unspecified';
    try {
      return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    } catch (_) {
      return 'unspecified';
    }
  }

  function resolveState(item, nowMs) {
    if (item.verified) return 'VERIFIED';
    if (item.claimed && item.observed && item.observed.ok === false) return 'CONTRADICTION';
    if (item.due != null && item.due < nowMs) return 'OVERDUE';
    if (item.observed) return 'OBSERVED';
    if (item.claimed) return 'CLAIMED';
    return item.state || 'PROMISED';
  }

  function normalizeCase(item, nowMs) {
    const refNow = typeof nowMs === 'number' ? nowMs : Date.now();
    const state = resolveState(item, refNow);
    const isOverdue = !item.verified && item.due != null && item.due < refNow;
    const timeline = [];

    timeline.push({
      event: 'PROMISED',
      timestamp_ms: item.created || null,
      timestamp_str: fmtDate(item.created),
      detail: item.promise || '',
    });

    if (item.claimed) {
      timeline.push({
        event: 'CLAIMED',
        timestamp_ms: item.claimed.at || null,
        timestamp_str: fmtDate(item.claimed.at),
        detail: item.claimed.text || '',
      });
    }

    if (item.observed) {
      timeline.push({
        event: 'OBSERVED',
        timestamp_ms: item.observed.at || null,
        timestamp_str: fmtDate(item.observed.at),
        detail: item.observed.note || (item.observed.ok ? 'Outcome seen' : 'Outcome not seen'),
      });
    }

    if (isOverdue) {
      timeline.push({
        event: 'DEADLINE_PASSED',
        timestamp_ms: item.due,
        timestamp_str: fmtDate(item.due),
        detail: 'Promised deadline elapsed without verification.',
      });
    }

    if (item.verified) {
      timeline.push({
        event: 'VERIFIED',
        timestamp_ms: (item.observed && item.observed.at) || null,
        timestamp_str: fmtDate(item.observed && item.observed.at),
        detail: 'Promise verified by user.',
      });
    }

    timeline.sort((a, b) => {
      if (a.timestamp_ms == null && b.timestamp_ms == null) return 0;
      if (a.timestamp_ms == null) return 1;
      if (b.timestamp_ms == null) return -1;
      return a.timestamp_ms - b.timestamp_ms;
    });

    return {
      id: item.id,
      company: item.company || 'Unknown',
      state,
      is_overdue: isOverdue,
      promise: item.promise || '',
      original_quote: item.evidence || null,
      condition: item.condition || null,
      confidence: item.confidence != null ? item.confidence : null,
      source_url: item.chat || null,
      created_str: fmtDate(item.created),
      due_str: fmtDate(item.due),
      claimed_text: item.claimed ? item.claimed.text : null,
      claimed_at_str: item.claimed ? fmtDate(item.claimed.at) : null,
      observed_ok: item.observed ? Boolean(item.observed.ok) : null,
      observed_note: item.observed ? item.observed.note : null,
      observed_at_str: item.observed ? fmtDate(item.observed.at) : null,
      contradiction: Boolean(item.claimed && item.observed && item.observed.ok === false),
      timeline,
    };
  }

  function generateDisputeMarkdown(items, options = {}) {
    const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();
    const cases = (items || []).map((it) => normalizeCase(it, nowMs));
    if (cases.length === 0) {
      return '# AFTERMATH LIVE — Dispute Summary\n\nNo commitments found in ledger.';
    }

    const lines = [
      '# AFTERMATH LIVE — Dispute Evidence Summary',
      `Generated: ${fmtDate(nowMs)}`,
      `Total cases: ${cases.length}`,
      '',
    ];

    for (const c of cases) {
      lines.push(`## ${c.company} — ${c.state} (ID: ${c.id})`);
      lines.push(`- **Promise:** "${c.promise}"`);
      if (c.original_quote) lines.push(`- **Original Quote:** "${c.original_quote}"`);
      if (c.condition) lines.push(`- **Condition:** ${c.condition}`);
      lines.push(`- **Created:** ${c.created_str}`);
      lines.push(`- **Deadline:** ${c.due_str}${c.is_overdue ? ' *(OVERDUE)*' : ''}`);
      if (c.source_url) lines.push(`- **Source:** ${c.source_url}`);
      lines.push('');
      lines.push('### Claim vs Observation');
      lines.push(`- **Company Claimed:** ${c.claimed_text ? `"${c.claimed_text}" (${c.claimed_at_str})` : 'No claim recorded'}`);
      lines.push(`- **User Observed:** ${c.observed_note ? `${c.observed_ok ? 'Confirmed' : 'Not fulfilled'} — "${c.observed_note}" (${c.observed_at_str})` : 'No observation recorded'}`);
      if (c.contradiction) lines.push('- **Dispute Flag:** **CONTRADICTION** (company claimed completion, user observed non-fulfillment)');
      lines.push('');
      lines.push('### Timeline');
      for (const ev of c.timeline) {
        lines.push(`- \`${ev.timestamp_str}\` **${ev.event}**: ${ev.detail}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  function generatePrintableReportHtml(items, options = {}) {
    const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();
    const cases = (items || []).map((it) => normalizeCase(it, nowMs));

    const cardsHtml = cases.length === 0
      ? '<div class="card">No commitments to report.</div>'
      : cases.map((c) => `
      <section class="card ${c.state === 'CONTRADICTION' || c.is_overdue ? 'alert' : ''}">
        <div class="head">
          <div>
            <strong>${escHtml(c.company)}</strong>
            <span class="meta">ID: ${escHtml(c.id)}</span>
          </div>
          <span class="badge ${c.state === 'VERIFIED' ? 'ok' : (c.state === 'CONTRADICTION' || c.is_overdue ? 'bad' : 'warn')}">${escHtml(c.state)}</span>
        </div>
        <p class="quote">“${escHtml(c.promise)}”</p>
        ${c.original_quote && c.original_quote !== c.promise ? `<p class="meta"><b>Original chat quote:</b> “${escHtml(c.original_quote)}”</p>` : ''}
        ${c.condition ? `<p class="meta"><b>Condition:</b> ${escHtml(c.condition)}</p>` : ''}
        <p class="meta"><b>Created:</b> ${escHtml(c.created_str)} &nbsp;|&nbsp; <b>Deadline:</b> ${escHtml(c.due_str)}${c.source_url ? ` &nbsp;|&nbsp; <b>Source:</b> ${escHtml(c.source_url)}` : ''}</p>
        <div class="cvo">
          <div class="box">
            <b>COMPANY CLAIMED</b>
            <div>${c.claimed_text ? `“${escHtml(c.claimed_text)}”<br><span class="meta">${escHtml(c.claimed_at_str)}</span>` : '—'}</div>
          </div>
          <div class="box">
            <b>USER OBSERVED</b>
            <div>${c.observed_note ? `${c.observed_ok ? '✓' : '✗'} ${escHtml(c.observed_note)}<br><span class="meta">${escHtml(c.observed_at_str)}</span>` : '—'}</div>
          </div>
        </div>
        <h3>Timeline</h3>
        <ul class="timeline">
          ${c.timeline.map((ev) => `<li><code>${escHtml(ev.timestamp_str)}</code> <b>${escHtml(ev.event)}</b> — ${escHtml(ev.detail)}</li>`).join('')}
        </ul>
      </section>
    `).join('\n');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>AFTERMATH LIVE — Printable Dispute Report</title>
  <style>
    body { font: 14px/1.5 system-ui, -apple-system, sans-serif; color: #111827; background: #f6f7fb; margin: 0; padding: 24px; }
    main { max-width: 860px; margin: 0 auto; }
    .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 22px; } h1 span { color: #d97706; }
    .meta { color: #4b5563; font-size: 12px; }
    .card { background: #fff; border: 1px solid #d1d5db; border-radius: 12px; padding: 16px; margin-bottom: 16px; page-break-inside: avoid; }
    .card.alert { border-color: #dc2626; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    .badge { padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; color: #fff; }
    .badge.bad { background: #dc2626; } .badge.ok { background: #16a34a; } .badge.warn { background: #d97706; }
    .quote { font-size: 15px; font-weight: 600; margin: 10px 0 6px; }
    .cvo { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
    .box { border: 1px dashed #d1d5db; border-radius: 8px; padding: 10px; font-size: 13px; }
    .timeline { margin: 6px 0 0; padding-left: 18px; font-size: 13px; }
    button.print-btn { padding: 8px 14px; border-radius: 8px; border: 0; background: #2563eb; color: #fff; font-weight: 600; cursor: pointer; }
    @media print { body { background: #fff; padding: 0; } button.print-btn { display: none; } }
  </style>
</head>
<body>
  <main>
    <div class="top">
      <div>
        <h1>AFTERMATH <span>LIVE</span> — Dispute Evidence Report</h1>
        <div class="meta">Generated: ${escHtml(fmtDate(nowMs))} · Cases: ${cases.length}</div>
      </div>
      <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
    </div>
    ${cardsHtml}
  </main>
</body>
</html>`;
  }

  const exports = {
    normalizeCase,
    generateDisputeMarkdown,
    generatePrintableReportHtml,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.AftermathReport = exports;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
