"""
backend/app/services/calibration.py — Confidence threshold calibration & evaluation.

Evaluates promise extraction and confidence scoring against datasets/labelled_50.json.
Distinguishes clearly between:
  1. Promise detection (is_promise vs expected_promise) — all 40 positive promises
     (31 high, 2 medium, 7 low) are positives; 10 non-promises are negatives.
  2. Auto-acceptance vs Manual Review at threshold t:
       - Auto-accepted: is_promise and score >= t
       - Manual review: is_promise and score < t  (low-confidence promises are NOT discarded as TN)
       - Rejected:      not is_promise
     Reports auto-accept precision on concrete commitments (high/medium),
     positive promise coverage (auto_accepted_true_promises / total_positive_promises),
     manual-review count, and selective F1.
"""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from ..config import Settings
from ..extractor import extract_promises
from ..schemas import ExtractRequest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DEFAULT_DATASET = _REPO_ROOT / "datasets" / "labelled_50.json"
_ANCHOR_MS = int(datetime(2026, 11, 26, 10, 0, 0).timestamp() * 1000)

CATEGORIES = ("high", "medium", "low", "none")


@dataclass
class SampleEval:
    message_id: str
    scenario: str
    expected_promise: bool
    actual_promise: bool
    expected_category: str
    actual_category: str
    actual_score: float


@dataclass
class BinaryMetrics:
    tp: int
    fp: int
    tn: int
    fn: int

    @property
    def precision(self) -> float:
        return round(self.tp / (self.tp + self.fp), 4) if (self.tp + self.fp) else 0.0

    @property
    def recall(self) -> float:
        return round(self.tp / (self.tp + self.fn), 4) if (self.tp + self.fn) else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return round(2 * p * r / (p + r), 4) if (p + r) else 0.0

    @property
    def accuracy(self) -> float:
        total = self.tp + self.fp + self.tn + self.fn
        return round((self.tp + self.tn) / total, 4) if total else 0.0


@dataclass
class ThresholdPoint:
    threshold: float
    auto_accepted: int
    auto_accept_concrete_tp: int
    auto_accept_vague_fp: int
    auto_accept_non_promise_fp: int
    manual_review_promises: int
    rejected_tn: int
    concrete_missed_to_review: int
    concrete_precision: float
    concrete_recall: float
    concrete_f1: float
    positive_coverage: float


@dataclass
class CalibrationReport:
    total_samples: int
    promise_existence: BinaryMetrics
    confusion_matrix: dict[str, dict[str, int]]
    category_accuracy: float
    threshold_sweep: list[ThresholdPoint]
    recommended_threshold: float
    mismatches: list[SampleEval]


async def evaluate_dataset(
    dataset_path: Optional[Path] = None,
    *,
    now_ms: int = _ANCHOR_MS,
) -> CalibrationReport:
    path = dataset_path or _DEFAULT_DATASET
    rows = json.loads(path.read_text(encoding="utf-8"))
    settings = Settings(gemini_api_key=None, _env_file=None)

    evals: list[SampleEval] = []
    cm: dict[str, dict[str, int]] = {
        exp: {act: 0 for act in CATEGORIES} for exp in CATEGORIES
    }

    tp = fp = tn = fn = 0

    for row in rows:
        req = ExtractRequest(
            text=row["message"],
            company=row["company"],
            now_ms=now_ms,
        )
        res = await extract_promises(req, settings)
        actual_promise = res.is_promise
        expected_promise = bool(row["expected_promise"])

        if actual_promise and expected_promise:
            tp += 1
        elif actual_promise and not expected_promise:
            fp += 1
        elif not actual_promise and not expected_promise:
            tn += 1
        else:
            fn += 1

        if res.promises:
            actual_cat = res.promises[0].confidence_level
            actual_score = res.promises[0].confidence
        else:
            actual_cat = "none"
            actual_score = 0.0

        exp_cat = row["expected_confidence_category"]
        cm[exp_cat][actual_cat] += 1

        evals.append(
            SampleEval(
                message_id=row["message_id"],
                scenario=row["scenario"],
                expected_promise=expected_promise,
                actual_promise=actual_promise,
                expected_category=exp_cat,
                actual_category=actual_cat,
                actual_score=actual_score,
            )
        )

    mismatches = [
        e for e in evals
        if e.expected_promise != e.actual_promise or e.expected_category != e.actual_category
    ]
    cat_correct = sum(1 for e in evals if e.expected_category == e.actual_category)
    cat_acc = round(cat_correct / len(evals), 4) if evals else 0.0

    total_positives = sum(1 for e in evals if e.expected_promise)
    total_concrete = sum(1 for e in evals if e.expected_category in ("high", "medium"))

    sweep: list[ThresholdPoint] = []
    for t in (0.30, 0.40, 0.50, 0.55, 0.60, 0.70, 0.80, 0.85):
        auto_concrete_tp = 0
        auto_vague_fp = 0
        auto_non_promise_fp = 0
        manual_review = 0
        rejected_tn = 0
        concrete_missed = 0

        for e in evals:
            auto_accept = e.actual_promise and (e.actual_score >= t)
            if auto_accept:
                if e.expected_category in ("high", "medium"):
                    auto_concrete_tp += 1
                elif e.expected_category == "low":
                    auto_vague_fp += 1
                else:
                    auto_non_promise_fp += 1
            else:
                if e.actual_promise:
                    manual_review += 1
                    if e.expected_category in ("high", "medium"):
                        concrete_missed += 1
                elif not e.expected_promise:
                    rejected_tn += 1

        auto_accepted = auto_concrete_tp + auto_vague_fp + auto_non_promise_fp
        c_prec = round(auto_concrete_tp / auto_accepted, 4) if auto_accepted else 0.0
        c_rec = round(auto_concrete_tp / total_concrete, 4) if total_concrete else 0.0
        c_f1 = round(2 * c_prec * c_rec / (c_prec + c_rec), 4) if (c_prec + c_rec) else 0.0
        coverage = round((auto_concrete_tp + auto_vague_fp) / total_positives, 4) if total_positives else 0.0

        sweep.append(
            ThresholdPoint(
                threshold=t,
                auto_accepted=auto_accepted,
                auto_accept_concrete_tp=auto_concrete_tp,
                auto_accept_vague_fp=auto_vague_fp,
                auto_accept_non_promise_fp=auto_non_promise_fp,
                manual_review_promises=manual_review,
                rejected_tn=rejected_tn,
                concrete_missed_to_review=concrete_missed,
                concrete_precision=c_prec,
                concrete_recall=c_rec,
                concrete_f1=c_f1,
                positive_coverage=coverage,
            )
        )

    best_f1 = max(p.concrete_f1 for p in sweep)
    best_points = [p for p in sweep if p.concrete_f1 == best_f1]
    recommended = 0.55 if any(p.threshold == 0.55 for p in best_points) else best_points[0].threshold

    return CalibrationReport(
        total_samples=len(evals),
        promise_existence=BinaryMetrics(tp=tp, fp=fp, tn=tn, fn=fn),
        confusion_matrix=cm,
        category_accuracy=cat_acc,
        threshold_sweep=sweep,
        recommended_threshold=recommended,
        mismatches=mismatches,
    )


if __name__ == "__main__":
    rep = asyncio.run(evaluate_dataset())
    print("Total samples:", rep.total_samples)
    print("Promise existence:", rep.promise_existence, "F1:", rep.promise_existence.f1, "Acc:", rep.promise_existence.accuracy)
    print("Category accuracy:", rep.category_accuracy)
    for pt in rep.threshold_sweep:
        print(
            f"  t={pt.threshold:.2f} auto={pt.auto_accepted} (TP={pt.auto_accept_concrete_tp}, "
            f"vague_FP={pt.auto_accept_vague_fp}) review={pt.manual_review_promises} "
            f"TN={pt.rejected_tn} P={pt.concrete_precision} R={pt.concrete_recall} "
            f"F1={pt.concrete_f1} cov={pt.positive_coverage}"
        )
    print("Recommended threshold:", rep.recommended_threshold)
