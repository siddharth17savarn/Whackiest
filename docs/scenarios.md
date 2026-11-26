# ShopKart Demo — Six Scenarios (Stage 0)

Owner: **Vishal**
Feeds: `demo/demo_shopkart_chat.html` (Day 2), `datasets/labelled_50.json` (Day 2), and extraction/deadline tests.

Each scenario exercises a specific promise-tracking capability in AFTERMATH LIVE.

---

## Scenario 1: Refund Promise (Business-Day Math)

- **Goal:** Demonstrate accurate business-day deadline calculation (skipping Sat/Sun) rather than naive calendar-day approximation.
- **Scripted Agent Messages:**
  1. `"Hi, I'm Priya from ShopKart Support. I'm sorry about the damaged item — let me check your order."` *(greeting, no promise)*
  2. `"Your refund of ₹2,499 will be processed within 5 business days."` *(PROMISED, `biz_days`, confidence `0.90`)*
- **Expected Behaviour:**
  - `parseDeadline` adds 5 business days (skipping weekends) relative to `AftermathClock.now()`, setting due time to `18:00` on the 5th business day.
  - Fast-forwarding the simulated clock past the 5th business day flips the ledger card to `OVERDUE`.

---

## Scenario 2: Delivery Date (Range / Day-of-Week)

- **Goal:** Demonstrate parsing of delivery promises with day-of-week or numeric ranges.
- **Scripted Agent Messages:**
  1. `"Thanks for reaching out about order #SK-9042."`
  2. `"Your replacement shipment will arrive within 3-5 business days, or by Friday at the latest."` *(PROMISED, `biz_range`, confidence `0.80`)*
- **Expected Behaviour:**
  - Upper bound (`5` business days) is used conservatively for `"3-5 business days"`.
  - No PII leaks if order/phone numbers appear in the chat.

---

## Scenario 3: Vague "Shortly" Promise (Low Confidence)

- **Goal:** Show how AFTERMATH LIVE handles non-committal, vague language by assigning a low confidence score and surfacing it for user confirmation/editing.
- **Scripted Agent Messages:**
  1. `"We are experiencing high volume right now."`
  2. `"Our escalations team will look into your ticket and get back to you shortly."` *(PROMISED, `vague_shortly`, confidence `0.40`)*
- **Expected Behaviour:**
  - `confidence` is `0.40` (below high-confidence threshold), prompting the user in the editable toast to set a concrete deadline if desired.

---

## Scenario 4: Conditional Promise

- **Goal:** Capture conditions attached to a promise so the company cannot later claim the promise didn't apply without context.
- **Scripted Agent Messages:**
  1. `"I can approve a full replacement for your headphones."`
  2. `"Your refund will be issued within 3 business days, provided the return package is scanned by the courier."` *(PROMISED, `biz_days`, condition extracted)*
- **Expected Behaviour:**
  - `condition` = `"provided the return package is scanned by the courier"`.
  - Displayed on the toast and ledger card, and preserved in the dispute report.

---

## Scenario 5: Company Changes Its Deadline (Moved Goalpost)

- **Goal:** Track when a company attempts to push back an existing commitment without fulfilling the original one.
- **Scripted Agent Messages:**
  1. `"We have escalated your complaint, and you will receive an update by tomorrow."` *(PROMISED #1, `tomorrow`, confidence `0.90`)*
  2. `"Apologies for the delay — due to a system upgrade, your update will now arrive within 4 business days instead."` *(PROMISED #2, `biz_days`, confidence `0.90`)*
- **Expected Behaviour:**
  - Both promises are logged with timestamps from `AftermathClock.now()` so the timeline clearly shows the original deadline was missed and extended.

---

## Scenario 6: Claim Versus Reality (Contradiction)

- **Goal:** Demonstrate the core AFTERMATH LIVE loop: `PROMISED → CLAIMED → OBSERVED (It didn't) → CONTRADICTION`.
- **Scripted Agent Messages:**
  1. `"Your refund of ₹2,499 will be processed within 5 business days."` *(PROMISED)*
  2. `"We have also escalated your delivery issue and will update you by tomorrow."` *(PROMISED #2 — tests claim-matching fix)*
  3. `"Good news: your refund has been processed on our side. Anything else I can help with?"` *(CLAIMED — must attach to Promise #1, not #2)*
- **Expected Behaviour:**
  - Claim attaches to the refund promise (Promise #1), not the escalation (Promise #2).
  - User checks the **My Bank / Order Status** page (Day 3) showing no refund arrived, clicks **"It didn't"** in the ledger → state becomes `CONTRADICTION`, ready for dispute report export.
