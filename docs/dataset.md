# Labelled Dataset — 50 Synthetic Support Messages (`datasets/labelled_50.json`)

Owner: **Vishal**
Purpose: Day 2 evaluation & Day 3 confidence threshold calibration.

---

## Schema

Each record in [labelled_50.json](file:///c:/Users/Harshit/Projects/Whackiest/datasets/labelled_50.json) is synthetic (zero real PII) and contains:

| Field | Type | Description |
|-------|------|-------------|
| `message_id` | `string` | Unique ID (`MSG-01` .. `MSG-50`) |
| `scenario` | `string` | One of `refund`, `delivery`, `shortly`, `conditional`, `moved_deadline`, `claim_vs_reality`, `no_promise` |
| `company` | `string` | `ShopKart` or `SwiftPay` |
| `message` | `string` | Synthetic support agent message |
| `expected_promise` | `boolean` | `true` for forward-looking commitments; `false` for claims/greetings/questions |
| `expected_company` | `string` | Expected company attribution |
| `expected_deadline` | `string` | Expected `deadline_method` (`biz_days`, `biz_range`, `cal_days`, `cal_range`, `hours`, `tomorrow`, `today`, `by_day`, `weeks`, `explicit_date`, `vague_shortly`, `vague_asap`, `vague_few_days`, `vague_immediate`, `none`) |
| `expected_condition` | `string \| null` | Expected conditional clause, if any |
| `expected_confidence_category` | `string` | `high`, `medium`, `low`, or `none` |

---

## Distribution (50 Messages)

- **Positive promises:** 40 (`refund`: 10, `delivery`: 8, `shortly`/vague: 8, `conditional`: 8, `moved_deadline`: 6)
- **Negative / non-promises:** 10 (`claim_vs_reality` status claims: 5, `no_promise` greetings/questions: 5)
- **Companies:** `ShopKart` (33), `SwiftPay` (17)
- **Confidence categories:** `high` (31), `medium` (2), `low` (7), `none` (10)

---

## Day 3 Calibration Usage

On Day 3, a calibration script will run `POST /extract` across all 50 messages and sweep `CONFIDENCE_THRESHOLD` (e.g. `0.45` to `0.85`) to maximize precision/recall separating concrete commitments (`high`/`medium`) from vague/ambiguous ones (`low`) and non-promises (`none`).
