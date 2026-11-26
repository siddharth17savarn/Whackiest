"""
backend/app/routers/sync.py — /sync router for extension <-> ~/.aftermath/ledger.json.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..schemas import ExportLedgerItem
from ..services.ledger_store import merge_and_write_ledger, read_ledger

router = APIRouter(prefix="/sync", tags=["sync"])


class SyncRequest(BaseModel):
    items: list[ExportLedgerItem] = Field(default_factory=list)
    skew: int = Field(default=0)


class SyncResponse(BaseModel):
    status: str = "ok"
    synced_count: int
    updated_at: Optional[str] = None
    skew: int
    pending_inbox_count: int


@router.get("", response_model=dict[str, Any])
async def get_synced_ledger() -> dict[str, Any]:
    """Return the current synchronized ledger from ~/.aftermath/ledger.json."""
    return read_ledger()


@router.post("", response_model=SyncResponse)
async def post_sync_ledger(payload: SyncRequest) -> SyncResponse:
    """Persist extension ledger items to ~/.aftermath/ledger.json without clobbering pending inbox observations."""
    raw_items = [item.model_dump(mode="json") for item in payload.items]
    saved, pending_count = merge_and_write_ledger(raw_items, skew=payload.skew)
    return SyncResponse(
        status="ok",
        synced_count=len(raw_items),
        updated_at=saved.get("updated_at"),
        skew=saved.get("skew", 0),
        pending_inbox_count=pending_count,
    )
