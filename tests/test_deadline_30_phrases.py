"""
tests/test_deadline_30_phrases.py — Verifies all 30 deadline phrases in Python
and asserts 100% parity with shared/deadline_parser.js.

Run with: py -m pytest tests/test_deadline_30_phrases.py -v
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from shared.deadline_parser import parse_deadline  # noqa: E402

THU_MS = int(datetime(2026, 11, 26, 10, 0, 0).timestamp() * 1000)
CASES = json.loads((REPO_ROOT / "tests" / "deadline_30_phrases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[f"case_{c['id']}" for c in CASES])
def test_30_phrases_python(case: dict):
    res = parse_deadline(case["phrase"], THU_MS)
    assert res["method"] == case["expected_method"]
    assert abs(res["confidence"] - case["expected_confidence"]) < 1e-6
    formatted = datetime.fromtimestamp(res["due"] / 1000).strftime("%Y-%m-%d %H:%M:%S")
    assert formatted == case["expected_date"]
    if case["ambiguous"]:
        assert res["confidence"] < 0.55
    else:
        assert res["confidence"] >= 0.75


def test_30_phrases_js_python_parity():
    phrases = [c["phrase"] for c in CASES]
    js_script = (
        "const p = require('./shared/deadline_parser');"
        f"const phrases = {json.dumps(phrases)};"
        f"console.log(JSON.stringify(phrases.map(t => p.parseDeadline(t, {THU_MS}))));"
    )
    proc = subprocess.run(
        ["node", "-e", js_script],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    js_results = json.loads(proc.stdout)
    for case, js_res in zip(CASES, js_results):
        py_res = parse_deadline(case["phrase"], THU_MS)
        assert py_res["due"] == js_res["due"], f"due mismatch on #{case['id']}"
        assert py_res["method"] == js_res["method"], f"method mismatch on #{case['id']}"
        assert abs(py_res["confidence"] - js_res["confidence"]) < 1e-6
