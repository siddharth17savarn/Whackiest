# Siddharth Integration Handoff — `bg/sync.js`

Owner of `amx_bg.js` and `manifest.json`: **Siddharth**
Owner of `bg/sync.js`, `/sync`, and `/inbox`: **Devashish**

> [!NOTE]
> `bg/sync.js` is implemented and unit-tested against live FastAPI `/sync` + `/inbox` and mocked `chrome.storage.local`. Full Chrome extension runtime integration remains **pending** until Siddharth wires `bg/sync.js` into `amx_bg.js` and `manifest.json`.

---

## 1. `manifest.json` Permissions (Siddharth)

Add `http://127.0.0.1:8000/*` (or `"http://localhost:8000/*"`) to `host_permissions` if not already covered by opt-in permissions:

```json
"host_permissions": [
  "http://127.0.0.1:8000/*"
]
```

*(Note: `storage` and `alarms` are already in `permissions`.)*

---

## 2. Import Mechanism in `amx_bg.js` (MV3 Service Worker)

At the top of `amx_bg.js` (classic service worker):

```js
importScripts('bg/sync.js');
```

This exposes `AftermathSync` globally (`AftermathSync.syncCycle`, `AftermathSync.pullInbox`, `AftermathSync.pushLedger`).

---

## 3. Invocation Lifecycle & Sync Scheduling

1. **On alarm (`chrome.alarms.onAlarm`)** — runs every minute alongside `badge()`:
   ```js
   chrome.alarms.onAlarm.addListener(() => {
     badge();
     AftermathSync.syncCycle();
   });
   ```
2. **On ledger change (`chrome.storage.onChanged`)** — syncs confirmed promises and user edits immediately (skipping if only `skew` or nothing changed, or debounced):
   ```js
   chrome.storage.onChanged.addListener((changes, area) => {
     badge();
     if (area === 'local' && (changes.items || changes.skew)) {
       AftermathSync.syncCycle();
     }
   });
   ```
3. **Offline safety:** `AftermathSync.syncCycle()` catches network errors internally and returns `{ ok: false, error }` without throwing or corrupting `chrome.storage.local`.
4. **Write-back order:** `syncCycle()` runs `pullInbox()` *before* `pushLedger()` so observations added in Claude Desktop (`~/.aftermath/inbox.json`) are merged into `chrome.storage.local.items` before pushing.
