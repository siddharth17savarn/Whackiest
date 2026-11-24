const nowMs=async()=>Date.now()+((await chrome.storage.local.get('skew')).skew||0);
async function badge(){const {items=[]}=await chrome.storage.local.get('items');const n=await nowMs();
const c=items.filter(i=>!i.verified&&i.due&&i.due<n).length;
chrome.action.setBadgeText({text:c?String(c):''});chrome.action.setBadgeBackgroundColor({color:'#d33'});}
chrome.runtime.onInstalled.addListener(()=>chrome.alarms.create('amx',{periodInMinutes:1}));
chrome.alarms.onAlarm.addListener(badge);
chrome.storage.onChanged.addListener(badge);
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:chrome.runtime.getURL('amx_ledger.html')}));
