import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {verificationTextFeedback} from '../verification-text-feedback.js';
import {parse} from 'acorn';
import {refreshBrowserPolicy} from '../browser-policy.js';
import {browserURL, sourceURL, exactBrowserURL, compareBrowserURL, URL_VERIFICATION_GUIDE} from '../browser-url.js';
import {verificationDiagnostic} from '../completion-errors.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

globalThis.chrome = {storage: {managed: {get: async () => ({})}}};
await refreshBrowserPolicy();

test('URL mismatch feedback explains exact identity without returning URL values', () => {
  const cases = [
    ['https://example.test/', 'https://other.test/', 'url_origin_mismatch'],
    ['https://example.test/one', 'https://example.test/two', 'url_path_mismatch'],
    ['https://example.test/?page=1', 'https://example.test/?page=2', 'url_query_mismatch'],
    ['https://example.test/?a=1&b=2', 'https://example.test/?b=2&a=1', 'url_query_mismatch'],
    ['https://example.test/?a=1', 'https://example.test/?a=1&a=1', 'url_query_mismatch'],
    ['https://example.test/#one', 'https://example.test/#two', 'url_fragment_mismatch'],
    ['https://example.test/', 'https://example.test/?', 'url_identity_mismatch'],
    ['not a URL', 'https://example.test/', 'url_expected_invalid'],
    ['https://example.test/', 'not a URL', 'url_actual_invalid'],
    ['file:///private/file', 'https://example.test/', 'url_expected_restricted'],
    ['https://example.test/', 'https://user:PRIVATE_CREDENTIAL@example.test/', 'url_actual_restricted'],
  ];
  for (const [expected, actual, reason] of cases) {
    const result = compareBrowserURL(expected, actual);
    assert.equal(result.passed, false); assert.equal(result.reason, reason);
    assert.equal(exactBrowserURL(expected, actual), false);
    assert(!JSON.stringify(result).includes('PRIVATE_'));
    assert(!JSON.stringify(result).includes('example.test'));
    assert.deepEqual(verificationDiagnostic({checks: [{kind: 'url_is', ...result, expected, actual}]}), [{kind: 'url_is', passed: false, reason}]);
  }
  assert.deepEqual(compareBrowserURL('https://EXAMPLE.test:443/a', 'https://example.test/a'), {passed: true});
  assert.deepEqual(compareBrowserURL('https://example.test/?token=PRIVATE_QUERY#PRIVATE_HASH', 'https://example.test/?token=PRIVATE_QUERY#PRIVATE_HASH'), {passed: true});
  assert.equal(compareBrowserURL('https://example.test/', 'https://example.test/?token=PRIVATE_QUERY').redactedDifference, true);
  assert.deepEqual(verificationDiagnostic({checks: [{kind: 'url_is', passed: false, reason: 'PRIVATE_REASON'}]}), [{kind: 'url_is', passed: false}]);
});

const source = await readFile(new URL('../browser-agent.js', import.meta.url), 'utf8');
const declaration = parse(source, {ecmaVersion: 'latest', sourceType: 'module'}).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'verifyPage');
async function verify(actual, checks) {
  let now = 0;
  const frame = {url: () => actual, evaluateHandle: async () => ({evaluate: async () => checks.filter(check => check.kind === 'text_present').map(() => true), dispose: async () => {}})};
  const task = {app: {}, page: {url: () => actual, frames: () => [frame]}};
  const context = vm.createContext({verificationTextFeedback, active: task, browserURL, compareBrowserURL, URL_VERIFICATION_GUIDE,
    safeURL: sourceURL, MAX_PAGE_CHECKS: 20, MAX_FIELD_VALUE_CHARS: 4000,
    Date: {now: () => now}, delay: async ms => {now += Math.max(ms, 1);}, collectSnapshot() {},
    observe: async () => ({url: sourceURL(actual), frames: []})});
  vm.runInContext(source.slice(declaration.start, declaration.end), context);
  return context.verifyPage(task, checks);
}

test('actual verification function keeps text passes and URL failure separate with typed redaction guidance', async () => {
  const actual = 'https://example.test/search?query=PRIVATE_QUERY#PRIVATE_HASH';
  const result = await verify(actual, [{kind: 'url_is', expected: 'https://example.test/search'}, {kind: 'text_present', expected: 'Observed result'}]);
  assert.equal(result.verified, false); assert.equal(result.error, 'verification_failed');
  assert.equal(result.checks[0].reason, 'url_query_mismatch'); assert.equal(result.checks[0].redactedDifference, true);
  assert.equal(result.checks[1].passed, true);
  assert.match(result.checks[0].instruction, /Preserve every original requirement/);
  assert(!JSON.stringify(result).includes('PRIVATE_'));
  const exact = await verify(actual, [{kind: 'url_is', expected: actual}]);
  assert.equal(exact.verified, true); assert.equal(exact.checks[0].passed, true);
  assert(!JSON.stringify(exact).includes('PRIVATE_'));
});

test('actual conditional wait branch preserves a URL failure reason without final success or exposed values', async () => {
  let branch;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'IfStatement' && source.slice(node.start, node.start + 56).startsWith("if (name === 'wait_page' &&")) branch = node;
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
  };
  visit(parse(source, {ecmaVersion: 'latest', sourceType: 'module'}));
  assert(branch);
  const context = vm.createContext({name: 'wait_page', task: {tabId: 1}, URL_VERIFICATION_GUIDE,
    args: {condition: {kind: 'url_is', expected: 'https://example.test/search'}, timeout_ms: 250},
    verifyPage: async (_task, checks) => verify('https://example.test/search?token=PRIVATE_WAIT', checks)});
  const {result} = await vm.runInContext(`(async () => {${source.slice(branch.start, branch.end)}})()`, context);
  assert.equal(result.wait.matched, false); assert.equal(result.wait.timedOut, true);
  assert.equal(result.wait.reason, 'url_query_mismatch'); assert.equal(result.actionIssued, false);
  assert.equal(result.verified, undefined);
  assert.match(result.instruction, /never drop an explicitly required URL/);
  assert(!JSON.stringify(result).includes('PRIVATE_'));
});

test('URL tool contracts consistently describe full identity and retain the original goal', () => {
  const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
  for (const name of ['verify_page', 'wait_page']) {
    const description = tools.find(tool => tool.function.name === name).function.description;
    assert.match(description, /complete normalized HTTP\(S\) URL.*query and fragment/);
    assert.match(description, /Display URLs are redacted; never reconstruct/);
    assert.match(description, /mismatch is not action failure/);
    assert.match(description, /do not drop required resource identity or replay writes/);
    assert(!description.includes(URL_VERIFICATION_GUIDE), 'full recovery guidance belongs in actual failure results, not every schema');
    assert(!description.includes('exact HTTP(S) origin/path'));
    assert(!description.includes('redacted URL condition'));
  }
});

test('url_page_is compares origin and path only and never leaks URL values', async () => {
  const {comparePageURL} = await import('../browser-url.js');
  assert.deepEqual(comparePageURL('https://search.example.test/search', 'https://search.example.test/search?query=PRIVATE_QUERY#top'), {passed: true});
  assert.deepEqual(comparePageURL('https://search.example.test/search?x=1', 'https://search.example.test/search?x=2'), {passed: true});
  for (const [expected, actual, reason] of [['https://a.example.test/s', 'https://b.example.test/s', 'url_origin_mismatch'],
    ['https://a.example.test/s', 'https://a.example.test/t?q=PRIVATE_QUERY', 'url_path_mismatch'], ['nope', 'https://a.example.test/', 'url_expected_invalid'],
    ['https://a.example.test/', 'file:///private', 'url_actual_restricted']]) {
    const result = comparePageURL(expected, actual);
    assert.deepEqual(result, {passed: false, reason}); assert(!JSON.stringify(result).includes('PRIVATE_'));
    assert.deepEqual(verificationDiagnostic({checks: [{kind: 'url_page_is', ...result}]}), [{kind: 'url_page_is', passed: false, reason}]);
  }
  assert.equal(compareBrowserURL('https://search.example.test/search', 'https://search.example.test/search?query=1').passed, false);
  // Two videos share one path: the identifier shown in the display reference decides.
  assert.deepEqual(comparePageURL('https://www.youtube.com/watch?v=AAAAAAAAAAA', 'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=10s&pp=PRIVATE_QUERY'), {passed: true});
  assert.deepEqual(comparePageURL('https://www.youtube.com/watch?v=AAAAAAAAAAA', 'https://www.youtube.com/watch?v=BBBBBBBBBBB&pp=PRIVATE_QUERY'), {passed: false, reason: 'url_identifier_mismatch'});
  assert.deepEqual(verificationDiagnostic({checks: [{kind: 'url_page_is', passed: false, reason: 'url_identifier_mismatch'}]}), [{kind: 'url_page_is', passed: false, reason: 'url_identifier_mismatch'}]);
  const verify = browserTools({allowFill: true}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).find(tool => tool.function.name === 'verify_page');
  assert(JSON.stringify(verify.function.parameters).includes('url_page_is'));
  assert.match(verify.function.description, /url_page_is/); assert.match(URL_VERIFICATION_GUIDE, /url_page_is/);
});
