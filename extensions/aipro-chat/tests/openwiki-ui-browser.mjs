import {clickComposerAction} from './helpers/composer-actions.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chatgptToken} from './fixtures/chatgpt.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';
import {ERROR_TEXT} from '../core.js';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-project-ui-'));
const checks = [], errors = [], surfaces = [];
let context, ui;
const modal = () => ui.getByRole('dialog', {name: '프로젝트 연결', exact: true});
const open = async () => {
  const settings = ui.getByRole('dialog', {name: '설정', exact: true});
  const composer = ui.locator('.composer').getByRole('button', {name: '프로젝트 연결', exact: true, includeHidden: true});
  if (!await settings.count() && await composer.count()) {await clickComposerAction(ui, '프로젝트 연결'); return;}
  if (!await settings.count()) await ui.getByRole('button', {name: '설정', exact: true}).click();
  const folder = settings.locator('.wiki-folder-settings');
  if (await folder.getAttribute('open') === null) await folder.locator(':scope > summary').click();
  const server = settings.locator('.wiki-server-settings');
  if (await server.getAttribute('open') === null) await server.locator(':scope > summary').click();
  await settings.getByRole('button', {name: '프로젝트 연결', exact: true}).click();
};
const closeSettings = async () => {
  const settings = ui.getByRole('dialog', {name: '설정', exact: true});
  if (await settings.count()) await settings.getByRole('button', {name: '닫기', exact: true}).click();
};
const connect = () => modal().getByRole('button', {name: '프로젝트 연결', exact: true}).click();
async function snapshot(name, width, height) {
  await ui.evaluate(() => document.fonts.ready);
  const typography = await assertModalTypography(modal());
  const metrics = await modal().evaluate(el => {
    for (const animation of el.getAnimations()) animation.finish();
    const bounds = el.getBoundingClientRect(), style = getComputedStyle(el);
    return {width: bounds.width, within: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, opacity: style.opacity,
      overflow: document.documentElement.scrollWidth > innerWidth, unlabeled: [...el.querySelectorAll('button')].filter(b => !(b.getAttribute('aria-label') || b.textContent || b.title).trim()).length};
  });
  assert.equal(metrics.within, true, name); assert.equal(metrics.overflow, false, name); assert.equal(metrics.opacity, '1', name); assert.equal(metrics.unlabeled, 0, name);
  surfaces.push({name, width, height, typography, ...metrics});
  await ui.screenshot({path: `verification/openwiki-ui-${name}-${width}.png`, animations: 'disabled'});
}
try {
  await mkdir('verification', {recursive: true});
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`]});
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await worker.evaluate(token => chrome.storage.session.set({providerSessions: {chatgpt: {credential: {provider: 'chatgpt', token, receivedAt: 88, expiresAt: Date.now() + 3600000}}}}), chatgptToken());
  assert.equal((await ui.evaluate(() => chrome.runtime.sendMessage({type: 'SELECT_PROVIDER', provider: 'chatgpt'}))).ok, true);
  await ui.getByRole('button', {name: '모델 변경', exact: true}).waitFor();
  await ui.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.projectFixture = {candidate: null, project: null, permission: true, error: null, held: false, busy: false, calls: []};
    chrome.permissions.request = async options => {window.projectFixture.calls.push({permission: options}); return window.projectFixture.permission;};
    chrome.runtime.sendMessage = async message => {
      const f = window.projectFixture;
      if (message.type === 'GET_STATE') {const result = await original(message); if (result.ok) {result.data.project = f.project; result.data.serverProject = f.project; result.data.wikiFolder = null; result.data.busy ||= f.busy;} return result;}
      if (!message.type.startsWith('PROJECT_')) return original(message);
      f.calls.push(message);
      if (message.type === 'PROJECT_CANDIDATE') return {ok: true, data: {candidate: f.candidate}};
      if (f.held) await new Promise(resolve => {f.release = resolve;});
      if (f.error) return {ok: false, error: f.error};
      f.project = message.type === 'PROJECT_DISCONNECT' ? null : {id: 'project-example', name: '누비 브라우저 프로젝트', origin: message.origin, capabilities: ['wiki', 'source'], expiresAt: new Date(Date.now() + 3600000).toISOString(), status: 'connected'};
      return {ok: true, data: {project: f.project}};
    };
  });
  for (const [width, height] of [[320, 640], [360, 800], [1100, 850]]) {
    await ui.setViewportSize({width, height}); await open(); await modal().getByLabel('OpenWiki 주소').fill('http://localhost:34567');
    await snapshot('address', width, height); await ui.keyboard.press('Escape');
    assert.equal(await ui.evaluate(() => ['프로젝트 연결', '추가'].includes(document.activeElement?.getAttribute('aria-label'))), true);
    await ui.evaluate(() => {window.projectFixture.candidate = {origin: 'http://localhost:34567', tabId: 19, title: '누비 화면과 코드를 함께 확인하는 프로젝트'};});
    await open(); await modal().getByText('누비 화면과 코드를 함께 확인하는 프로젝트', {exact: true}).waitFor();
    assert.equal(await modal().locator('input').count(), 0);
    assert.equal(await modal().getByText(/localhost:/).count(), 0);
    await snapshot('candidate', width, height);
    await modal().getByRole('button', {name: '프로젝트 주소 변경', exact: true}).click();
    assert.equal(await modal().getByLabel('OpenWiki 주소').inputValue(), 'http://localhost:34567');
    await ui.keyboard.press('Escape');
    await ui.evaluate(() => {window.projectFixture.candidate = null;});
    checks.push(`${width}px address and proposed project fit, typography matches, Escape restores focus`);
  }
  await open(); await modal().getByLabel('OpenWiki 주소').fill('https://example.com'); await connect();
  await modal().getByRole('alert').waitFor();
  assert.equal(await ui.evaluate(() => window.projectFixture.calls.filter(call => call.permission).length), 0);
  await modal().getByLabel('OpenWiki 주소').fill('http://localhost:34567');
  await ui.evaluate(() => {window.projectFixture.permission = false;}); await connect();
  await modal().getByText(ERROR_TEXT.project_permission, {exact: true}).waitFor();
  assert.equal(await modal().getByLabel('OpenWiki 주소').inputValue(), 'http://localhost:34567');
  await ui.evaluate(() => {window.projectFixture.permission = true; window.projectFixture.error = 'project_unavailable';}); await connect();
  await modal().getByRole('alert').waitFor(); assert.equal(await modal().getByLabel('OpenWiki 주소').inputValue(), 'http://localhost:34567');
  checks.push('Invalid and denied origins do not connect; failed connections keep input and expose retry');
  await ui.evaluate(() => {window.projectFixture.error = null; window.projectFixture.held = true;}); await connect();
  await ui.waitForFunction(() => !!window.projectFixture.release);
  await ui.keyboard.press('Escape'); assert.equal(await modal().count(), 1);
  assert.equal(await modal().getByRole('button', {name: '닫기', exact: true}).isDisabled(), true);
  await ui.evaluate(() => {window.projectFixture.held = false; window.projectFixture.release();});
  await modal().waitFor({state: 'hidden'});
  // Check transient feedback before another click can wait for its dismissal.
  // The top notice can overlap the settings header in this tall-dialog fixture.
  await ui.getByText('프로젝트를 연결했습니다.', {exact: true}).waitFor();
  await ui.getByRole('button', {name: '알림 닫기', exact: true}).click();
  await closeSettings();
  await ui.getByRole('button', {name: '누비 브라우저 프로젝트 프로젝트 연결 보기', exact: true}).waitFor();
  assert.equal(await ui.locator('.composer-context').getByText(/localhost:/).count(), 0);
  const permissions = await ui.evaluate(() => window.projectFixture.calls.filter(call => call.permission).map(call => call.permission.origins));
  assert(permissions.every(origins => origins.length === 1 && origins[0] === 'http://localhost:34567/*'));
  await open(); await snapshot('connected', 1100, 850);
  assert.equal(await modal().getByRole('button', {name: '프로젝트 다시 연결', exact: true}).isEnabled(), true);
  await modal().getByRole('button', {name: '프로젝트 주소 변경', exact: true}).click();
  assert.equal(await modal().getByLabel('OpenWiki 주소').inputValue(), 'http://localhost:34567');
  await modal().getByRole('button', {name: '프로젝트 다시 연결', exact: true}).click();
  await modal().waitFor({state: 'hidden'});
  await ui.evaluate(async () => {window.projectFixture.project.status = 'expired'; await chrome.storage.local.set({projectUiTick: Date.now()});});
  await ui.waitForFunction(() => document.querySelector('.project-context-chip')?.title === '프로젝트 연결 만료');
  await ui.setViewportSize({width: 320, height: 640}); await open();
  await modal().getByText('연결이 만료되었습니다. 다시 연결해 주세요.', {exact: true}).waitFor();
  await snapshot('expired', 320, 640);
  assert.equal(await modal().getByRole('button', {name: '프로젝트 다시 연결', exact: true}).isEnabled(), true);
  await modal().getByRole('button', {name: '프로젝트 다시 연결', exact: true}).click(); await modal().waitFor({state: 'hidden'});
  await ui.evaluate(async () => {window.projectFixture.busy = true; await chrome.storage.local.set({projectUiTick: Date.now()});});
  await ui.waitForFunction(() => document.querySelector('.composer [aria-label="프로젝트 연결"]')?.disabled === true);
  assert.equal(await ui.getByRole('button', {name: '프로젝트 연결 해제', exact: true}).isDisabled(), true);
  await ui.evaluate(async () => {window.projectFixture.busy = false; await chrome.storage.local.set({projectUiTick: Date.now()});});
  await ui.waitForFunction(() => document.querySelector('.composer [aria-label="프로젝트 연결"]')?.disabled === false);
  await ui.setViewportSize({width: 1100, height: 850}); await open();
  await modal().getByRole('button', {name: '프로젝트 연결 해제', exact: true}).click(); await modal().waitFor({state: 'hidden'});
  await ui.getByText('프로젝트 연결을 해제했습니다.', {exact: true}).waitFor(); assert.equal(await ui.locator('.project-context-chip').count(), 0);
  checks.push('Busy modal rejects close; success closes and toasts, exact-origin permission only, connected chip omits address; reconnect, address editing and disconnect work');
  checks.push('Expired connections show recovery in shared typography; in-flight chat blocks connect and disconnect');
  await ui.emulateMedia({reducedMotion: 'reduce'}); await open(); await modal().getByLabel('OpenWiki 주소').waitFor();
  assert.equal(await modal().evaluate(el => getComputedStyle(el).animationName), 'none'); await ui.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  await writeFile('verification/openwiki-ui-browser.json', JSON.stringify({checks, surfaces, errors, syntheticProjectRpc: true, nativePermissionPromptVerified: false}, null, 2));
  console.log(checks.join('\n'));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
