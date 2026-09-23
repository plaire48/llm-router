import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {snapshot} from './files.mjs';

function localURL(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('preview_scope');
  return url.href;
}
export async function compare({taskId, beforeUrl, afterUrl, checks = []}) {
  this.ready(); beforeUrl = localURL(beforeUrl); afterUrl = localURL(afterUrl);
  if (!Array.isArray(checks) || checks.length > 20 || checks.some(c => typeof c.text !== 'string' || !c.text || c.text.length > 300 || typeof c.criterionId !== 'string')) throw new Error('checks_invalid');
  const root = await this.target(taskId), start = await snapshot(root), key = randomUUID();
  const dir = path.join(this.store.directory, 'comparisons', key); await mkdir(dir, {recursive: true});
  let browser;
  try { browser = await chromium.launch({headless: true}); }
  catch { browser = await chromium.launch({headless: true, channel: process.platform === 'win32' ? 'msedge' : 'chrome'}); }
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 800}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
    // Comparison pages may only contact loopback. Authenticated browser state is never copied.
    await context.route('**/*', route => { try {localURL(route.request().url()); return route.continue();} catch {return route.abort();} });
    const captured = [];
    for (const url of [beforeUrl, afterUrl]) {
      const page = await context.newPage(); const response = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 20000});
      if (!response?.ok()) throw new Error('preview_http_error');
      await page.evaluate(() => document.fonts.ready);
      const observed = [];
      for (const check of checks) observed.push({...check, observed: await page.getByText(check.text, {exact: false}).first().isVisible().catch(() => false)});
      captured.push({image: await page.screenshot({animations: 'disabled'}), url: page.url(), title: await page.title(), checks: observed}); await page.close();
    }
    const before = PNG.sync.read(captured[0].image), after = PNG.sync.read(captured[1].image), diff = new PNG({width: before.width, height: before.height});
    const changedPixels = pixelmatch(before.data, after.data, diff.data, before.width, before.height, {threshold: 0.1});
    await Promise.all([writeFile(path.join(dir, 'before.png'), captured[0].image), writeFile(path.join(dir, 'after.png'), captured[1].image), writeFile(path.join(dir, 'difference.png'), PNG.sync.write(diff))]);
    const finish = await snapshot(root), stale = start.fingerprint !== finish.fingerprint;
    const record = {id: key, taskId, createdAt: new Date().toISOString(), beforeUrl, afterUrl, changedPixels, totalPixels: before.width * before.height, viewport: {width: before.width, height: before.height}, source: {head: start.head, fingerprint: start.fingerprint}, state: stale ? 'stale' : 'captured', sourceAssociation: 'unverified', checks: captured[1].checks, directory: dir,
      note: '화면 차이만 비교한 결과입니다. 소스 버전과 로그인 상태, 데이터 조건은 별도 확인이 필요합니다.'};
    this.store.set('comparison:' + key, record); this.store.event('comparison_captured', {id: key, taskId, stale});
    return {...record, beforeImage: 'data:image/png;base64,' + captured[0].image.toString('base64'), afterImage: 'data:image/png;base64,' + captured[1].image.toString('base64'), diffImage: 'data:image/png;base64,' + PNG.sync.write(diff).toString('base64')};
  } finally { await browser.close(); }
}
