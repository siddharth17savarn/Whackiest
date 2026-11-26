"""
backend/run.py — Reproducible startup script for the AFTERMATH LIVE backend.

Usage (from repository root or backend/ directory):
    py backend/run.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import uvicorn

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.config import get_settings  # noqa: E402


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "backend.app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=False,
    )


if __name__ == "__main__":
    main()
