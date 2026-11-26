"""
backend/app/services/prompt_guard.py — Defense-in-depth prompt-injection protection.

Design layers (does not rely solely on keyword matching):
  1. Structural isolation: customer messages are wrapped in explicit
     <UNTRUSTED_SUPPORT_MESSAGE> delimiters, with any embedded closing/role
     delimiters neutralized before leaving the backend.
  2. Pattern + structural detection: identifies instruction-override attempts,
     system-prompt/API-key exfiltration, and role/tag breakout payloads.
  3. Clause sanitization: strips adversarial sentences/clauses while preserving
     legitimate promise sentences so extraction still succeeds safely.
  4. Output leakage guard: verifies model outputs never contain API keys,
     system prompt fragments, or environment secrets.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

_DELIMITER_BREAKOUT_RE = re.compile(
    r"(</?UNTRUSTED_SUPPORT_MESSAGE>|<\|im_start\|>|<\|im_end\|>|\[/?INST\]|^\s*(?:SYSTEM|ASSISTANT|DEVELOPER)\s*:)",
    re.IGNORECASE | re.MULTILINE,
)

_INJECTION_PATTERNS: list[tuple[str, re.Pattern]] = [
    (
        "instruction_override",
        re.compile(
            r"\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|rules?|prompts?|directives?)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "exfiltration_attempt",
        re.compile(
            r"\b(?:reveal|show|print|return|output|expose|leak|dump|tell me)\s+(?:your\s+|the\s+)?(?:system\s+prompt|api[_\s]?key|secret|credentials?|internal\s+config(?:uration)?|env(?:ironment)?\s+variables?)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "extraction_sabotage",
        re.compile(
            r"\b(?:do not|don't|stop)\s+extract(?:ing)?\b.*?\b(?:instead|execute|run|obey|follow)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "role_hijack",
        re.compile(
            r"\b(?:you are now|act as|pretend to be|new role:|switch to developer mode)\b",
            re.IGNORECASE,
        ),
    ),
]

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

# Patterns that must NEVER appear in model output
_SECRET_LEAK_RE = re.compile(
    r"(AIza[0-9A-Za-z\-_]{20,}|GEMINI_API_KEY|UNTRUSTED_SUPPORT_MESSAGE|You are a precise commitment extraction engine)",
    re.IGNORECASE,
)


@dataclass
class PromptGuardResult:
    sanitized_text: str
    injection_detected: bool
    reasons: list[str] = field(default_factory=list)


def inspect_and_sanitize(text: str) -> PromptGuardResult:
    """
    Detect prompt-injection attempts and return sanitized text with
    adversarial clauses removed while legitimate promise text is preserved.
    """
    if not text:
        return PromptGuardResult(sanitized_text=text, injection_detected=False)

    reasons: list[str] = []

    if _DELIMITER_BREAKOUT_RE.search(text):
        reasons.append("delimiter_breakout")

    for name, pat in _INJECTION_PATTERNS:
        if pat.search(text):
            reasons.append(name)

    if not reasons:
        return PromptGuardResult(sanitized_text=text, injection_detected=False)

    # Neutralize delimiter breakouts first
    cleaned = _DELIMITER_BREAKOUT_RE.sub(" ", text)

    # Filter out sentences that carry injection payloads while keeping legitimate sentences
    sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(cleaned) if s.strip()]
    safe_sentences: list[str] = []
    for sentence in sentences:
        is_bad = any(pat.search(sentence) for _, pat in _INJECTION_PATTERNS)
        if not is_bad:
            safe_sentences.append(sentence)

    sanitized = " ".join(safe_sentences).strip()
    return PromptGuardResult(
        sanitized_text=sanitized,
        injection_detected=True,
        reasons=reasons,
    )


def wrap_untrusted_message(text: str, company: Optional[str]) -> str:
    """Wrap sanitized customer message in explicit untrusted-data delimiters."""
    safe_company = (company or "Unknown").replace("<", "").replace(">", "")
    return (
        f"Company: {safe_company}\n"
        "<UNTRUSTED_SUPPORT_MESSAGE>\n"
        f"{text}\n"
        "</UNTRUSTED_SUPPORT_MESSAGE>"
    )


def contains_secret_leakage(output_text: str, *, api_key: Optional[str] = None) -> bool:
    """Return True if model output appears to leak secrets or system prompt."""
    if not output_text:
        return False
    if api_key and api_key.strip() and api_key.strip() in output_text:
        return True
    return bool(_SECRET_LEAK_RE.search(output_text))
