import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {buildGraph} from '../../../../packages/openwiki/dist/visualize/graph.js';
import {createNubiApi} from '../../../../packages/openwiki/dist/visualize/nubi.js';
import {createRequestHandler} from '../../../../packages/openwiki/dist/visualize/server.js';

/** Real server and filesystem, with synthetic project data only. Build OpenWiki
 * before using this fixture; no provider login or repository scan is started. */
export async function startOpenWikiFixture({source = true, legacy = false, pairing = true} = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'nubi-openwiki-fixture-'));
  const projectRoot = resolve(directory, 'Checkout demo');
  const wikiRoot = resolve(projectRoot, 'openwiki');
  const sourcePath = resolve(projectRoot, 'src/CheckoutButton.tsx');
  await mkdir(wikiRoot, {recursive: true});
  await mkdir(resolve(projectRoot, 'src'), {recursive: true});
  const sourceText = label => [
    'export function CheckoutButton() {',
    `  const label = '${label}';`,
    '  return <button type="button">{label}</button>;',
    '}',
    '',
    '// This fixture contains no payment operation.',
    '// The user reviews the checkout before continuing.',
    '// Component: CheckoutButton',
    '// Route: /checkout',
    '// Scope: demonstration project',
    '// Source is reread for every request.',
    '// End of fixture.',
    '',
  ].join('\n');
  await writeFile(sourcePath, sourceText('Review checkout'));
  await writeFile(resolve(wikiRoot, 'checkout.md'), '---\ntitle: Checkout overview\ntype: Reference\ndescription: Checkout UI and code\n---\n# Checkout\n\nThe CheckoutButton component lives in src/CheckoutButton.tsx.\nIt presents a review button and does not submit payments.\n');
  const graph = await buildGraph(wikiRoot);
  const nubi = await createNubiApi({wikiRoot, ...(source ? {projectRoot} : {}), getGraph: () => graph});
  const sseClients = new Set();
  const handler = createRequestHandler({getGraph: () => graph, clientJs: '', clientLibJs: '', stylesCss: '', sseClients, nubi});
  const secrets = new Set();
  let pairCount = 0, readCount = 0, sourceReadCount = 0, stopped = false, closed = false, readFailure = null;
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/checkout') {
      // This application fixture is intentionally separate from the visualizer.
      // Its visible label comes from the same temporary file exposed by the
      // production project reader, so changing that source changes this page.
      void readFile(sourcePath, 'utf8').then(code => {
        const label = /const label = '([^']+)';/.exec(code)[1];
        res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
        res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Checkout demo</title><style>body{font:16px system-ui;padding:40px}button{padding:12px 20px}code{display:block;margin:20px 0}</style><main><h1>Checkout</h1><code>CheckoutButton</code><button type="button" data-component="CheckoutButton">${label}</button></main></html>`);
      }).catch(() => {res.writeHead(500); res.end('Fixture source unavailable');});
      return;
    }
    if (legacy && pathname.startsWith('/api/nubi/')) {res.writeHead(404); res.end('Not found'); return;}
    if (pathname === '/api/nubi/v1/pair') pairCount++;
    if (/^\/api\/nubi\/v1\/(?:wiki|source)(?:\/|$)/.test(pathname)) {
      readCount++;
      if (readFailure) {
        res.writeHead(readFailure, {'content-type':'text/html', 'www-authenticate':'Bearer realm="fixture"'});
        res.end('<html>Reference access rejected</html>'); return;
      }
    }
    if (pathname.startsWith('/api/nubi/v1/source')) sourceReadCount++;
    const end = res.end.bind(res);
    res.end = (chunk, ...args) => {
      if (typeof chunk === 'string') {
        const code = /<meta name="nubi-pairing-code" content="([^"]+)">/.exec(chunk)?.[1];
        if (code) secrets.add(code);
        if (!pairing) chunk = chunk.replace(/<meta name="nubi-pairing-code" content="[^"]+">\s*/g, '');
        if (pathname === '/api/nubi/v1/pair' && res.statusCode === 200) {
          const body = JSON.parse(chunk);
          if (body.token) secrets.add(body.token);
        }
      }
      return end(chunk, ...args);
    };
    handler(req, res);
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function stop() {
    if (stopped) return;
    stopped = true;
    for (const response of sseClients) response.end();
    await new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
  }
  return {
    origin,
    get pairCount() {return pairCount;},
    get readCount() {return readCount;},
    get sourceReadCount() {return sourceReadCount;},
    get secrets() {return [...secrets];},
    setReadFailure: status => {readFailure = status;},
    sourceHash: async () => createHash('sha256').update(await readFile(sourcePath)).digest('hex'),
    updateSource: () => writeFile(sourcePath, sourceText('Updated checkout')),
    stop,
    async close() {if (closed) return; closed = true; await stop(); await rm(directory, {recursive: true, force: true});},
  };
}
