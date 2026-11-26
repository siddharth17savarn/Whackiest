# Confidence Threshold Calibration Report

Owner: **Vishal**
Dataset: [datasets/labelled_50.json](file:///c:/Users/Harshit/Projects/Whackiest/datasets/labelled_50.json) (`50` synthetic messages)
Evaluator: [backend/app/services/calibration.py](file:///c:/Users/Harshit/Projects/Whackiest/backend/app/services/calibration.py)

---

## 1. Evaluation Targets & Distinctions

We evaluate **four distinct concepts** so low-confidence promises are never miscounted as true negatives or silently discarded:

1. **Promise Detection (`is_promise` vs `expected_promise`):**
   - `40` positive promises (`31` high + `2` medium + `7` low) and `10` negative non-promises (`5` status claims + `5` greetings/questions).
2. **Automatic Acceptance (`is_promise and confidence >= CONFIDENCE_THRESHOLD`):**
   - Concrete commitments (`high` / `medium`) that can be logged with high confidence.
3. **Manual Review / Abstention (`is_promise and confidence < CONFIDENCE_THRESHOLD`):**
   - Low-confidence / vague promises (e.g., `"shortly"`, `"ASAP"`, `"within a few days"`) are **kept as detected promises** (`is_promise=True`) and routed to **Manual Review** in the UI rather than being discarded as non-promises.
4. **Confidence Category (`high` / `medium` / `low` / `none`):**
   - Multi-class classification of commitment clarity.

> [!WARNING]
> **Dataset Limitations (Honest Assessment):**
> - `datasets/labelled_50.json` contains **50 synthetic messages** authored for the six ShopKart/SwiftPay scenarios.
> - Because the offline extractor is rule-based and evaluated on the same 50 synthetic messages used to design the scenarios, **these in-sample metrics must NOT be presented as independent production test performance**.
> - Real-world customer support chats contain unseen phrasing, typos, and multi-turn context where recall and precision will be lower.

---

## 2. Promise Detection Metrics (`is_promise`, all 50 samples)

| Metric | Value |
|--------|-------|
| True Positives (TP — includes all 31 high, 2 medium, 7 low) | 40 |
| False Positives (FP) | 0 |
| True Negatives (TN — 5 claims + 5 greetings/questions) | 10 |
| False Negatives (FN) | 0 |
| Precision | **1.0000** |
| Recall | **1.0000** |
| F1 Score | **1.0000** |
| Accuracy | **1.0000** |

---

## 3. Confidence Category Confusion Matrix (4×4)

Rows = expected category, Columns = predicted category:

| Expected \ Predicted | `high` | `medium` | `low` | `none` |
|----------------------|--------|----------|-------|--------|
| **`high`** (31) | **31** | 0 | 0 | 0 |
| **`medium`** (2) | 0 | **2** | 0 | 0 |
| **`low`** (7) | 0 | 0 | **7** | 0 |
| **`none`** (10) | 0 | 0 | 0 | **10** |

Overall category accuracy: **1.0000** (`50 / 50`).

---

## 4. Threshold Sweep (`CONFIDENCE_THRESHOLD`)

Evaluating `auto_accept = is_promise and (confidence >= t)` for separating concrete commitments (`33`: `31 high + 2 medium`) from vague promises (`7 low`, routed to manual review) and non-promises (`10 none`, rejected):

- **Concrete Precision** = `auto_concrete_tp / auto_accepted`
- **Concrete Recall** = `auto_concrete_tp / 33`
- **Positive Coverage** = `auto_accepted_true_promises / 40` (fraction of all 40 positive promises auto-accepted; remainder `manual_review_promises` are flagged for user review)

| Threshold | Auto-Accepted | Concrete TP | Vague FP | Manual Review | Rejected TN | Concrete P | Concrete R | Concrete F1 | Positive Coverage |
|-----------|---------------|-------------|----------|---------------|-------------|------------|------------|-------------|-------------------|
| `0.30` | 40 | 33 | 7 | 0 | 10 | 0.8250 | 1.0000 | 0.9041 | 1.0000 (40/40) |
| `0.40` | 39 | 33 | 6 | 1 | 10 | 0.8462 | 1.0000 | 0.9167 | 0.9750 (39/40) |
| `0.50` | 34 | 33 | 1 | 6 | 10 | 0.9706 | 1.0000 | 0.9851 | 0.8500 (34/40) |
| **`0.55`** | **33** | **33** | **0** | **7** | **10** | **1.0000** | **1.0000** | **1.0000** | **0.8250 (33/40)** |
| `0.60` | 32 | 32 | 0 | 8 | 10 | 1.0000 | 0.9697 | 0.9846 | 0.8000 (32/40) |
| `0.70` | 32 | 32 | 0 | 8 | 10 | 1.0000 | 0.9697 | 0.9846 | 0.8000 (32/40) |
| `0.80` | 31 | 31 | 0 | 9 | 10 | 1.0000 | 0.9394 | 0.9688 | 0.7750 (31/40) |
| `0.85` | 27 | 27 | 0 | 13 | 10 | 1.0000 | 0.8182 | 0.9000 | 0.6750 (27/40) |

---

## 5. Recommendation

**`CONFIDENCE_THRESHOLD = 0.55`** (configured in [config.py](file:///c:/Users/Harshit/Projects/Whackiest/backend/app/config.py) and [.env.example](file:///c:/Users/Harshit/Projects/Whackiest/backend/.env.example)):
- Achieves `1.0000` precision and `1.0000` recall on concrete commitments (`33/33`).
- Routes all `7` vague/low-confidence promises (`<= 0.50`) to **Manual Review** (`82.5%` auto-accept coverage, `17.5%` manual review) without misclassifying them as non-promises.
