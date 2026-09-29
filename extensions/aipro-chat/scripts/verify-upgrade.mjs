import assert from 'node:assert/strict';
import {mkdtemp, mkdir, cp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const oldArchive = process.argv[2] && resolve(process.argv[2]);
if (!oldArchive) throw new Error('Usage: node scripts/verify-upgrade.mjs <previous-release.zip>');
const candidate = resolve(process.argv[3] || resolve(root, 'dist'));
const nextManifest = JSON.parse(await readFile(resolve(candidate, 'manifest.json'), 'utf8'));
const oldArchiveSha256 = createHash('sha256').update(await readFile(oldArchive)).digest('hex');
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-upgrade-'));
const extension = resolve(profile, 'extension');
let context;
const errors = [], checks = [];
const report = {status:'running',startedAt:new Date().toISOString(),to:nextManifest.version,oldArchiveSha256,actualBrowser:true,actualModel:false,liveAccount:false,checks,errors};
const reportPath = resolve(root,'verification/upgrade.json');
await mkdir(resolve(root,'verification'),{recursive:true});
const persist = () => writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
await persist();
async function launch() {
  context = await chromium.launchPersistentContext(profile, {headless:true, executablePath:process.env.CHROME_BINARY,
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  // This migration check never needs a live account or external service.
  await context.route(/^https?:/, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/index.html`);
  await page.getByRole('button', {name:'대화 이력',exact:true}).waitFor();
  const state = async () => (await page.evaluate(() => chrome.runtime.sendMessage({type:'GET_STATE'}))).data;
  await state();
  return {worker, page, id, state};
}
try {
  await mkdir(extension);
  execFileSync('unzip', ['-q', oldArchive, '-d',extension]);
  const oldManifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  report.from = oldManifest.version;
  const beforeVersion = oldManifest.version.split('.').map(Number), nextVersion = nextManifest.version.split('.').map(Number);
  const changeIndex = [0,1,2,3].find(i => (beforeVersion[i] || 0) !== (nextVersion[i] || 0));
  assert(changeIndex !== undefined && (nextVersion[changeIndex] || 0) > (beforeVersion[changeIndex] || 0), 'candidate version must increase');
  let app = await launch();
  assert.equal(await app.worker.evaluate(() => chrome.runtime.getManifest().version), oldManifest.version);
  const oldId = app.id;
  await app.worker.evaluate(async () => {
    const {settings} = await chrome.storage.local.get('settings');
    const conversation = (id,title) => ({sessionId:id,title,provider:'aipro',modelId:'QWEN3.8-27B-FP8-256K',createdAt:1,updatedAt:2,
      messages:[{id:crypto.randomUUID(),role:'user',content:title,state:'done'}],draft:'배포 후에도 유지할 초안'});
    await chrome.storage.local.set({activeProvider:'aipro',settings:{...settings,modelId:'QWEN3.8-27B-FP8-256K'},browserWorkMode:'current',
      chat:conversation('upgrade-active','진행 중인 대화'),chatHistory:[conversation('upgrade-history','이전에 저장한 대화')],providerChats:{}});
  });
  const before = await app.state();
  await context.close(); context = null;
  await rm(extension, {recursive:true});
  await cp(candidate, extension, {recursive:true});
  app = await launch();
  assert.equal(app.id, oldId);
  assert.equal(await app.worker.evaluate(() => chrome.runtime.getManifest().version), nextManifest.version);
  const after = await app.state();
  for (const key of ['sessionId','draft','messages','title']) assert.deepEqual(after.chat[key], before.chat[key],key);
  assert.equal(after.settings.modelId,before.settings.modelId);
  assert.equal(after.browserWorkMode,'current');
  assert.deepEqual(after.conversations,before.conversations);
  checks.push('Updating the same unpacked extension folder preserves ID, active/history conversations, draft, model and work mode across Chrome restart.');
  await app.page.getByRole('button',{name:'대화 이력',exact:true}).click();
  await app.page.getByRole('button',{name:'이전에 저장한 대화 열기',exact:true}).click();
  assert.equal((await app.state()).chat.sessionId,'upgrade-history');
  await app.page.reload();
  await app.page.getByRole('button',{name:'대화 이력',exact:true}).waitFor();
  assert.equal((await app.state()).chat.sessionId,'upgrade-history');
  checks.push('A saved conversation can be selected after upgrading and stays selected after reload.');
  assert.deepEqual(errors,[]);
  report.status = 'passed';
  console.log(checks.join('\n'));
} catch(error) {report.status='failed';report.failure=error.message;throw error;}
finally {await context?.close();await rm(profile,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await persist();}
