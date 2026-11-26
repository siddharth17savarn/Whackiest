"""
shared/deadline_parser.py — AFTERMATH LIVE deadline parser (Python port)

Mirrors the logic in shared/deadline_parser.js exactly so the FastAPI
backend produces the same deadlines as the Chrome extension's local
fallback.

Every function takes `now_ms` (epoch ms) as an argument and never reads
the system clock on its own.

Usage:
    from shared.deadline_parser import parse_deadline, add_business_days

    result = parse_deadline("within 5 business days", now_ms=1732000000000)
    # → { "due": ..., "confidence": 0.90, "raw": "within 5 business days",
    #     "method": "biz_days", "condition": None }
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Optional, TypedDict

# ── constants ──────────────────────────────────────────────────────────

HOUR = 3_600_000
DAY = 86_400_000

DAYS = [
    "sunday", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday",
]

MONTHS = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}


# ── result type ────────────────────────────────────────────────────────

class DeadlineResult(TypedDict):
    due: Optional[int]
    confidence: float
    raw: str
    method: str
    condition: Optional[str]


# ── business-day arithmetic ────────────────────────────────────────────

def add_business_days(from_ms: int, n: int) -> int:
    """
    Add `n` business days to `from_ms`, skipping weekends (Sat/Sun).
    Returns epoch ms at 18:00 local of the target day.
    """
    if n <= 0:
        return from_ms
    dt = datetime.fromtimestamp(from_ms / 1000)
    added = 0
    while added < n:
        dt += timedelta(days=1)
        if dt.weekday() < 5:          # Mon-Fri = 0-4
            added += 1
    dt = dt.replace(hour=18, minute=0, second=0, microsecond=0)
    return int(dt.timestamp() * 1000)


def add_calendar_days(from_ms: int, n: int) -> int:
    """
    Add `n` calendar days to `from_ms`.
    Returns epoch ms at 23:59:59 of the target day.
    """
    dt = datetime.fromtimestamp(from_ms / 1000)
    dt += timedelta(days=n)
    dt = dt.replace(hour=23, minute=59, second=59, microsecond=0)
    return int(dt.timestamp() * 1000)


# ── pattern definitions (order matters: most specific first) ───────────

_PATTERNS: list[tuple[re.Pattern, str, object]] = []


def _pat(regex: str, method: str):
    """Decorator to register a pattern handler."""
    compiled = re.compile(regex, re.IGNORECASE)

    def decorator(fn):
        _PATTERNS.append((compiled, method, fn))
        return fn

    return decorator


# ── ranges with business/working ──

@_pat(r"(?:within|in|next)\s+(\d+)\s*[-\u2013to]+\s*(\d+)\s+(?:business|working)\s*days?", "biz_range")
def _biz_range(m: re.Match, now_ms: int) -> dict:
    upper = int(m.group(2))
    return {"due": add_business_days(now_ms, upper), "confidence": 0.80}


@_pat(r"(\d+)\s*[-\u2013to]+\s*(\d+)\s+(?:business|working)\s*days?", "biz_range")
def _biz_range_bare(m: re.Match, now_ms: int) -> dict:
    upper = int(m.group(2))
    return {"due": add_business_days(now_ms, upper), "confidence": 0.80}


# ── exact business/working days ──

@_pat(r"(?:within|in|next)\s+(\d+)\s+(?:business|working)\s*days?", "biz_days")
def _biz_days(m: re.Match, now_ms: int) -> dict:
    return {"due": add_business_days(now_ms, int(m.group(1))), "confidence": 0.90}


@_pat(r"(\d+)\s+(?:business|working)\s*days?", "biz_days")
def _biz_days_bare(m: re.Match, now_ms: int) -> dict:
    return {"due": add_business_days(now_ms, int(m.group(1))), "confidence": 0.85}


# ── calendar-day ranges ──

@_pat(r"(?:within|in|next)\s+(\d+)\s*[-\u2013to]+\s*(\d+)\s+(?:calendar\s*)?days?", "cal_range")
def _cal_range(m: re.Match, now_ms: int) -> dict:
    return {"due": add_calendar_days(now_ms, int(m.group(2))), "confidence": 0.80}


@_pat(r"(\d+)\s*[-\u2013to]+\s*(\d+)\s+(?:calendar\s*)?days?", "cal_range")
def _cal_range_bare(m: re.Match, now_ms: int) -> dict:
    return {"due": add_calendar_days(now_ms, int(m.group(2))), "confidence": 0.75}


# ── exact calendar days ──

@_pat(r"(?:within|in|next)\s+(\d+)\s+(?:calendar\s*)?days?", "cal_days")
def _cal_days(m: re.Match, now_ms: int) -> dict:
    return {"due": add_calendar_days(now_ms, int(m.group(1))), "confidence": 0.90}


# ── hours ──

@_pat(r"(?:within|in|next)\s+(\d+)\s+hours?", "hours")
def _hours(m: re.Match, now_ms: int) -> dict:
    return {"due": now_ms + int(m.group(1)) * HOUR, "confidence": 0.90}


@_pat(r"(\d+)\s+hours?", "hours")
def _hours_bare(m: re.Match, now_ms: int) -> dict:
    return {"due": now_ms + int(m.group(1)) * HOUR, "confidence": 0.80}


# ── relative day words ──

@_pat(r"\b(?:by\s+)?tomorrow\b", "tomorrow")
def _tomorrow(_m: re.Match, now_ms: int) -> dict:
    dt = datetime.fromtimestamp(now_ms / 1000)
    dt += timedelta(days=1)
    dt = dt.replace(hour=18, minute=0, second=0, microsecond=0)
    return {"due": int(dt.timestamp() * 1000), "confidence": 0.90}


@_pat(r"\b(?:by\s+)?(?:today|end of (?:the )?day|EOD)\b", "today")
def _today(_m: re.Match, now_ms: int) -> dict:
    dt = datetime.fromtimestamp(now_ms / 1000)
    dt = dt.replace(hour=23, minute=59, second=59, microsecond=0)
    return {"due": int(dt.timestamp() * 1000), "confidence": 0.85}


# ── explicit ISO date (YYYY-MM-DD) ──

@_pat(r"\b(?:by|on|before)\s+(\d{4})-(\d{2})-(\d{2})\b", "explicit_date")
def _explicit_iso_date(m: re.Match, _now_ms: int) -> dict:
    dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 18, 0, 0)
    return {"due": int(dt.timestamp() * 1000), "confidence": 0.92}


# ── explicit Month Day[, Year] ──

@_pat(
    r"\b(?:by|on|before)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b",
    "explicit_date",
)
def _explicit_month_day(m: re.Match, now_ms: int) -> dict:
    ref = datetime.fromtimestamp(now_ms / 1000)
    month = MONTHS[m.group(1).lower()]
    day = int(m.group(2))
    year = int(m.group(3)) if m.group(3) else ref.year
    dt = datetime(year, month, day, 18, 0, 0)
    if not m.group(3) and int(dt.timestamp() * 1000) < now_ms:
        dt = dt.replace(year=year + 1)
    return {"due": int(dt.timestamp() * 1000), "confidence": 0.90}


# ── explicit Day Month[, Year] ──

@_pat(
    r"\b(?:by|on|before)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(\d{4}))?\b",
    "explicit_date",
)
def _explicit_day_month(m: re.Match, now_ms: int) -> dict:
    ref = datetime.fromtimestamp(now_ms / 1000)
    day = int(m.group(1))
    month = MONTHS[m.group(2).lower()]
    year = int(m.group(3)) if m.group(3) else ref.year
    dt = datetime(year, month, day, 18, 0, 0)
    if not m.group(3) and int(dt.timestamp() * 1000) < now_ms:
        dt = dt.replace(year=year + 1)
    return {"due": int(dt.timestamp() * 1000), "confidence": 0.90}


# ── weeks ──

@_pat(r"(?:within|in|next)\s+(\d+|a|one)\s+weeks?", "weeks")
def _weeks(m: re.Match, now_ms: int) -> dict:
    n = 1 if m.group(1).lower() in ("a", "one") else int(m.group(1))
    return {"due": add_calendar_days(now_ms, n * 7), "confidence": 0.85}


# ── by day-of-week ──

@_pat(r"by\s+(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)", "by_day")
def _by_day(m: re.Match, now_ms: int) -> dict:
    target = DAYS.index(m.group(1).lower())
    dt = datetime.fromtimestamp(now_ms / 1000)
    # Python weekday: Mon=0 … Sun=6.  JS getDay: Sun=0 … Sat=6.
    # Convert Python weekday to JS-style for consistent logic.
    current_js = (dt.weekday() + 1) % 7   # Mon→1, Tue→2, … Sun→0
    delta = ((target - current_js + 7) % 7) or 7
    dt += timedelta(days=delta)
    dt = dt.replace(hour=18, minute=0, second=0, microsecond=0)
    return {"due": int(dt.timestamp() * 1000), "confidence": 0.85}


# ── vague / qualitative ──

@_pat(r"\b(?:within|in)\s+(?:a\s+)?(?:few|couple\s+of)\s+days\b", "vague_few_days")
def _few_days(_m: re.Match, now_ms: int) -> dict:
    return {"due": now_ms + 3 * DAY, "confidence": 0.40}


@_pat(r"\b(?:immediately|right away)\b", "vague_immediate")
def _immediately(_m: re.Match, now_ms: int) -> dict:
    return {"due": now_ms + 4 * HOUR, "confidence": 0.50}


@_pat(r"\b(?:shortly|soon|at the earliest|in due course)\b", "vague_shortly")
def _shortly(_m: re.Match, now_ms: int) -> dict:
    return {"due": now_ms + 2 * DAY, "confidence": 0.40}


@_pat(r"\b(?:as soon as possible|ASAP)\b", "vague_asap")
def _asap(_m: re.Match, now_ms: int) -> dict:
    return {"due": now_ms + 1 * DAY, "confidence": 0.35}


# ── condition extraction ──────────────────────────────────────────────

_CONDITION_RE = re.compile(
    r"\b(provided|if|once|subject to|after|assuming|as long as|when)\b[^.]*",
    re.IGNORECASE,
)


def extract_condition(text: str) -> Optional[str]:
    """Extract a conditional clause from text, if present."""
    m = _CONDITION_RE.search(text)
    return m.group(0).strip() if m else None


# ── main parser ───────────────────────────────────────────────────────

def parse_deadline(text: str, now_ms: int) -> DeadlineResult:
    """
    Parse a deadline from free-form text.

    Args:
        text:   the agent message or sentence
        now_ms: current epoch ms (from the shared clock)

    Returns:
        DeadlineResult with due, confidence, raw, method, condition
    """
    if not text or not isinstance(text, str):
        return DeadlineResult(
            due=None, confidence=0.0, raw="", method="none", condition=None,
        )

    for pattern, method, handler in _PATTERNS:
        m = pattern.search(text)
        if m:
            result = handler(m, now_ms)
            return DeadlineResult(
                due=result["due"],
                confidence=result["confidence"],
                raw=m.group(0),
                method=method,
                condition=extract_condition(text),
            )

    return DeadlineResult(
        due=None, confidence=0.0, raw="", method="none",
        condition=extract_condition(text),
    )
