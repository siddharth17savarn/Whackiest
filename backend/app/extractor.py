"""
backend/app/extractor.py — Extraction orchestrator.

Coordinates Gemini function-calling extraction with shared deadline parsing
and automatic offline fallback. Never fabricates AI results: if Gemini is
unconfigured, times out, rate-limits, or returns invalid arguments, the local
offline extractor runs and extraction_method="offline" is reported honestly.
"""
from __future__ import annotations

import hashlib
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from shared.deadline_parser import HOUR, parse_deadline  # noqa: E402

from .confidence import score_confidence  # noqa: E402
from .config import Settings  # noqa: E402
from .fallback import extract_offline  # noqa: E402
from .gemini_client import GeminiFunctionArgs, GeminiUnavailableError, extract_with_gemini  # noqa: E402
from .schemas import ExtractedPromise, ExtractRequest, ExtractResponse  # noqa: E402
from .services.pii_masking import mask_pii  # noqa: E402
from .services.prompt_guard import inspect_and_sanitize  # noqa: E402

logger = logging.getLogger("aftermath.extractor")


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _ms_to_iso(ms: Optional[int]) -> Optional[str]:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone().isoformat()


def _build_gemini_response(
    *,
    args: GeminiFunctionArgs,
    request: ExtractRequest,
    now_ms: int,
    raw_text_hash: str,
    pii_masked: bool,
    prompt_injection_detected: bool,
) -> ExtractResponse:
    if not args.is_promise:
        return ExtractResponse(
            is_promise=False,
            is_claim=args.is_claim,
            extraction_method="gemini",
            promises=[],
            pii_masked=pii_masked,
            prompt_injection_detected=prompt_injection_detected,
            raw_text_hash=raw_text_hash,
        )

    # Resolve deadline using shared/deadline_parser.py so business-day math
    # and simulated clock now_ms are always consistent with the extension.
    phrase_to_parse = args.deadline_phrase or args.original_quote or request.text
    dl = parse_deadline(phrase_to_parse, now_ms)

    due_ms = dl["due"]
    deadline_method = dl["method"]
    raw_deadline = dl["raw"]

    # If regex didn't match a standard phrase, use Gemini's deadline_hours if valid
    if due_ms is None and args.deadline_hours is not None and args.deadline_hours > 0:
        due_ms = now_ms + int(round(args.deadline_hours * HOUR))
        deadline_method = "llm_hours"
        raw_deadline = args.deadline_phrase or f"{args.deadline_hours} hours"

    deadline_hours = (
        max(0.0, round((due_ms - now_ms) / HOUR, 2))
        if due_ms is not None
        else None
    )

    condition = args.condition.strip() if args.condition else dl["condition"]
    quote = args.original_quote.strip() or request.text
    company = args.company.strip() if args.company and args.company.strip() else request.company

    confidence, level = score_confidence(
        is_promise=True,
        deadline_method=deadline_method,
        has_due_ms=due_ms is not None,
        has_condition=bool(condition),
        source="gemini",
        clarity=args.clarity,
    )

    promise_item = ExtractedPromise(
        company=company,
        promise=args.promise.strip(),
        original_quote=quote,
        deadline_hours=deadline_hours,
        deadline_date=_ms_to_iso(due_ms),
        due_ms=due_ms,
        condition=condition,
        confidence=confidence,
        confidence_level=level,
        extraction_method="gemini",
        deadline_method=deadline_method,
        raw_deadline=raw_deadline,
    )

    return ExtractResponse(
        is_promise=True,
        is_claim=args.is_claim,
        extraction_method="gemini",
        promises=[promise_item],
        pii_masked=pii_masked,
        prompt_injection_detected=prompt_injection_detected,
        raw_text_hash=raw_text_hash,
    )


async def extract_promises(
    request: ExtractRequest,
    settings: Settings,
    *,
    client_factory: Any = None,
) -> ExtractResponse:
    """
    Extract structured promises from a support chat message.

    Uses Gemini function calling when GEMINI_API_KEY is configured, and
    automatically falls back to the local offline extractor on missing key,
    timeout, rate limit, API error, or invalid schema.
    """
    now_ms = request.now_ms if request.now_ms is not None else int(time.time() * 1000)
    raw_text_hash = _hash_text(request.text)
    fallback_reason: Optional[str] = None

    if request.is_streaming:
        return ExtractResponse(
            is_promise=False,
            is_claim=False,
            extraction_method="offline",
            promises=[],
            pii_masked=False,
            prompt_injection_detected=False,
            raw_text_hash=raw_text_hash,
            fallback_reason="streaming_incomplete",
        )

    # 1. Prompt-injection inspection & sanitization (never log raw text)
    guard_res = inspect_and_sanitize(request.text)
    safe_text = guard_res.sanitized_text
    if guard_res.injection_detected:
        logger.warning(
            "Prompt injection detected for msg_hash=%s reasons=%s",
            raw_text_hash,
            guard_res.reasons,
        )

    # 2. PII masking BEFORE sending to any external AI service
    pii_res = mask_pii(safe_text, company=request.company)
    masked_for_llm = pii_res.masked_text
    if pii_res.pii_detected:
        logger.info(
            "Masked PII for msg_hash=%s counts=%s",
            raw_text_hash,
            pii_res.counts,
        )

    if settings.gemini_configured and masked_for_llm:
        try:
            args = await extract_with_gemini(
                text=masked_for_llm,
                company=request.company,
                api_key=settings.gemini_api_key or "",
                model=settings.gemini_model,
                timeout_seconds=settings.gemini_timeout_seconds,
                client_factory=client_factory,
            )
            return _build_gemini_response(
                args=args,
                request=request,
                now_ms=now_ms,
                raw_text_hash=raw_text_hash,
                pii_masked=pii_res.pii_detected,
                prompt_injection_detected=guard_res.injection_detected,
            )
        except GeminiUnavailableError as exc:
            fallback_reason = exc.reason
            logger.info(
                "Falling back to offline extraction for msg_hash=%s (%s)",
                raw_text_hash,
                fallback_reason,
            )
    elif settings.gemini_configured and not masked_for_llm:
        fallback_reason = "sanitized_empty_after_injection_guard"
    else:
        fallback_reason = "no_api_key"

    promises, is_claim = extract_offline(
        text=safe_text,
        company=request.company,
        now_ms=now_ms,
    )

    return ExtractResponse(
        is_promise=len(promises) > 0,
        is_claim=is_claim,
        extraction_method="offline",
        promises=promises,
        pii_masked=pii_res.pii_detected,
        prompt_injection_detected=guard_res.injection_detected,
        raw_text_hash=raw_text_hash,
        fallback_reason=fallback_reason,
    )
