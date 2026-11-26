"""
backend/app/services/exporter.py — Dispute evidence exporter (/export).

Builds structured, PII-masked, chronologically ordered dispute cases matching
docs/export_contract.md. Never invents missing quotes, observations, or dates.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional

from ..schemas import (
    ClaimVsObservation,
    ExportedDisputeCase,
    ExportLedgerItem,
    ExportRequest,
    ExportResponse,
    ExportSummary,
    LedgerState,
    TimelineEvent,
)
from .pii_masking import mask_pii


def _ms_to_iso(ms: Optional[int]) -> Optional[str]:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone().isoformat()


def _resolve_state(item: ExportLedgerItem, now_ms: int) -> LedgerState:
    if item.verified:
        return "VERIFIED"
    if item.claimed and item.observed and item.observed.ok is False:
        return "CONTRADICTION"
    if item.due is not None and item.due < now_ms:
        return "OVERDUE"
    if item.observed is not None:
        return "OBSERVED"
    if item.claimed is not None:
        return "CLAIMED"
    if item.state is not None:
        return item.state
    return "PROMISED"


def _mask_optional(text: Optional[str], company: str) -> tuple[Optional[str], bool]:
    if text is None or not text.strip():
        return text, False
    res = mask_pii(text, company=company)
    return res.masked_text, res.pii_detected


def build_export_response(request: ExportRequest) -> ExportResponse:
    now_ms = request.now_ms if request.now_ms is not None else int(time.time() * 1000)
    exported_at = _ms_to_iso(now_ms) or datetime.now(timezone.utc).astimezone().isoformat()

    cases: list[ExportedDisputeCase] = []
    contradictions = overdue = verified = open_count = 0

    for item in request.items:
        co = item.company.strip()
        any_pii = False

        promise_text, p_pii = _mask_optional(item.promise, co)
        any_pii = any_pii or p_pii

        quote_text, q_pii = _mask_optional(item.evidence, co)
        any_pii = any_pii or q_pii

        cond_text, c_pii = _mask_optional(item.condition, co)
        any_pii = any_pii or c_pii

        claim_quote: Optional[str] = None
        if item.claimed is not None:
            claim_quote, cl_pii = _mask_optional(item.claimed.text, co)
            any_pii = any_pii or cl_pii

        obs_note: Optional[str] = None
        if item.observed is not None and item.observed.note:
            obs_note, ob_pii = _mask_optional(item.observed.note, co)
            any_pii = any_pii or ob_pii

        state = _resolve_state(item, now_ms)
        is_overdue = (not item.verified) and (item.due is not None) and (item.due < now_ms)
        is_contradiction = bool(item.claimed and item.observed and item.observed.ok is False)

        if is_overdue:
            overdue += 1
        if state == "CONTRADICTION":
            contradictions += 1
        elif state == "VERIFIED":
            verified += 1
        elif not is_overdue:
            open_count += 1

        # Build timeline strictly from real present timestamps & evidence
        timeline: list[TimelineEvent] = []
        timeline.append(
            TimelineEvent(
                event="PROMISED",
                timestamp_ms=item.created,
                timestamp_iso=_ms_to_iso(item.created),
                detail=promise_text or item.promise,
            )
        )

        if item.claimed is not None:
            timeline.append(
                TimelineEvent(
                    event="CLAIMED",
                    timestamp_ms=item.claimed.at,
                    timestamp_iso=_ms_to_iso(item.claimed.at),
                    detail=claim_quote or "",
                )
            )

        if item.observed is not None:
            obs_detail = obs_note or (
                "Outcome confirmed by user." if item.observed.ok else "Outcome not observed by user."
            )
            timeline.append(
                TimelineEvent(
                    event="OBSERVED",
                    timestamp_ms=item.observed.at,
                    timestamp_iso=_ms_to_iso(item.observed.at),
                    detail=obs_detail,
                )
            )

        if is_overdue:
            timeline.append(
                TimelineEvent(
                    event="DEADLINE_PASSED",
                    timestamp_ms=item.due,
                    timestamp_iso=_ms_to_iso(item.due),
                    detail="Promised deadline elapsed without verification.",
                )
            )

        if item.verified:
            timeline.append(
                TimelineEvent(
                    event="VERIFIED",
                    timestamp_ms=item.observed.at if item.observed else None,
                    timestamp_iso=_ms_to_iso(item.observed.at) if item.observed else None,
                    detail="Promise verified by user.",
                )
            )

        # Sort events that have timestamps chronologically; keep undated events in logical order
        timeline.sort(key=lambda e: (e.timestamp_ms is None, e.timestamp_ms or 0))

        cases.append(
            ExportedDisputeCase(
                id=item.id,
                company=co,
                state=state,
                promise=promise_text or item.promise,
                original_quote=quote_text if quote_text else None,
                condition=cond_text if cond_text else None,
                confidence=item.confidence,
                source_url=item.chat,
                created_ms=item.created,
                created_at=_ms_to_iso(item.created),
                due_ms=item.due,
                due_at=_ms_to_iso(item.due),
                is_overdue=is_overdue,
                pii_masked=any_pii,
                claim_vs_observation=ClaimVsObservation(
                    claimed=item.claimed is not None,
                    claim_quote=claim_quote,
                    claimed_at_ms=item.claimed.at if item.claimed else None,
                    claimed_at=_ms_to_iso(item.claimed.at) if item.claimed else None,
                    observed=item.observed is not None,
                    observed_ok=item.observed.ok if item.observed else None,
                    observation_note=obs_note,
                    observed_at_ms=item.observed.at if item.observed else None,
                    observed_at=_ms_to_iso(item.observed.at) if item.observed else None,
                    contradiction=is_contradiction,
                ),
                timeline=timeline,
            )
        )

    return ExportResponse(
        schema_version="1.0",
        exported_at=exported_at,
        now_ms=now_ms,
        total_cases=len(cases),
        summary=ExportSummary(
            contradictions=contradictions,
            overdue=overdue,
            verified=verified,
            open=open_count,
        ),
        cases=cases,
    )
