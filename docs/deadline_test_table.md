# 30-Phrase Deadline Parsing Test Table

Reference timestamp (`now_ms`): **`2026-11-26 10:00:00`** (Thursday, local time).
All 30 cases are executed against both [shared/deadline_parser.js](file:///c:/Users/Harshit/Projects/Whackiest/shared/deadline_parser.js) and [shared/deadline_parser.py](file:///c:/Users/Harshit/Projects/Whackiest/shared/deadline_parser.py) via `tests/test_deadline_30_phrases.js` and `tests/test_deadline_30_phrases.py`.

| # | Original Phrase | Reference Date | Expected Deadline | Method | Confidence | Ambiguous? |
|---|-----------------|----------------|-------------------|--------|------------|------------|
| 1 | Your refund will be processed within 3-5 business days. | 2026-11-26 10:00 | 2026-12-03 18:00:00 | `biz_range` | 0.80 | No |
| 2 | Expect a response in 2 to 4 working days. | 2026-11-26 10:00 | 2026-12-02 18:00:00 | `biz_range` | 0.80 | No |
| 3 | Bank reversal takes 3-5 business days. | 2026-11-26 10:00 | 2026-12-03 18:00:00 | `biz_range` | 0.80 | No |
| 4 | We will verify within 1-2 working days. | 2026-11-26 10:00 | 2026-11-30 18:00:00 | `biz_range` | 0.80 | No |
| 5 | Your refund will be processed within 5 business days. | 2026-11-26 10:00 | 2026-12-03 18:00:00 | `biz_days` | 0.90 | No |
| 6 | We will issue store credit in 3 working days. | 2026-11-26 10:00 | 2026-12-01 18:00:00 | `biz_days` | 0.90 | No |
| 7 | International refunds take 10 business days. | 2026-11-26 10:00 | 2026-12-10 18:00:00 | `biz_days` | 0.85 | No |
| 8 | You will receive confirmation within 1 business day. | 2026-11-26 10:00 | 2026-11-27 18:00:00 | `biz_days` | 0.90 | No |
| 9 | Delivery will arrive within 3-5 days. | 2026-11-26 10:00 | 2026-12-01 23:59:59 | `cal_range` | 0.80 | No |
| 10 | Replacement ships in 2 to 4 calendar days. | 2026-11-26 10:00 | 2026-11-30 23:59:59 | `cal_range` | 0.80 | No |
| 11 | Standard shipping takes 5-7 days. | 2026-11-26 10:00 | 2026-12-03 23:59:59 | `cal_range` | 0.75 | No |
| 12 | Your order will arrive within 3 days. | 2026-11-26 10:00 | 2026-11-29 23:59:59 | `cal_days` | 0.90 | No |
| 13 | We will follow up in 7 calendar days. | 2026-11-26 10:00 | 2026-12-03 23:59:59 | `cal_days` | 0.90 | No |
| 14 | A specialist will call you within 24 hours. | 2026-11-26 10:00 | 2026-11-27 10:00:00 | `hours` | 0.90 | No |
| 15 | Tracking link will activate in 48 hours. | 2026-11-26 10:00 | 2026-11-28 10:00:00 | `hours` | 0.90 | No |
| 16 | We will send the invoice within 2 hours. | 2026-11-26 10:00 | 2026-11-26 12:00:00 | `hours` | 0.90 | No |
| 17 | You will receive an update by tomorrow. | 2026-11-26 10:00 | 2026-11-27 18:00:00 | `tomorrow` | 0.90 | No |
| 18 | We will process this by today. | 2026-11-26 10:00 | 2026-11-26 23:59:59 | `today` | 0.85 | No |
| 19 | Your ticket will be closed by end of day. | 2026-11-26 10:00 | 2026-11-26 23:59:59 | `today` | 0.85 | No |
| 20 | Your case will be reviewed by Monday. | 2026-11-26 10:00 | 2026-11-30 18:00:00 | `by_day` | 0.85 | No |
| 21 | Courier pickup is scheduled by Friday. | 2026-11-26 10:00 | 2026-11-27 18:00:00 | `by_day` | 0.85 | No |
| 22 | Refund will clear by next Wednesday. | 2026-11-26 10:00 | 2026-12-02 18:00:00 | `by_day` | 0.85 | No |
| 23 | Your replacement will arrive within 1 week. | 2026-11-26 10:00 | 2026-12-03 23:59:59 | `weeks` | 0.85 | No |
| 24 | Final audit completes in 2 weeks. | 2026-11-26 10:00 | 2026-12-10 23:59:59 | `weeks` | 0.85 | No |
| 25 | Your refund will be settled by 2026-12-03. | 2026-11-26 10:00 | 2026-12-03 18:00:00 | `explicit_date` | 0.92 | No |
| 26 | Delivery is guaranteed by Dec 5. | 2026-11-26 10:00 | 2026-12-05 18:00:00 | `explicit_date` | 0.90 | No |
| 27 | Replacement arrives on 15 December 2026. | 2026-11-26 10:00 | 2026-12-15 18:00:00 | `explicit_date` | 0.90 | No |
| 28 | Our team will get back to you shortly. | 2026-11-26 10:00 | 2026-11-28 10:00:00 | `vague_shortly` | 0.40 | **Yes** |
| 29 | We will update you within a few days. | 2026-11-26 10:00 | 2026-11-29 10:00:00 | `vague_few_days` | 0.40 | **Yes** |
| 30 | We will fix your order ASAP. | 2026-11-26 10:00 | 2026-11-27 10:00:00 | `vague_asap` | 0.35 | **Yes** |
