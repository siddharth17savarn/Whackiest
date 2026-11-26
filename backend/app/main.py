"""
backend/app/main.py — FastAPI application for AFTERMATH LIVE (/health, /extract).
"""
from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .extractor import extract_promises
from .schemas import ExportRequest, ExportResponse, ExtractRequest, ExtractResponse, HealthResponse
from .services.exporter import build_export_response

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="AFTERMATH LIVE Backend",
    description="Promise extraction, deadline resolution, and security gateway for AFTERMATH LIVE.",
    version="0.1.0",
)

# Allow local Chrome extension & demo page requests during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
    """Service health and extraction mode check."""
    return HealthResponse(
        status="ok",
        gemini_configured=settings.gemini_configured,
        extraction_mode=(
            "gemini_with_offline_fallback"
            if settings.gemini_configured
            else "offline_only"
        ),
    )


@app.post("/extract", response_model=ExtractResponse, tags=["extraction"])
async def extract(
    payload: ExtractRequest,
    settings: Settings = Depends(get_settings),
) -> ExtractResponse:
    """Extract structured commitments, deadlines, conditions, and confidence scores."""
    return await extract_promises(payload, settings)


@app.post("/export", response_model=ExportResponse, tags=["export"])
async def export_dispute(payload: ExportRequest) -> ExportResponse:
    """Export PII-masked, chronologically ordered dispute evidence matching the report contract."""
    return build_export_response(payload)
