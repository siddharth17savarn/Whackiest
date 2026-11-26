"""
tests/test_deadline_parser.py — Stage 0 unit tests for shared/deadline_parser.py
and cross-language parity check with shared/deadline_parser.js.

Run with: py tests/test_deadline_parser.py
"""
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime

# Allow importing shared/ from repo root
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

from shared.deadline_parser import (
    DAY,
    HOUR,
    add_business_days,
    add_calendar_days,
    parse_deadline,
)


class TestDeadlineParser(unittest.TestCase):
    def setUp(self):
        # Fixed anchor: Thursday 2026-11-26 10:00:00 local time
        self.thu_morning = int(datetime(2026, 11, 26, 10, 0, 0).timestamp() * 1000)

    def test_add_business_days_thu_plus_1(self):
        res = datetime.fromtimestamp(add_business_days(self.thu_morning, 1) / 1000)
        self.assertEqual(res.weekday(), 4)  # Friday
        self.assertEqual(res.day, 27)
        self.assertEqual(res.hour, 18)

    def test_add_business_days_skips_weekend(self):
        res = datetime.fromtimestamp(add_business_days(self.thu_morning, 2) / 1000)
        self.assertEqual(res.weekday(), 0)  # Monday
        self.assertEqual(res.day, 30)
        self.assertEqual(res.hour, 18)

    def test_add_business_days_5(self):
        res = datetime.fromtimestamp(add_business_days(self.thu_morning, 5) / 1000)
        self.assertEqual(res.weekday(), 3)  # Thursday
        self.assertEqual(res.month, 12)
        self.assertEqual(res.day, 3)
        self.assertEqual(res.hour, 18)

    def test_add_business_days_zero(self):
        self.assertEqual(add_business_days(self.thu_morning, 0), self.thu_morning)

    def test_parse_biz_days_with_condition(self):
        r = parse_deadline(
            "Your refund will be processed within 5 business days, provided the return is scanned.",
            self.thu_morning,
        )
        self.assertEqual(r["method"], "biz_days")
        self.assertEqual(r["confidence"], 0.90)
        self.assertEqual(r["raw"], "within 5 business days")
        self.assertEqual(r["condition"], "provided the return is scanned")
        self.assertEqual(datetime.fromtimestamp(r["due"] / 1000).day, 3)

    def test_parse_biz_range(self):
        r = parse_deadline(
            "Your package will arrive within 3-5 business days.",
            self.thu_morning,
        )
        self.assertEqual(r["method"], "biz_range")
        self.assertEqual(r["confidence"], 0.80)
        self.assertEqual(r["due"], add_business_days(self.thu_morning, 5))

    def test_parse_biz_range_to(self):
        r = parse_deadline(
            "Expect a reply in 2 to 4 working days.",
            self.thu_morning,
        )
        self.assertEqual(r["method"], "biz_range")
        self.assertEqual(r["due"], add_business_days(self.thu_morning, 4))

    def test_parse_hours(self):
        r = parse_deadline("We will call you within 24 hours.", self.thu_morning)
        self.assertEqual(r["method"], "hours")
        self.assertEqual(r["confidence"], 0.90)
        self.assertEqual(r["due"], self.thu_morning + 24 * HOUR)

    def test_parse_tomorrow(self):
        r = parse_deadline("You will receive an update by tomorrow.", self.thu_morning)
        self.assertEqual(r["method"], "tomorrow")
        dt = datetime.fromtimestamp(r["due"] / 1000)
        self.assertEqual(dt.day, 27)
        self.assertEqual(dt.hour, 18)

    def test_parse_today_eod(self):
        r = parse_deadline("We will resolve this by end of day.", self.thu_morning)
        self.assertEqual(r["method"], "today")
        dt = datetime.fromtimestamp(r["due"] / 1000)
        self.assertEqual(dt.day, 26)
        self.assertEqual(dt.hour, 23)
        self.assertEqual(dt.minute, 59)

    def test_parse_by_monday(self):
        r = parse_deadline("Your ticket will be resolved by Monday.", self.thu_morning)
        self.assertEqual(r["method"], "by_day")
        dt = datetime.fromtimestamp(r["due"] / 1000)
        self.assertEqual(dt.weekday(), 0)
        self.assertEqual(dt.day, 30)
        self.assertEqual(dt.hour, 18)

    def test_parse_vague_shortly(self):
        r = parse_deadline("Our team will get back to you shortly.", self.thu_morning)
        self.assertEqual(r["method"], "vague_shortly")
        self.assertEqual(r["confidence"], 0.40)
        self.assertEqual(r["due"], self.thu_morning + 2 * DAY)

    def test_parse_respects_simulated_clock(self):
        sim_now = int(datetime(2030, 1, 7, 9, 0, 0).timestamp() * 1000)
        r = parse_deadline("Refund within 2 business days.", sim_now)
        dt = datetime.fromtimestamp(r["due"] / 1000)
        self.assertEqual(dt.year, 2030)
        self.assertEqual(dt.day, 9)

    def test_parse_no_deadline(self):
        r = parse_deadline("Hi, I am Priya from ShopKart Support.", self.thu_morning)
        self.assertIsNone(r["due"])
        self.assertEqual(r["confidence"], 0.0)
        self.assertEqual(r["method"], "none")

    def test_js_python_parity(self):
        phrases = [
            "Your refund will be processed within 5 business days, provided the return is scanned.",
            "Your package will arrive within 3-5 business days.",
            "Expect a reply in 2 to 4 working days.",
            "We will call you within 24 hours.",
            "You will receive an update by tomorrow.",
            "We will resolve this by end of day.",
            "Your ticket will be resolved by Monday.",
            "Our team will get back to you shortly.",
            "We will fix it ASAP.",
            "Hi, I am Priya from ShopKart Support.",
        ]
        js_script = (
            "const p = require('./shared/deadline_parser');"
            f"const phrases = {json.dumps(phrases)};"
            f"console.log(JSON.stringify(phrases.map(t => p.parseDeadline(t, {self.thu_morning}))));"
        )
        proc = subprocess.run(
            ["node", "-e", js_script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        js_results = json.loads(proc.stdout)
        for phrase, js_res in zip(phrases, js_results):
            py_res = parse_deadline(phrase, self.thu_morning)
            self.assertEqual(py_res["due"], js_res["due"], f"due mismatch for: {phrase}")
            self.assertEqual(py_res["method"], js_res["method"], f"method mismatch for: {phrase}")
            self.assertAlmostEqual(
                py_res["confidence"], js_res["confidence"], places=5,
                msg=f"confidence mismatch for: {phrase}",
            )
            self.assertEqual(
                py_res["condition"], js_res["condition"],
                msg=f"condition mismatch for: {phrase}",
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
