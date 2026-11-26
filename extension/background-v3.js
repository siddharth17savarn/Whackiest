import { nowMs, updateBadge, checkNotifications, registerAlarmSchedule } from './bg/alarms.js';
import { extractPromise } from './bg/llm.js';
import {
  isSiteAllowed,
  addAllowedSite,
  removeAllowedSite,
  getAllowedSites,
  syncLedgerToBridge,
} from './bg/sync.js';
import { normalizeRecord } from './shared/schema.js';

const sha = async t => {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({
      id: 'track',
      title: 'Track as promise (AFTERMATH LIVE)',
      contexts: ['selection'],
    })
  );
  registerAlarmSchedule();
  updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
  await checkNotifications();
});

chrome.alarms.onAlarm.addListener(async () => {
  await updateBadge();
  await checkNotifications();
});

chrome.storage.onChanged.addListener(async changes => {
  await updateBadge();
  await checkNotifications();
  if (changes.ledger) {
    await syncLedgerToBridge();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'track') return;
  const text = (info.selectionText || '').trim();
  if (!text) return;
  const simNow = await nowMs();
  const { data } = await extractPromise(text, [], { now: simNow });
  let host = 'Unknown';
  try {
    host = new URL(tab.url).hostname.replace(/^www\./, '');
  } catch {}
  const { ledger = [] } = await chrome.storage.local.get('ledger');
  ledger.push(
    normalizeRecord(
      {
        id: 'c' + simNow,
        company: host,
        companySource: 'hostname',
        promise: data.is_promise && data.promise ? data.promise : text,
        deadline: data.deadline_iso || null,
        conditions: data.conditions || null,
        confidence: data.confidence ?? 0.7,
        evidence: text,
        source: tab.url || '',
        hash: await sha(text + simNow),
        transcript: [],
        state: 'PROMISED',
        status: 'PROMISED',
        created: simNow,
        timeline: [{ status: 'PROMISED', ts: simNow, note: 'Captured from selected text on ' + host }],
      },
      simNow
    )
  );
  await chrome.storage.local.set({ ledger });
  chrome.action.setBadgeText({ text: '+1' });
  chrome.action.setBadgeBackgroundColor({ color: '#188038' });
  setTimeout(updateBadge, 2500);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const action = msg?.action || msg?.type;
  if (!action) return false;

  if (action === 'extract') {
    (async () => {
      const simNow = await nowMs();
      const { data, source } = await extractPromise(msg.text, msg.context || [], {
        company: msg.company || null,
        chatUrl: msg.chatUrl || null,
        now: simNow,
      });
      sendResponse({ ok: true, data, source });
    })();
    return true;
  }

  if (action === 'getNow') {
    (async () => sendResponse(await nowMs()))();
    return true;
  }

  if (action === 'checkSite') {
    (async () => sendResponse(await isSiteAllowed(msg.hostname)))();
    return true;
  }

  if (action === 'addSite') {
    (async () => sendResponse(await addAllowedSite(msg.hostname)))();
    return true;
  }

  if (action === 'removeSite') {
    (async () => sendResponse(await removeAllowedSite(msg.hostname)))();
    return true;
  }

  if (action === 'getSites') {
    (async () => sendResponse(await getAllowedSites()))();
    return true;
  }

  if (action === 'syncNow') {
    (async () => sendResponse(await syncLedgerToBridge()))();
    return true;
  }

  return false;
});
