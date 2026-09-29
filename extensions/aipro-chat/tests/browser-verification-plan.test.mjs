import test from 'node:test';
import assert from 'node:assert/strict';
import {browserVerificationPlan, QUALITY_BASELINE, QUALITY_ONCE} from '../scripts/browser-verification-plan.mjs';
import {QUALITY_AREAS} from '../scripts/quality-scorecard.mjs';

const once = QUALITY_ONCE;
const repeated = QUALITY_BASELINE.filter(name => !once.includes(name));
const plan = options => browserVerificationPlan({repeated, once, repeats: 3, ...options});

test('quality baseline covers every scored area and Wiki/evidence regressions without claiming a full matrix', () => {
  const result = plan({args: ['--quality']});
  assert.equal(result.profile, 'quality-baseline-v8');
  assert.equal(result.fullMatrix, false);
  for (const suite of [...QUALITY_AREAS.flatMap(area => area.suites), ...once]) assert.ok(result.selection.includes(suite));
  assert.equal(new Set(result.selection).size, result.selection.length);
  for(const name of ['large-document-browser','trace-journal-browser','browser-policy-browser']) {assert(once.includes(name));assert(!repeated.includes(name));}
  for (const name of ['source-reference-browser','harness-seven-browser','review-recovery-browser','script-recovery-browser']) assert(repeated.includes(name));
  assert(once.includes('browser-dom-actionability-browser'));
  assert(repeated.includes('subagent-progress-browser'));
  assert(repeated.includes('uncertain-frame-browser'));
  assert(repeated.includes('full-page-captures-browser'));
  assert(repeated.includes('capture-coverage-browser'));
  assert.equal(repeated.length*3+once.length,107);
  assert.throws(() => plan({args: ['--quality'], once: once.slice(1)}), /unknown browser suite/);
});

test('fixed baseline rejects ambient filters and invalid options before running tests', () => {
  for (const suiteFilter of ['', 'context-browser']) assert.throws(() => plan({args: ['--quality'], suiteFilter}), /Clear NUBI_TEST_SUITES/);
  for (const args of [['--typo'], ['--quality', '--quality']]) assert.throws(() => plan({args}), /verification option/);
});

test('empty, duplicate or unknown filters cannot become a passing zero-test run', () => {
  for (const suiteFilter of ['', ' , ', 'context-browser,context-browser', 'unknown']) assert.throws(() => plan({suiteFilter}));
  assert.deepEqual(plan({suiteFilter: ' context-browser '}).selection, ['context-browser']);
  assert.equal(plan({suiteFilter: 'context-browser'}).fullMatrix, false);
  assert.equal(plan({}).fullMatrix, true);
  assert.equal(plan({repeats: 1}).fullMatrix, false);
});
