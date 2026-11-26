"""
backend/app/schemas.py — Strict Pydantic v2 schemas for /extract and /health.

Aligns with docs/extract_api.md and the shared ledger item contract.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ExtractRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(
        ...,
        min_length=1,
        max_length=8000,
        description="Raw customer-support agent message text.",
    )
    company: Optional[str] = Field(
        default=None,
        max_length=120,
        description="Company name detected on the page (e.g., ShopKart).",
    )
    now_ms: Optional[int] = Field(
        default=None,
        gt=0,
        description="Current clock timestamp in epoch ms (respecting simulated clock skew).",
    )
    chat_url: Optional[str] = Field(
        default=None,
        max_length=2048,
        description="Source page URL for evidence metadata.",
    )
    is_streaming: bool = Field(
        default=False,
        description="True when the chat bubble is still mid-stream / half-written; incomplete messages are not extracted.",
    )

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be empty or whitespace-only")
        return v


class ExtractedPromise(BaseModel):
    model_config = ConfigDict(extra="forbid")

    company: Optional[str] = Field(
        default=None,
        description="Company associated with the commitment.",
    )
    promise: str = Field(
        ...,
        min_length=1,
        description="Concise summary or sentence describing the commitment.",
    )
    original_quote: str = Field(
        ...,
        min_length=1,
        description="Exact quote from the chat message supporting this promise.",
    )
    deadline_hours: Optional[float] = Field(
        default=None,
        ge=0.0,
        description="Hours from now_ms until due_ms, if a deadline was resolved.",
    )
    deadline_date: Optional[str] = Field(
        default=None,
        description="ISO 8601 timestamp of the resolved deadline.",
    )
    due_ms: Optional[int] = Field(
        default=None,
        description="Epoch milliseconds of the resolved deadline (relative to now_ms).",
    )
    condition: Optional[str] = Field(
        default=None,
        description="Conditional clause attached to the promise, if any.",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score in [0.0, 1.0].",
    )
    confidence_level: Literal["high", "medium", "low", "none"] = Field(
        ...,
        description="Categorical confidence tier derived from score.",
    )
    extraction_method: Literal["gemini", "offline"] = Field(
        ...,
        description="Extractor that produced this result.",
    )
    deadline_method: str = Field(
        default="none",
        description="Deadline parser rule matched (e.g. biz_days, biz_range, tomorrow, vague_shortly, none).",
    )
    raw_deadline: str = Field(
        default="",
        description="Exact substring matched for the deadline.",
    )


class ExtractResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_promise: bool = Field(
        ...,
        description="True if at least one actionable company commitment was detected.",
    )
    is_claim: bool = Field(
        default=False,
        description="True if the message claims a prior promise has been completed.",
    )
    extraction_method: Literal["gemini", "offline"] = Field(
        ...,
        description="Primary extraction method used for this response.",
    )
    promises: list[ExtractedPromise] = Field(
        default_factory=list,
        description="List of extracted commitments (empty if none detected).",
    )
    pii_masked: bool = Field(
        default=False,
        description="True if PII masking ran before an external AI call.",
    )
    prompt_injection_detected: bool = Field(
        default=False,
        description="True if prompt-injection guard flagged suspicious instructions.",
    )
    raw_text_hash: str = Field(
        ...,
        description="SHA-256 prefix (16 hex chars) of the original message.",
    )
    fallback_reason: Optional[str] = Field(
        default=None,
        description="If offline fallback was triggered despite Gemini config, explains why.",
    )


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "aftermath-live-backend"
    version: str = "0.1.0"
    gemini_configured: bool
    extraction_mode: Literal["gemini_with_offline_fallback", "offline_only"]


# ── /export schemas (dispute report contract) ───────────────────────────

LedgerState = Literal[
    "PROMISED",
    "CLAIMED",
    "OBSERVED",
    "VERIFIED",
    "OVERDUE",
    "CONTRADICTION",
]


class ClaimRecord(BaseModel):
    text: str = Field(..., min_length=1)
    at: Optional[int] = Field(default=None, gt=0)


class ObservationRecord(BaseModel):
    ok: bool
    note: Optional[str] = None
    at: Optional[int] = Field(default=None, gt=0)


class ExportLedgerItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int | str
    company: str = Field(..., min_length=1)
    promise: str = Field(..., min_length=1)
    due: Optional[int] = Field(default=None)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    condition: Optional[str] = None
    evidence: Optional[str] = None
    chat: Optional[str] = None
    created: Optional[int] = Field(default=None, gt=0)
    claimed: Optional[ClaimRecord] = None
    observed: Optional[ObservationRecord] = None
    verified: bool = False
    state: Optional[LedgerState] = None


class ExportRequest(BaseModel):
    items: list[ExportLedgerItem] = Field(default_factory=list)
    now_ms: Optional[int] = Field(default=None, gt=0)


class TimelineEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: Literal["PROMISED", "CLAIMED", "OBSERVED", "VERIFIED", "DEADLINE_PASSED"]
    timestamp_ms: Optional[int] = None
    timestamp_iso: Optional[str] = None
    detail: str


class ClaimVsObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claimed: bool
    claim_quote: Optional[str] = None
    claimed_at_ms: Optional[int] = None
    claimed_at: Optional[str] = None
    observed: bool
    observed_ok: Optional[bool] = None
    observation_note: Optional[str] = None
    observed_at_ms: Optional[int] = None
    observed_at: Optional[str] = None
    contradiction: bool


class ExportedDisputeCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int | str
    company: str
    state: LedgerState
    promise: str
    original_quote: Optional[str] = None
    condition: Optional[str] = None
    confidence: Optional[float] = None
    source_url: Optional[str] = None
    created_ms: Optional[int] = None
    created_at: Optional[str] = None
    due_ms: Optional[int] = None
    due_at: Optional[str] = None
    is_overdue: bool
    pii_masked: bool
    claim_vs_observation: ClaimVsObservation
    timeline: list[TimelineEvent]


class ExportSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contradictions: int = Field(..., description="Cases with state == CONTRADICTION.")
    overdue: int = Field(..., description="Cases where is_overdue is True (may overlap with CONTRADICTION).")
    verified: int = Field(..., description="Cases with state == VERIFIED.")
    open: int = Field(..., description="Open cases that are neither CONTRADICTION, VERIFIED, nor overdue.")


class ExportResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = "1.0"
    exported_at: str
    now_ms: int
    total_cases: int
    summary: ExportSummary
    cases: list[ExportedDisputeCase]
