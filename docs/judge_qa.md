# AFTERMATH LIVE — Judge Q&A (Backend, AI Extraction & Privacy)

Owner: **Vishal**

---

## 1. What problem does Aftermath Live solve?

Customer-support chats frequently contain time-bound company promises (*"Your refund will arrive within 5 business days"*) that are buried in chat logs and forgotten once the window closes. Later, companies may claim *"your refund has been processed"* even when no money arrived. Aftermath Live captures commitments in real time, tracks deadlines against a shared clock, separates company **claims** from user-**observed** outcomes, and exports structured, PII-masked dispute evidence.

---

## 2. How does it detect company promises?

1. **In the browser (`demo_shopkart_chat.html` / extension):** Complete agent messages (`data-role="agent"`, skipping incomplete `data-streaming="true"` bubbles) are inspected.
2. **In the FastAPI backend (`POST /extract`):** Messages pass through prompt-injection sanitization and PII masking, then are analyzed either by **Gemini function calling** (`extract_customer_promise`) or the **local offline extractor** (`backend/app/fallback.py`).
3. Both paths distinguish forward-looking **promises** (`is_promise=True`), status **claims** (`is_claim=True`, `is_promise=False`), and **greetings/fillers** (`is_promise=False`).

---

## 3. How does Gemini function calling work?

`backend/app/gemini_client.py` uses the official `google-genai` SDK with a structured `FunctionDeclaration` (`extract_customer_promise`) and `FunctionCallingConfigMode.ANY`, forcing the model to return typed arguments (`is_promise`, `is_claim`, `company`, `promise`, `original_quote`, `deadline_phrase`, `deadline_hours`, `condition`, `clarity`). All returned arguments are strictly validated with Pydantic (`GeminiFunctionArgs`), and deadlines are resolved deterministically through `shared/deadline_parser.py` relative to `now_ms`.

---

## 4. What happens when Gemini is unavailable?

If `GEMINI_API_KEY` is unset, or if Gemini times out (`GEMINI_TIMEOUT_SECONDS`), hits rate limits (`429`), errors, or returns invalid arguments, `backend/app/extractor.py` catches `GeminiUnavailableError` and automatically falls back to `extract_offline()` (`backend/app/fallback.py`). The response honestly reports `extraction_method: "offline"` and `fallback_reason` (e.g., `"no_api_key"` or `"gemini_timeout_8.0s"`). No AI results are ever fabricated.

---

## 5. How do you measure extraction confidence?

`backend/app/confidence.py` assigns a calibrated score in `[0.0, 1.0]`:
- **High (`0.80–0.92`):** Explicit commitment with a concrete deadline (`within N business days`, `3-5 business days`, `by tomorrow`, `within N hours`, `by Monday`, explicit dates, weeks). Conditional clauses apply a `-0.04` adjustment.
- **Medium (`0.55–0.79`):** Clear commitment cue without a concrete deadline phrase.
- **Low (`0.35–0.50`):** Vague/qualitative phrasing (`"shortly"`, `"ASAP"`, `"within a few days"`, `"immediately"`).
- **None (`0.0`):** Greetings, fillers, or pure status claims.

Using `CONFIDENCE_THRESHOLD = 0.55` (calibrated on our 50-message synthetic dataset), concrete commitments are auto-accepted while low-confidence vague promises are **kept** (`is_promise=True`) and routed to **Manual Review** rather than being silently discarded.

---

## 6. How does PII masking protect users?

Before any text is sent to Gemini — and before dispute evidence is returned by `POST /export` — `backend/app/services/pii_masking.py` masks:
- Emails (`[EMAIL]`), phone numbers (`[PHONE]`), UPI IDs (`[UPI]`), payment cards (`[CARD]`), bank/IFSC/PAN/SSN identifiers (`[ACCOUNT]`), physical addresses (`[ADDRESS]`), and contextually cued personal names (`[PERSON]`).
- Company names, monetary amounts, order IDs, dates, and deadline phrases are preserved so extraction remains accurate.
- **Honest limitation:** Regex + contextual heuristics do **not** guarantee 100% PII detection (e.g., unformatted names without conversational cues or unusual international addresses may not be caught).

---

## 7. How do you defend against prompt injection?

`backend/app/services/prompt_guard.py` applies defense-in-depth (not just keyword matching):
1. **Structural isolation:** Untrusted chat text is wrapped in `<UNTRUSTED_SUPPORT_MESSAGE>` delimiters, with any embedded breakout/role tags neutralized.
2. **Adversarial clause sanitization:** Instruction-override, exfiltration (`"return the API key"`, `"reveal your system prompt"`), and sabotage clauses are stripped while legitimate promise sentences are preserved.
3. **Function-calling lock + Pydantic validation:** Gemini is restricted to `extract_customer_promise` and validated via `GeminiFunctionArgs`.
4. **Output leakage guard:** `contains_secret_leakage()` blocks any response echoing API keys or system-prompt fragments.
- **Honest limitation:** No prompt-injection defense is 100% immune to novel adversarial paraphrases; the structural isolation and strict schema validation provide the primary safety boundary.

---

## 8. Does the system store raw personal messages?

The FastAPI backend is **stateless** — it does not persist chat messages to a database. API logs record only a 16-char SHA-256 hash (`raw_text_hash`) and masked PII counts, never raw message text or API keys. On the client side, the Chrome extension stores confirmed ledger items locally in `chrome.storage.local` on the user's own machine. In `POST /export`, exported quotes, claims, and observation notes are PII-masked.

---

## 9. How do you distinguish a company claim from an observed outcome?

- **CLAIMED** is triggered when a support agent says a prior promise is done (e.g., *"Your refund has been processed on our side"*), marked `is_claim=True, is_promise=False`.
- **OBSERVED** requires explicit user verification against external reality (e.g., checking [demo_bank_status.html](file:///c:/Users/Harshit/Projects/Whackiest/demo_bank_status.html) showing ₹0.00 credited and clicking **"✗ It didn't"**).
- When `claimed` is present and `observed.ok === false`, the state becomes **`CONTRADICTION`**, which `/export` packages with chronological evidence.

---

## 10. How does the deadline engine handle business days?

`shared/deadline_parser.js` and `shared/deadline_parser.py` share identical logic and take `now_ms` explicitly (from `AftermathClock.now()`, which respects the simulated clock skew). `add_business_days(from_ms, n)` steps day-by-day skipping Saturdays and Sundays and targets `18:00` local time on the *n*-th business day. Ranges like `"3-5 business days"` use the conservative upper bound (`5` business days).

---

## 11. What are the current limitations?

1. **Public holidays:** Business-day arithmetic skips weekends (Sat/Sun) but does **not** currently account for regional or bank public holidays.
2. **PII detection:** Regex/heuristic masking is not 100% exhaustive on unformatted personal names or non-standard addresses.
3. **Prompt-injection protection:** Heuristic sanitization + structural isolation reduces risk significantly, but no LLM defense is 100% infallible.
4. **Synthetic calibration dataset:** Our `50`-message dataset ([datasets/labelled_50.json](file:///c:/Users/Harshit/Projects/Whackiest/datasets/labelled_50.json)) is synthetic and in-sample; `1.0` accuracy on those 50 samples does **not** represent production accuracy on unseen real-world chats.
5. **Demo reliability numbers:** The `64%` (ShopKart) and `96%` (SwiftPay) reliability badges in [demo_shopkart_chat.html](file:///c:/Users/Harshit/Projects/Whackiest/demo_shopkart_chat.html) are fictional demo values, not real measured company metrics.

---

## 12. How would you improve accuracy with real-world data?

1. Collect an anonymized, consented corpus of real multi-turn support transcripts and evaluate on a strict train/validation/test split (not in-sample).
2. Add a lightweight statistical NER model (e.g., spaCy or Presidio) alongside regexes for higher-recall PII masking.
3. Integrate regional holiday calendars (`holidays` library) into `add_business_days`.
4. Add multi-promise extraction per message in Gemini function calling (returning an array of commitments) and calibrate thresholds using temperature scaling / ROC analysis on the held-out real test set.
