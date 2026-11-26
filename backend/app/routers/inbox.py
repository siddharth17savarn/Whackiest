"""
backend/app/routers/inbox.py — /inbox router for Claude Desktop / MCP observation write-back.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from ..services.ledger_store import ack_inbox_events, enqueue_observation, read_inbox

router = APIRouter(prefix="/inbox", tags=["inbox"])


class InboxObservationRequest(BaseModel):
    promise_id: int | str
    ok: bool
    note: str = Field(..., min_length=1, max_length=1000)
    at_ms: Optional[int] = Field(default=None, gt=0)

    @field_validator("note")
    @classmethod
    def note_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("note must not be blank")
        return v.strip()


class InboxObservationResponse(BaseModel):
    status: str = "ok"
    event_id: str
    promise_id: int | str
    applied_to_ledger: bool


class InboxAckRequest(BaseModel):
    event_ids: list[str] = Field(default_factory=list)


class InboxAckResponse(BaseModel):
    status: str = "ok"
    acknowledged: int


@router.get("", response_model=dict[str, Any])
async def list_pending_inbox() -> dict[str, Any]:
    """List pending observation write-back events for the Chrome extension."""
    events = read_inbox()
    return {"count": len(events), "events": events}


@router.post("", response_model=InboxObservationResponse)
async def post_inbox_observation(payload: InboxObservationRequest) -> InboxObservationResponse:
    """Queue an observation write-back event and apply it to ~/.aftermath/ledger.json."""
    event, applied = enqueue_observation(
        promise_id=payload.promise_id,
        ok=payload.ok,
        note=payload.note,
        at_ms=payload.at_ms,
    )
    return InboxObservationResponse(
        status="ok",
        event_id=event["event_id"],
        promise_id=payload.promise_id,
        applied_to_ledger=applied,
    )


@router.post("/ack", response_model=InboxAckResponse)
async def acknowledge_inbox(payload: InboxAckRequest) -> InboxAckResponse:
    """Acknowledge observation events after the extension merges them into chrome.storage.local."""
    removed = ack_inbox_events(payload.event_ids)
    return InboxAckResponse(status="ok", acknowledged=removed)
