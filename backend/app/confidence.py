"""
backend/app/confidence.py — Meaningful, documented confidence scoring.

Methodology:
  - No promise (is_promise=False):
      score = 0.0, level = "none"
  - High confidence (0.85 - 0.95):
      Explicit commitment with a concrete, unambiguous deadline
      (biz_days, cal_days, hours, tomorrow, today, by_day).
      Base 0.92 for Gemini, 0.90 for offline parser; -0.04 if conditional,
      -0.05 if range (biz_range / cal_range, landing at ~0.80-0.87).
  - Medium confidence (0.55 - 0.79):
      Clear commitment cue exists, but deadline is missing ("none") or
      only inferred by LLM without a concrete phrase.
  - Low confidence (0.25 - 0.50):
      Vague / qualitative deadline ("shortly", "soon", "ASAP", "immediately")
      or weak/ambiguous commitment.
"""
from __future__ import annotations

from typing import Literal, Optional

ConfidenceLevel = Literal["high", "medium", "low", "none"]

_CONCRETE_METHODS = {
    "biz_days", "cal_days", "hours", "tomorrow", "today", "by_day",
    "explicit_date", "weeks",
}
_RANGE_METHODS = {"biz_range", "cal_range"}
_VAGUE_METHODS = {"vague_immediate", "vague_shortly", "vague_asap", "vague_few_days"}


def score_confidence(
    *,
    is_promise: bool,
    deadline_method: str,
    has_due_ms: bool,
    has_condition: bool,
    source: Literal["gemini", "offline"],
    clarity: Optional[str] = None,
) -> tuple[float, ConfidenceLevel]:
    """Compute a calibrated confidence score in [0.0, 1.0] and its tier."""
    if not is_promise:
        return 0.0, "none"

    if deadline_method in _VAGUE_METHODS or clarity == "vague":
        if deadline_method == "vague_immediate":
            score = 0.50
        elif deadline_method == "vague_asap":
            score = 0.35
        else:
            score = 0.40
        return score, "low"

    if deadline_method in _CONCRETE_METHODS:
        score = 0.92 if source == "gemini" else 0.90
        if has_condition:
            score -= 0.04
        return round(score, 2), "high"

    if deadline_method in _RANGE_METHODS:
        score = 0.85 if source == "gemini" else 0.80
        if has_condition:
            score -= 0.04
        return round(score, 2), "high" if score >= 0.80 else "medium"

    # Commitment exists, but no concrete deadline phrase was parsed
    if has_due_ms:
        # e.g. Gemini supplied deadline_hours without a standard regex match
        score = 0.75 if source == "gemini" else 0.65
        return score, "medium"

    # Commitment with no deadline at all
    if clarity == "ambiguous":
        return 0.60, "medium"
    return 0.65 if source == "gemini" else 0.58, "medium"


def classify_level(score: float) -> ConfidenceLevel:
    if score <= 0.0:
        return "none"
    if score >= 0.80:
        return "high"
    if score >= 0.55:
        return "medium"
    return "low"
