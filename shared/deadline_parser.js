/**
 * shared/deadline_parser.js — AFTERMATH LIVE deadline parser
 *
 * Pure-function module: every function takes `nowMs` as an argument,
 * so it never calls Date.now() on its own.  This eliminates the
 * mixed-clock bug where deadlines used real time while the ledger
 * used simulated time.
 *
 * Supported phrases (examples):
 *   "within 5 business days"        → addBusinessDays(now, 5)
 *   "3-5 business days"             → addBusinessDays(now, 5)   (upper bound)
 *   "within 3 days"                 → now + 3 * DAY
 *   "within 24 hours"               → now + 24 * HOUR
 *   "by tomorrow"                   → tomorrow 18:00
 *   "by today" / "end of day"       → today 23:59
 *   "by Monday" (any day name)      → next occurrence 18:00
 *   "shortly" / "soon" / "ASAP"     → now + 2 days (low confidence)
 *   "immediately" / "right away"    → now + 4 hours (low confidence)
 *
 * Usage:
 *   const { parseDeadline } = require('./shared/deadline_parser');
 *   const result = parseDeadline("within 5 business days", await now());
 *   // → { due: 1732..., confidence: 0.90, raw: "within 5 business days", method: "biz_days" }
 */
(function (root) {
  'use strict';

  /* ── constants ──────────────────────────────────────────────────── */
  const HOUR = 3600000;
  const DAY = 86400000;

  const DAYS = [
    'sunday', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday',
  ];

  const MONTHS = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  /* ── business-day arithmetic ────────────────────────────────────── */

  /**
   * Add `n` business days to `fromMs`, skipping weekends (Sat/Sun).
   * Result is set to 18:00 of the target day (end of business hours).
   *
   * @param {number} fromMs   epoch ms to start from
   * @param {number} n        number of business days to add (≥ 0)
   * @returns {number}        epoch ms of the target date at 18:00 local
   */
  function addBusinessDays(fromMs, n) {
    if (n <= 0) return fromMs;
    const date = new Date(fromMs);
    let added = 0;
    while (added < n) {
      date.setDate(date.getDate() + 1);
      const dow = date.getDay();
      if (dow !== 0 && dow !== 6) {
        added++;
      }
    }
    date.setHours(18, 0, 0, 0);
    return date.getTime();
  }

  /**
   * Add `n` calendar days to `fromMs`.
   * Result is set to 23:59 of the target day.
   *
   * @param {number} fromMs
   * @param {number} n
   * @returns {number}
   */
  function addCalendarDays(fromMs, n) {
    const date = new Date(fromMs);
    date.setDate(date.getDate() + n);
    date.setHours(23, 59, 59, 0);
    return date.getTime();
  }

  /* ── pattern definitions ────────────────────────────────────────── */

  /**
   * Each pattern has:
   *   regex      — matched against the input text
   *   handler    — (match, nowMs) → { due, confidence, method }
   *
   * Ordered from most specific to least specific so the first match wins.
   */
  const PATTERNS = [
    // ── ranges with "business/working" ──
    {
      // "within 3-5 business days" / "in 3 to 5 working days"
      regex: /(?:within|in|next)\s+(\d+)\s*[-–to]+\s*(\d+)\s+(?:business|working)\s*days?/i,
      handler: function (m, nowMs) {
        const upper = parseInt(m[2], 10);
        return { due: addBusinessDays(nowMs, upper), confidence: 0.80, method: 'biz_range' };
      },
    },
    {
      // "3-5 business days" (no "within")
      regex: /(\d+)\s*[-–to]+\s*(\d+)\s+(?:business|working)\s*days?/i,
      handler: function (m, nowMs) {
        const upper = parseInt(m[2], 10);
        return { due: addBusinessDays(nowMs, upper), confidence: 0.80, method: 'biz_range' };
      },
    },
    // ── exact business/working days ──
    {
      // "within 5 business days" / "in 5 working days"
      regex: /(?:within|in|next)\s+(\d+)\s+(?:business|working)\s*days?/i,
      handler: function (m, nowMs) {
        return { due: addBusinessDays(nowMs, parseInt(m[1], 10)), confidence: 0.90, method: 'biz_days' };
      },
    },
    {
      // "5 business days" (no preposition)
      regex: /(\d+)\s+(?:business|working)\s*days?/i,
      handler: function (m, nowMs) {
        return { due: addBusinessDays(nowMs, parseInt(m[1], 10)), confidence: 0.85, method: 'biz_days' };
      },
    },
    // ── calendar-day ranges ──
    {
      regex: /(?:within|in|next)\s+(\d+)\s*[-–to]+\s*(\d+)\s+(?:calendar\s*)?days?/i,
      handler: function (m, nowMs) {
        const upper = parseInt(m[2], 10);
        return { due: addCalendarDays(nowMs, upper), confidence: 0.80, method: 'cal_range' };
      },
    },
    {
      regex: /(\d+)\s*[-–to]+\s*(\d+)\s+(?:calendar\s*)?days?/i,
      handler: function (m, nowMs) {
        const upper = parseInt(m[2], 10);
        return { due: addCalendarDays(nowMs, upper), confidence: 0.75, method: 'cal_range' };
      },
    },
    // ── exact calendar days ──
    {
      regex: /(?:within|in|next)\s+(\d+)\s+(?:calendar\s*)?days?/i,
      handler: function (m, nowMs) {
        return { due: addCalendarDays(nowMs, parseInt(m[1], 10)), confidence: 0.90, method: 'cal_days' };
      },
    },
    // ── hours ──
    {
      regex: /(?:within|in|next)\s+(\d+)\s+hours?/i,
      handler: function (m, nowMs) {
        return { due: nowMs + parseInt(m[1], 10) * HOUR, confidence: 0.90, method: 'hours' };
      },
    },
    {
      regex: /(\d+)\s+hours?/i,
      handler: function (m, nowMs) {
        return { due: nowMs + parseInt(m[1], 10) * HOUR, confidence: 0.80, method: 'hours' };
      },
    },
    // ── relative day words ──
    {
      regex: /\b(?:by\s+)?tomorrow\b/i,
      handler: function (_m, nowMs) {
        const d = new Date(nowMs);
        d.setDate(d.getDate() + 1);
        d.setHours(18, 0, 0, 0);
        return { due: d.getTime(), confidence: 0.90, method: 'tomorrow' };
      },
    },
    {
      regex: /\b(?:by\s+)?(?:today|end of (?:the )?day|EOD)\b/i,
      handler: function (_m, nowMs) {
        const d = new Date(nowMs);
        d.setHours(23, 59, 59, 0);
        return { due: d.getTime(), confidence: 0.85, method: 'today' };
      },
    },
    // ── explicit ISO date (YYYY-MM-DD) ──
    {
      regex: /\b(?:by|on|before)\s+(\d{4})-(\d{2})-(\d{2})\b/i,
      handler: function (m) {
        const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 18, 0, 0, 0);
        return { due: d.getTime(), confidence: 0.92, method: 'explicit_date' };
      },
    },
    // ── explicit Month Day[, Year] (e.g., "by Dec 5" / "on December 5, 2026") ──
    {
      regex: /\b(?:by|on|before)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i,
      handler: function (m, nowMs) {
        const ref = new Date(nowMs);
        const month = MONTHS[m[1].toLowerCase()];
        const day = parseInt(m[2], 10);
        const year = m[3] ? parseInt(m[3], 10) : ref.getFullYear();
        const d = new Date(year, month, day, 18, 0, 0, 0);
        if (!m[3] && d.getTime() < nowMs) d.setFullYear(year + 1);
        return { due: d.getTime(), confidence: 0.90, method: 'explicit_date' };
      },
    },
    // ── explicit Day Month[, Year] (e.g., "by 5 Dec" / "on 5th December 2026") ──
    {
      regex: /\b(?:by|on|before)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(\d{4}))?\b/i,
      handler: function (m, nowMs) {
        const ref = new Date(nowMs);
        const day = parseInt(m[1], 10);
        const month = MONTHS[m[2].toLowerCase()];
        const year = m[3] ? parseInt(m[3], 10) : ref.getFullYear();
        const d = new Date(year, month, day, 18, 0, 0, 0);
        if (!m[3] && d.getTime() < nowMs) d.setFullYear(year + 1);
        return { due: d.getTime(), confidence: 0.90, method: 'explicit_date' };
      },
    },
    // ── weeks ──
    {
      regex: /(?:within|in|next)\s+(\d+|a|one)\s+weeks?/i,
      handler: function (m, nowMs) {
        const n = /^(a|one)$/i.test(m[1]) ? 1 : parseInt(m[1], 10);
        return { due: addCalendarDays(nowMs, n * 7), confidence: 0.85, method: 'weeks' };
      },
    },
    // ── by day-of-week ──
    {
      regex: /by\s+(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i,
      handler: function (m, nowMs) {
        const target = DAYS.indexOf(m[1].toLowerCase());
        const d = new Date(nowMs);
        const current = d.getDay();
        const delta = ((target - current + 7) % 7) || 7; // at least 1 day ahead
        d.setDate(d.getDate() + delta);
        d.setHours(18, 0, 0, 0);
        return { due: d.getTime(), confidence: 0.85, method: 'by_day' };
      },
    },
    // ── vague / qualitative ──
    {
      regex: /\b(?:within|in)\s+(?:a\s+)?(?:few|couple\s+of)\s+days\b/i,
      handler: function (_m, nowMs) {
        return { due: nowMs + 3 * DAY, confidence: 0.40, method: 'vague_few_days' };
      },
    },
    {
      regex: /\b(?:immediately|right away)\b/i,
      handler: function (_m, nowMs) {
        return { due: nowMs + 4 * HOUR, confidence: 0.50, method: 'vague_immediate' };
      },
    },
    {
      regex: /\b(?:shortly|soon|at the earliest|in due course)\b/i,
      handler: function (_m, nowMs) {
        return { due: nowMs + 2 * DAY, confidence: 0.40, method: 'vague_shortly' };
      },
    },
    {
      regex: /\b(?:as soon as possible|ASAP)\b/i,
      handler: function (_m, nowMs) {
        return { due: nowMs + 1 * DAY, confidence: 0.35, method: 'vague_asap' };
      },
    },
  ];

  /* ── condition extraction ───────────────────────────────────────── */

  const CONDITION_RE = /\b(provided|if|once|subject to|after|assuming|as long as|when)\b[^.]*/i;

  /**
   * Extract a conditional clause from text, if present.
   * @param {string} text
   * @returns {string|null}
   */
  function extractCondition(text) {
    const m = text.match(CONDITION_RE);
    return m ? m[0].trim() : null;
  }

  /* ── main parser ────────────────────────────────────────────────── */

  /**
   * Parse a deadline from free-form text.
   *
   * @param {string}  text   the agent message or sentence
   * @param {number}  nowMs  current epoch ms (from AftermathClock.now())
   * @returns {{ due: number|null, confidence: number, raw: string, method: string, condition: string|null }}
   */
  function parseDeadline(text, nowMs) {
    if (!text || typeof text !== 'string') {
      return { due: null, confidence: 0, raw: '', method: 'none', condition: null };
    }

    for (const pattern of PATTERNS) {
      const m = text.match(pattern.regex);
      if (m) {
        const result = pattern.handler(m, nowMs);
        return {
          due: result.due,
          confidence: result.confidence,
          raw: m[0],
          method: result.method,
          condition: extractCondition(text),
        };
      }
    }

    // No deadline phrase found
    return {
      due: null,
      confidence: 0,
      raw: '',
      method: 'none',
      condition: extractCondition(text),
    };
  }

  /* ── export ──────────────────────────────────────────────────────── */

  const exports = {
    parseDeadline,
    addBusinessDays,
    addCalendarDays,
    extractCondition,
    // constants for tests
    HOUR,
    DAY,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.AftermathDeadline = exports;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
