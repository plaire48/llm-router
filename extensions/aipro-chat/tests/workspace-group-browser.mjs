import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-single-group-')), extension = resolve(profile, 'extension');
const server = createServer((_request, response) => response.end('<!doctype html><title>Group test</title><label>Draft<textarea></textarea></label>'));
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  await cp('dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json')));
  manifest.host_permissions.push('http://127.0.0.1/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.groupTest={createWorkspace,workspaceTab,releaseWorkspace};');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source = await context.newPage(); await source.goto(origin);
  await source.getByLabel('Draft').fill('Keep this user draft');
  const sourceTab = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === origin + '/'), origin);
  const create = id => worker.evaluate(({sourceTab, id}) => groupTest.createWorkspace(sourceTab,
    {conversationId: id, provider: 'aipro', credentialReceivedAt: 1}), {sourceTab, id});
  const first = await create('first'), second = await create('second');
  assert.equal(first.groupId, second.groupId);
  assert.deepEqual(first.tabIds, [first.tabId]); assert.deepEqual(second.tabIds, [second.tabId]);
  const denied = await worker.evaluate(async ({first, second}) => {
    try {await groupTest.workspaceTab(first, second.tabId); return false;} catch (error) {return error.message === 'workspace_changed';}
  }, {first, second});
  assert(denied);
  await worker.evaluate(first => groupTest.releaseWorkspace(first), first);
  const third = await create('third');
  const state = await worker.evaluate(async ({sourceTab, third}) => ({
    groups: await chrome.tabGroups.query({windowId: sourceTab.windowId}),
    active: (await chrome.tabs.query({windowId: sourceTab.windowId, active: true}))[0].id,
    tabs: (await chrome.tabs.query({windowId: sourceTab.windowId})).map(tab => ({id: tab.id, groupId: tab.groupId})),
    thirdGroup: third.groupId,
  }), {sourceTab, third});
  assert.equal(state.groups.length, 1); assert.equal(state.groups[0].title, '✦ 누비');
  assert.equal(state.thirdGroup, first.groupId); assert.equal(state.active, sourceTab.id);
  assert.equal(await source.getByLabel('Draft').inputValue(), 'Keep this user draft');
  assert.equal(state.tabs.find(tab => tab.id === sourceTab.id).groupId, -1);
  assert.equal(state.tabs.filter(tab => tab.groupId === first.groupId).length, 3);
  await writeFile('verification/browser-30/workspace-single-group.json', JSON.stringify({passed: true, actualBrowser: true, actualModel: false,
    groups: 1, conversations: 3, ownedTabs: 3, crossConversationAccessDenied: denied, sourceDraftPreserved: true, sourceFocusPreserved: true}, null, 2));
  console.log('PASS one Nubi group across 3 conversations, separate tab authority, original draft and focus preserved');
} finally {await context?.close(); await new Promise(done => server.close(done)); await rm(profile, {recursive: true, force: true});}
