# AFTERMATH LIVE — 3-Minute Demo Script

**Team NULL-MATRIX | Hackathon Demo | v0.3.1**

---

## Setup Checklist (Before demo — 2 min)

- [ ] Chrome loaded with extension from `aftermath-live-final/extension/`
- [ ] `localhost` and `127.0.0.1` added to allowed sites (click popup → "Enable localhost (Demo)")
- [ ] Demo page served: `python -m http.server 8080` → open `http://localhost:8080/demo/index-v3.html`
- [ ] Ledger cleared (popup → Clear → Click again to confirm)

---

## Script

### **[0:00 – 0:30] Hook**

> "Every time a company promises something — 'Your refund will come in 3 days', 'We'll ship by Friday' — you have no way to hold them accountable. AFTERMATH LIVE changes that."

*Show: Extension icon in Chrome toolbar. Click it. Show empty ledger.*

---

### **[0:30 – 1:15] Step 1: Promise Detection**

> "Let's say I'm in a support chat with ShopKart. The agent just made a commitment."

*Click **Step 1: Agent Promise** on the demo page.*

> "AFTERMATH LIVE instantly detects the promise in real time. It shows me the extracted commitment, deadline, and conditions — all editable."

*Show the promise toast. Edit the promise text if needed. Click **Track it**.*

> "It's now in my ledger with state: PROMISED. Notice the SHA-256 evidence hash — tamper-proof."

---

### **[1:15 – 1:40] Step 2: Deadline Slip**

> "Three days pass… but ShopKart comes back with a revised timeline."

*Click **Step 2: Deadline Revised** on the demo page.*

> "AFTERMATH detects this as a revision of the original promise — not a new one. The original deadline is preserved. It logs the slip."

*Show: popup card shows 'revised 1x', original deadline visible.*

---

### **[1:40 – 2:05] Step 3: Deadline + Demo Warp**

> "Now let's fast-forward 6 days."

*Click **Demo: +6 days** in popup.*

> "The promise is now OVERDUE. I didn't change any deadlines — AFTERMATH uses a simulated clock, so the original evidence is intact."

*Show: card turns red, state = OVERDUE.*

---

### **[2:05 – 2:30] Step 4: Company Claims Done (Contradiction)**

> "Now ShopKart says 'your refund is processed'. But I haven't received anything."

*Click **Step 4: Claim** on the demo page. Toast appears.*
*Click **Record claim**. Card state → CLAIMED.*
*In popup, click **Not received** → type "No SMS, no bank credit" → submit.*

> "State: CONTRADICTION. AFTERMATH generated an escalation draft I can copy and send directly."

*Click **Draft escalation**. Show the auto-generated email.*

---

### **[2:30 – 2:50] Step 5: Reliability Score + Report**

> "After multiple interactions, AFTERMATH scores company reliability."

*Show: Company reliability section with bar chart.*

> "And I can export a full evidence report — with timelines, hashes, chat context — as Markdown or JSON."

*Click **Export report**. Show the downloaded .md file briefly.*

---

### **[2:50 – 3:00] Close**

> "AFTERMATH LIVE: automatic detection, six-state evidence tracking, contradiction alerts, and an exportable tamper-evident ledger. Every promise leaves a trace."

---

## Fallback Steps

| If... | Do this |
|-------|---------|
| Toast doesn't appear | Check allowed sites, reload demo tab |
| Extension error | Check `chrome://extensions/` for errors |
| Gemini API not configured | Offline regex still works (shows "Offline" source label) |
| Demo warp shows wrong state | Click Clear, re-add promise, then warp |
