// Load the shipped manifest unchanged: permission-broadened fixtures can hide CSP regressions.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-csp-'));
const extension = resolve(process.env.TEST_EXTENSION || 'dist');
const output = resolve('verification/csp-browser.json');
const messages = [], errors = [], hits = [];
let context, server;
const result = {passed: false, shippedManifestUnmodified: true, actualLocalRequests: true};
const policyWarnings = () => [...new Set(messages.filter(text =>
  /content.security.policy|connect-src/i.test(text) && /invalid source|unrecognized|ignored/i.test(text)))];
const request = async url => {
  try {
    const response = await fetch(url, {credentials: 'omit', cache: 'no-store'});
    return {ok: response.ok, data: await response.json()};
  } catch {return {ok: false};}
};

try {
  server = createServer((req, res) => {
    hits.push({host: req.headers.host.split(':')[0], path: req.url});
    res.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': '*'});
    res.end(JSON.stringify({ok: true, path: req.url}));
  });
  await new Promise((done, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', done);});
  const {port} = server.address();
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP nubi-csp.invalid 127.0.0.1']});
  context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/__csp_fixture', route => route.fulfill({json: {ok: true, path: '/https'}}));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => messages.push(message.text()));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Log.enable');
  cdp.on('Log.entryAdded', ({entry}) => messages.push(entry.text));
  await page.goto(`chrome-extension://${id}/index.html`);
  await page.getByRole('button', {name: '대화 이력', exact: true}).waitFor();
  result.version = await page.evaluate(() => chrome.runtime.getManifest().version);
  assert.deepEqual(policyWarnings(), [], 'The installed extension must load without invalid CSP source warnings');

  for (const [name, realm] of [['page', page], ['worker', worker]]) {
    for (const host of ['localhost', '127.0.0.1']) {
      assert.deepEqual(await realm.evaluate(request, `http://${host}:${port}/${name}`), {ok: true, data: {ok: true, path: `/${name}`}});
    }
    assert.deepEqual(await realm.evaluate(request, 'https://aipro.sdsdev.co.kr/__csp_fixture'), {ok: true, data: {ok: true, path: '/https'}});
  }
  result.allowedConnections = ['page/localhost', 'page/127.0.0.1', 'page/https', 'worker/localhost', 'worker/127.0.0.1', 'worker/https'];

  await page.evaluate(() => {
    window.testCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.testCspViolations.push({directive: event.effectiveDirective, blocked: event.blockedURI}));
  });
  const remoteHttp = `http://nubi-csp.invalid:${port}/mcp`;
  await context.route(remoteHttp, route => route.fulfill({json:{ok:true,path:'/mcp'},headers:{'access-control-allow-origin':'*'}}));
  assert.equal((await page.evaluate(request, remoteHttp)).ok, true);
  assert.deepEqual(await page.evaluate(() => window.testCspViolations), []);
  // HTTP transport is allowed by CSP. The MCP worker independently requires a
  // user-granted exact host and pins all transport requests to its endpoint.
  result.nonLoopbackHttpAllowedByCsp = true;

  // The callback document shares the same policy but is a different entry point.
  await page.goto(`chrome-extension://${id}/auth-return.html`);
  assert.deepEqual(policyWarnings(), [], 'The callback document must also load without CSP parser warnings');
  assert.deepEqual(errors, []);
  result.passed = true;
  console.log('PASS shipped CSP parses without warnings, page/worker loopback and HTTPS work, HTTP/HTTPS transport is allowed without CSP parser warnings');
} finally {
  result.policyWarnings = policyWarnings(); result.errors = errors;
  await mkdir('verification', {recursive: true});
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  await context?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise(done => server.close(done));
  await rm(profile, {recursive: true, force: true});
}
