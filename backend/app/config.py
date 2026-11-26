"""
backend/app/config.py — Environment-driven configuration.

Reads settings from environment variables and optional backend/.env file.
Never hardcodes API keys or secrets.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gemini_api_key: Optional[str] = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: float = 8.0
    confidence_threshold: float = 0.55

    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "INFO"

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_api_key.strip())


def get_settings() -> Settings:
    """Return a fresh Settings instance reflecting current environment variables."""
    return Settings()
