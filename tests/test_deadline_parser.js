/**
 * tests/test_deadline_parser.js — Stage 0 unit tests for shared/clock.js & shared/deadline_parser.js
 *
 * Run with: node tests/test_deadline_parser.js
 */
'use strict';

const assert = require('assert');
const clock = require('../shared/clock');
const parser = require('../shared/deadline_parser');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
  }
}

async function main() {
  console.log('Running JS shared/clock & shared/deadline_parser tests...\n');

  // Fixed anchor: Thursday 2026-11-26 10:00:00 local time
  const thuMorning = new Date(2026, 10, 26, 10, 0, 0, 0).getTime();

  // ── Clock tests ──────────────────────────────────────────────────
  await test('clock.nowSync() respects setSkew() and resetSkew()', () => {
    clock.resetSkew();
    const t0 = clock.nowSync();
    clock.setSkew(3 * parser.DAY);
    const t1 = clock.nowSync();
    assert(t1 - t0 >= 3 * parser.DAY - 50, 'Expected +3 days skew');
    clock.resetSkew();
  });

  await test('clock.now() returns Promise resolving with skew applied', async () => {
    clock.setSkew(2 * parser.HOUR);
    const t = await clock.now();
    assert(t >= Date.now() + 2 * parser.HOUR - 50, 'Expected +2 hours skew');
    clock.resetSkew();
  });

  // ── Business-day math tests ──────────────────────────────────────
  await test('addBusinessDays: Thu + 1 biz day = Fri 18:00', () => {
    const res = new Date(parser.addBusinessDays(thuMorning, 1));
    assert.strictEqual(res.getDay(), 5); // Friday
    assert.strictEqual(res.getDate(), 27);
    assert.strictEqual(res.getHours(), 18);
  });

  await test('addBusinessDays: Thu + 2 biz days skips Sat/Sun = Mon 18:00', () => {
    const res = new Date(parser.addBusinessDays(thuMorning, 2));
    assert.strictEqual(res.getDay(), 1); // Monday
    assert.strictEqual(res.getDate(), 30);
    assert.strictEqual(res.getHours(), 18);
  });

  await test('addBusinessDays: Thu + 5 biz days = next Thu Dec 3 18:00 (not +7 calendar days)', () => {
    const res = new Date(parser.addBusinessDays(thuMorning, 5));
    assert.strictEqual(res.getDay(), 4); // Thursday
    assert.strictEqual(res.getMonth(), 11); // December
    assert.strictEqual(res.getDate(), 3);
    assert.strictEqual(res.getHours(), 18);
  });

  await test('addBusinessDays: 0 days returns fromMs unchanged', () => {
    assert.strictEqual(parser.addBusinessDays(thuMorning, 0), thuMorning);
  });

  // ── Deadline parsing tests ───────────────────────────────────────
  await test('parseDeadline: "within 5 business days" with condition', () => {
    const r = parser.parseDeadline(
      'Your refund will be processed within 5 business days, provided the return is scanned.',
      thuMorning
    );
    assert.strictEqual(r.method, 'biz_days');
    assert.strictEqual(r.confidence, 0.9);
    assert.strictEqual(r.raw, 'within 5 business days');
    assert.strictEqual(r.condition, 'provided the return is scanned');
    assert.strictEqual(new Date(r.due).getDate(), 3);
  });

  await test('parseDeadline: "within 3-5 business days" uses upper bound (5)', () => {
    const r = parser.parseDeadline(
      'Your package will arrive within 3-5 business days.',
      thuMorning
    );
    assert.strictEqual(r.method, 'biz_range');
    assert.strictEqual(r.confidence, 0.8);
    assert.strictEqual(r.due, parser.addBusinessDays(thuMorning, 5));
  });

  await test('parseDeadline: "in 2 to 4 working days"', () => {
    const r = parser.parseDeadline(
      'Expect a reply in 2 to 4 working days.',
      thuMorning
    );
    assert.strictEqual(r.method, 'biz_range');
    assert.strictEqual(r.due, parser.addBusinessDays(thuMorning, 4));
  });

  await test('parseDeadline: "within 24 hours"', () => {
    const r = parser.parseDeadline('We will call you within 24 hours.', thuMorning);
    assert.strictEqual(r.method, 'hours');
    assert.strictEqual(r.confidence, 0.9);
    assert.strictEqual(r.due, thuMorning + 24 * parser.HOUR);
  });

  await test('parseDeadline: "by tomorrow"', () => {
    const r = parser.parseDeadline('You will receive an update by tomorrow.', thuMorning);
    assert.strictEqual(r.method, 'tomorrow');
    const d = new Date(r.due);
    assert.strictEqual(d.getDate(), 27);
    assert.strictEqual(d.getHours(), 18);
  });

  await test('parseDeadline: "by today" / "end of day"', () => {
    const r = parser.parseDeadline('We will resolve this by end of day.', thuMorning);
    assert.strictEqual(r.method, 'today');
    const d = new Date(r.due);
    assert.strictEqual(d.getDate(), 26);
    assert.strictEqual(d.getHours(), 23);
    assert.strictEqual(d.getMinutes(), 59);
  });

  await test('parseDeadline: "by Monday" from Thursday -> next Monday', () => {
    const r = parser.parseDeadline('Your ticket will be resolved by Monday.', thuMorning);
    assert.strictEqual(r.method, 'by_day');
    const d = new Date(r.due);
    assert.strictEqual(d.getDay(), 1);
    assert.strictEqual(d.getDate(), 30);
    assert.strictEqual(d.getHours(), 18);
  });

  await test('parseDeadline: vague "shortly" has low confidence 0.40', () => {
    const r = parser.parseDeadline('Our team will get back to you shortly.', thuMorning);
    assert.strictEqual(r.method, 'vague_shortly');
    assert.strictEqual(r.confidence, 0.4);
    assert.strictEqual(r.due, thuMorning + 2 * parser.DAY);
  });

  await test('parseDeadline: respects simulated clock (no Date.now() mixing)', () => {
    const simulatedNow = new Date(2030, 0, 7, 9, 0, 0, 0).getTime(); // Mon Jan 7 2030
    const r = parser.parseDeadline('Refund within 2 business days.', simulatedNow);
    const d = new Date(r.due);
    assert.strictEqual(d.getFullYear(), 2030);
    assert.strictEqual(d.getDate(), 9); // Wed Jan 9 2030
  });

  await test('parseDeadline: no deadline returns null due and confidence 0', () => {
    const r = parser.parseDeadline('Hi, I am Priya from ShopKart Support.', thuMorning);
    assert.strictEqual(r.due, null);
    assert.strictEqual(r.confidence, 0);
    assert.strictEqual(r.method, 'none');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main();
