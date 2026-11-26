import { STATES, canTransition, transitionItem } from '../shared/state.js';

export const HOUR_MS = 3600000;
export const DUE_WINDOW_MS = 120000;

export async function nowMs(storage = chrome.storage.local) {
  const { skew = 0 } = await storage.get('skew');
  return Date.now() + skew;
}

function getDueMs(item) {
  if (item.due != null) return item.due;
  if (item.deadline) return new Date(item.deadline + 'T23:59:59').getTime();
  return null;
}

export async function updateBadge({ storage = chrome.storage.local, action = chrome.action, now } = {}) {
  const { ledger = [] } = await storage.get('ledger');
  const currentNow = now ?? (await nowMs(storage));
  const overdue = ledger.filter(c => {
    const st = c.state || c.status;
    if (c.verified || st === STATES.VERIFIED) return false;
    const due = getDueMs(c);
    return Boolean(due && due < currentNow);
  }).length;
  await action.setBadgeText({ text: overdue ? String(overdue) : '' });
  await action.setBadgeBackgroundColor({ color: '#d93025' });
  return overdue;
}

export async function checkNotifications({
  storage = chrome.storage.local,
  notifications = chrome.notifications,
  now,
} = {}) {
  const { ledger = [], sentNotifs = {}, notifyOn = true } = await storage.get([
    'ledger',
    'sentNotifs',
    'notifyOn',
  ]);
  const currentNow = now ?? (await nowMs(storage));
  let notifsDirty = false;
  let ledgerDirty = false;
  const fired = [];

  for (const item of ledger) {
    const curState = item.state || item.status || STATES.PROMISED;
    if (item.verified || curState === STATES.VERIFIED) continue;
    const due = getDueMs(item);
    if (!due) continue;

    const diff = due - currentNow;
    let type = null;
    let title = null;
    let message = null;

    if (diff <= -24 * HOUR_MS) {
      type = 'overdue';
      title = `Promise missed: ${item.company}`;
      message = `❌ ${item.promise} (24+ hours overdue)`;
    } else if (diff <= 0 && diff > -DUE_WINDOW_MS) {
      type = 'due';
      title = `Promise due NOW: ${item.company}`;
      message = `🔴 ${item.promise}`;
    } else if (diff > 0 && diff <= 24 * HOUR_MS) {
      type = 'warning';
      title = `Due within 24h: ${item.company}`;
      message = `⚠️ ${item.promise}`;
    }

    if (type && notifyOn) {
      const key = `${item.id}-${type}`;
      if (!sentNotifs[key]) {
        const iconUrl =
          typeof chrome !== 'undefined' && chrome.runtime?.getURL
            ? chrome.runtime.getURL('icon-v3.png')
            : 'icon-v3.png';
        notifications.create(key, {
          type: 'basic',
          iconUrl,
          title,
          message,
        });
        sentNotifs[key] = true;
        notifsDirty = true;
        fired.push({ key, type, itemId: item.id, title, message });
      }
    }

    if (diff <= 0 && (curState === STATES.PROMISED || curState === STATES.CLAIMED) && canTransition(curState, STATES.OVERDUE)) {
      transitionItem(item, STATES.OVERDUE);
      ledgerDirty = true;
    }
  }

  const updates = {};
  if (notifsDirty) updates.sentNotifs = sentNotifs;
  if (ledgerDirty) updates.ledger = ledger;
  if (notifsDirty || ledgerDirty) await storage.set(updates);
  return { fired, ledgerDirty };
}

export function registerAlarmSchedule() {
  chrome.alarms.create('check', { periodInMinutes: 1 });
}
