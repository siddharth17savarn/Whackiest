import { buildDisputeReportHtml } from './shared/report_html.js';

const frame = document.getElementById('report-frame');
const filterEl = document.getElementById('filter');
let latestHtml = '';

async function renderReport() {
  const { ledger = [], skew = 0 } = await chrome.storage.local.get(['ledger', 'skew']);
  const nowMs = Date.now() + (Number(skew) || 0);
  latestHtml = buildDisputeReportHtml(ledger, { nowMs, filter: filterEl.value });
  const doc = new DOMParser().parseFromString(latestHtml, 'text/html');
  const style = doc.querySelector('style');
  const container = doc.querySelector('.container');
  frame.replaceChildren();
  if (style) frame.append(style.cloneNode(true));
  if (container) frame.append(container.cloneNode(true));
}

filterEl.onchange = renderReport;

document.getElementById('print-pdf').onclick = () => window.print();

document.getElementById('dl-html').onclick = () => {
  const blob = new Blob([latestHtml], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'aftermath-dispute-report.html';
  document.body.append(a);
  a.click();
  a.remove();
};

renderReport();
