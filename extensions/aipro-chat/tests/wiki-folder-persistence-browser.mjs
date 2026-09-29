import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {handbook, initialBody, seedWikiDirectory} from './fixtures/wiki-folder.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-wiki-restart-'));
const extension = resolve(profile, 'extension'), checks = [], errors = [], network = [];
let context, ui, worker, manifest, extensionId;
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const state = () => ui.evaluate(async () => {
  const result = await chrome.runtime.sendMessage({type: 'GET_STATE'});
  if (!result.ok) throw new Error(result.error);
  return result.data;
});
async function poll(fn, predicate) {
  for (let i = 0; i < 300; i++) {const value = await fn(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 40));}
  throw new Error('Persisted folder state did not settle');
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {headless: process.env.HEADED !== '1', executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  context.on('request', request => {if (/^https?:/.test(request.url())) network.push(request.url());});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  if (extensionId) assert.equal(id, extensionId, 'The same installed extension must reopen in the same profile');
  extensionId = id;
  ui = await context.newPage(); ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(`chrome-extension://${id}/index.html#settings-wiki`);
  await ui.getByRole('dialog', {name: '설정', exact: true}).waitFor();
}
async function restart() {
  await context.close(); context = null;
  await launch();
}

try {
  await mkdir('verification', {recursive: true});
  await cp(resolve('dist'), extension, {recursive: true});
  manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Expose already imported production functions only in this isolated test
  // copy. Dynamic import is unavailable in ServiceWorkerGlobalScope.
  const background = resolve(extension, 'background.js');
  await writeFile(background, (await readFile(background, 'utf8')) + '\nglobalThis.wikiPersistenceProbe = {loadWikiFolder, executeWikiFolderTool};\n');
  await launch();
  await ui.evaluate(seedWikiDirectory, handbook(initialBody));
  await ui.getByRole('button', {name: 'OpenWiki 폴더 선택', exact: true}).click();
  const selected = await poll(async () => (await state()).wikiFolder, folder => folder?.status === 'connected');
  assert.equal(selected.kind, 'folder'); assert.deepEqual(selected.capabilities, ['wiki']);
  const recordBefore = await worker.evaluate(async () => {
    const record = await globalThis.wikiPersistenceProbe.loadWikiFolder();
    return {connectionId: record.connectionId, name: record.handle.name, permission: await record.handle.queryPermission({mode: 'read'})};
  });
  assert.equal(recordBefore.name, 'openwiki'); assert.equal(recordBefore.permission, 'granted');
  check('settings commits a real OPFS directory handle before the browser process is closed');

  await restart();
  const restored = await poll(async () => (await state()).wikiFolder, folder => folder?.status === 'connected');
  assert.deepEqual(restored, selected);
  assert.deepEqual((await state()).project, selected);
  assert.equal((await state()).auth.present, false);
  const read = await worker.evaluate(async () => {
    const record = await globalThis.wikiPersistenceProbe.loadWikiFolder();
    const value = await globalThis.wikiPersistenceProbe.executeWikiFolderTool(record, 'wiki_read', {id: 'training.md'});
    return {connectionId: record.connectionId, handleType: record.handle.constructor.name, value};
  });
  assert.equal(read.connectionId, recordBefore.connectionId);
  assert.equal(read.handleType, 'FileSystemDirectoryHandle');
  assert.equal(read.value.content, handbook(initialBody).trimEnd());
  assert.equal(read.value.provenance.hash, createHash('sha256').update(handbook(initialBody)).digest('hex'));
  await ui.getByRole('button', {name: 'OpenWiki 폴더 변경', exact: true}).waitFor();
  check('a full browser relaunch restores GET_STATE project metadata and the same IDB handle; the new worker reads the saved Wiki without login');

  await ui.getByRole('button', {name: 'OpenWiki 폴더 연결 해제', exact: true}).click();
  await poll(async () => (await state()).wikiFolder, folder => folder === null);
  await restart();
  const cleared = await state(); assert.equal(cleared.wikiFolder, null); assert.equal(cleared.project, null);
  assert.equal(await worker.evaluate(() => globalThis.wikiPersistenceProbe.loadWikiFolder()), null);
  await ui.getByRole('button', {name: 'OpenWiki 폴더 선택', exact: true}).waitFor();
  assert.equal(await ui.getByRole('button', {name: 'OpenWiki 폴더 변경', exact: true}).count(), 0);
  assert.equal(await ui.evaluate(async () => {
    const root = await navigator.storage.getDirectory(), selected = await root.getDirectoryHandle('Team handbook'), wiki = await selected.getDirectoryHandle('openwiki');
    return (await (await wiki.getFileHandle('training.md')).getFile()).text();
  }), handbook(initialBody));
  check('disconnect remains cleared after a second browser relaunch and does not delete the user-selected directory contents');
  assert.deepEqual(errors, []); assert.deepEqual(network, []);
  await writeFile('verification/wiki-folder-persistence-browser.json', JSON.stringify({version: manifest.version, checks, completeBrowserRestarts: 2, samePersistentChromeProfile: true, actualIndexedDbAndWorkerReads: true, realDirectoryHandles: true, directoryHandleFixture: 'Origin private file system', nativeOsDirectoryPickerVerified: false, nativeOsPermissionPersistenceVerified: false, actualModelRequests: false, serverRequired: false}, null, 2));
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
