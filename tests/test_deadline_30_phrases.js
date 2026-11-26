/**
 * tests/test_deadline_30_phrases.js — Verifies all 30 deadline phrases in JS.
 * Run with: node tests/test_deadline_30_phrases.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const parser = require('../shared/deadline_parser');

const cases = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'deadline_30_phrases.json'), 'utf8')
);

const thuAnchor = new Date(2026, 10, 26, 10, 0, 0, 0).getTime();

function fmtLocal(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

let passed = 0;
let failed = 0;

for (const c of cases) {
  try {
    const res = parser.parseDeadline(c.phrase, thuAnchor);
    assert.strictEqual(res.method, c.expected_method, `method mismatch`);
    assert(Math.abs(res.confidence - c.expected_confidence) < 1e-6, `confidence mismatch: ${res.confidence}`);
    assert.strictEqual(fmtLocal(res.due), c.expected_date, `date mismatch`);
    if (c.ambiguous) {
      assert(res.confidence < 0.55, 'ambiguous phrase must have low confidence');
    } else {
      assert(res.confidence >= 0.75, 'concrete phrase must have >= 0.75 confidence');
    }
    passed++;
    console.log(`  PASS  #${c.id} [${c.expected_method}] ${c.phrase}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  #${c.id} ${c.phrase}: ${err.message}`);
  }
}

console.log(`\n30-Phrase JS Results: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
