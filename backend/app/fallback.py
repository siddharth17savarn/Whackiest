"""
backend/app/fallback.py — Offline / local promise extractor.

Reuses shared/deadline_parser.py so the backend and Chrome extension
produce identical deadlines when Gemini is unavailable or unconfigured.
Never fabricates AI results — always marks extraction_method="offline".
"""
from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Ensure repo root is importable so we can reuse shared/deadline_parser.py
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from shared.deadline_parser import parse_deadline  # noqa: E402

from .confidence import score_confidence  # noqa: E402
from .schemas import ExtractedPromise  # noqa: E402

# Claim pattern: company says a prior commitment has already been fulfilled
_CLAIM_RE = re.compile(
    r"\b(has been|have been|is now|was|were)\s+"
    r"(processed|completed|issued|shipped|resolved|dispatched|refunded|delivered)\b",
    re.IGNORECASE,
)

# Promise cue pattern: forward-looking commitment language
_PROMISE_CUE_RE = re.compile(
    r"\b("
    r"will|we'll|we will|shall|going to|guaranteed|arrives|scheduled|"
    r"within\s+\d+|"
    r"shortly|soon|asap|as soon as possible|immediately|right away|"
    r"(?:by|on|before)\s+(?:tomorrow|today|end of (?:the )?day|eod|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})"
    r")\b",
    re.IGNORECASE,
)

# Sentences that look like greetings/fillers even if they contain "will" or "soon"
_NON_PROMISE_RE = re.compile(
    r"^(hi|hello|hey|good morning|good afternoon|good evening|thanks for|thank you for|how can i help)\b",
    re.IGNORECASE,
)

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def is_claim_message(text: str) -> bool:
    """Return True if the text claims a prior promise has been completed."""
    return bool(_CLAIM_RE.search(text))


def _ms_to_iso(ms: Optional[int]) -> Optional[str]:
    if ms is None:
        return None
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone()
    return dt.isoformat()


def extract_offline(
    *,
    text: str,
    company: Optional[str],
    now_ms: int,
) -> tuple[list[ExtractedPromise], bool]:
    """
    Extract promises locally without any network call.

    Returns:
        (promises, is_claim)
    """
    claim = is_claim_message(text)
    if claim and not _PROMISE_CUE_RE.search(text):
        # Pure claim ("Your refund has been processed on our side.") — not a new promise
        return [], True

    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(text.strip()) if s.strip()]
    promises: list[ExtractedPromise] = []

    for sentence in sentences:
        if not _PROMISE_CUE_RE.search(sentence):
            continue
        # Skip pure greetings unless they also carry a concrete deadline
        dl = parse_deadline(sentence, now_ms)
        if _NON_PROMISE_RE.match(sentence) and dl["due"] is None:
            continue

        due_ms = dl["due"]
        deadline_hours = round((due_ms - now_ms) / 3_600_000, 2) if due_ms is not None else None
        if deadline_hours is not None and deadline_hours < 0:
            deadline_hours = 0.0

        confidence, level = score_confidence(
            is_promise=True,
            deadline_method=dl["method"],
            has_due_ms=due_ms is not None,
            has_condition=bool(dl["condition"]),
            source="offline",
        )

        promises.append(
            ExtractedPromise(
                company=company,
                promise=sentence,
                original_quote=sentence,
                deadline_hours=deadline_hours,
                deadline_date=_ms_to_iso(due_ms),
                due_ms=due_ms,
                condition=dl["condition"],
                confidence=confidence,
                confidence_level=level,
                extraction_method="offline",
                deadline_method=dl["method"],
                raw_deadline=dl["raw"],
            )
        )

    return promises, claim
