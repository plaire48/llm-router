import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceMatches, workspaceTab, createWorkspace, adoptWorkspaceTab, showWorkspace, followWorkspaceTab, reconnectWorkspace, openChatTab, findWorkspaceURL, releaseWorkspace} from '../browser-workspace.js';

const binding={conversationId:'one',provider:'aipro',credentialReceivedAt:10};
test('different conversations share one visual group without sharing tab authority or drafts', async () => {
  const {tabs, calls} = fixture();
  tabs.get(2).active = true;
  const first = await createWorkspace(tabs.get(1), binding);
  tabs.get(first.tabId).draft = 'preserved';
  const second = await createWorkspace(tabs.get(1), {...binding, conversationId: 'two'});
  assert.equal(first.groupId, second.groupId);
  assert.equal(calls.filter(call => call[0] === 'group' && call[1].createProperties).length, 1);
  assert.deepEqual(first.tabIds, [3]); assert.deepEqual(second.tabIds, [4]);
  await assert.rejects(() => workspaceTab(first, second.tabId), /workspace_changed/);
  assert.equal(tabs.get(first.tabId).draft, 'preserved'); assert.equal(tabs.get(2).active, true);
  tabs.set(5, {id: 5, windowId: 4, openerTabId: second.tabId});
  await adoptWorkspaceTab(second, 5, second.tabId, {created: true});
  assert.equal(tabs.get(5).groupId, first.groupId);
  assert.deepEqual(first.tabIds, [3]); assert.deepEqual(second.tabIds, [4, 5]);
  // Keep the group registry after disconnect; a later conversation must reuse it.
  await releaseWorkspace(first);
  const third = await createWorkspace(tabs.get(1), {...binding, conversationId: 'three'});
  assert.equal(third.groupId, first.groupId);
});
test('legacy groups merge only recorded owned tabs and leave user-added tabs intact', async () => {
  const {tabs, session} = fixture();
  tabs.set(8, {id: 8, windowId: 4, groupId: 30});
  tabs.set(9, {id: 9, windowId: 4, groupId: 31});
  tabs.set(10, {id: 10, windowId: 4, groupId: 31, draft: 'user'});
  session.browserWorkspaces = {a: {windowId: 4, groupId: 30, tabIds: [8]}, b: {windowId: 4, groupId: 31, tabIds: [9]}};
  const next = await createWorkspace(tabs.get(1), binding);
  assert.equal(tabs.get(8).groupId, next.groupId); assert.equal(tabs.get(9).groupId, next.groupId);
  assert.equal(tabs.get(10).groupId, 31); assert.equal(tabs.get(10).draft, 'user');
  await assert.rejects(() => workspaceTab(next, 8), /workspace_changed/);
});
test('concurrent workspace creation still creates one presentation group', async () => {
  const {tabs, calls} = fixture();
  const [one, two] = await Promise.all([createWorkspace(tabs.get(1), binding), createWorkspace(tabs.get(1), {...binding, conversationId: 'two'})]);
  assert.equal(one.groupId, two.groupId);
  assert.equal(calls.filter(call => call[0] === 'group' && call[1].createProperties).length, 1);
});
test('reopening an exact owned URL retains its draft and excludes foreign, moving and closed tabs', async () => {
  const {tabs, calls} = fixture(), workspace = await createWorkspace(tabs.get(1), binding);
  tabs.get(3).draft = 'unsaved';
  assert.equal((await findWorkspaceURL(workspace, tabs.get(3).url)).id, 3);
  assert.equal(tabs.get(3).draft, 'unsaved');
  assert.equal(await findWorkspaceURL(workspace, 'https://private.test/'), null);
  assert.equal(await findWorkspaceURL(workspace, tabs.get(3).url + '#other'), null);
  tabs.get(3).pendingUrl = 'https://other.test/';
  assert.equal(await findWorkspaceURL(workspace, tabs.get(3).url), null);
  delete tabs.get(3).pendingUrl; tabs.get(3).windowId = 9;
  assert.equal(await findWorkspaceURL(workspace, tabs.get(3).url), null);
  assert.equal(await findWorkspaceURL({...workspace, closed: true}, 'https://page.test/'), null);
  assert.equal(calls.filter(call => call[0] === 'create').length, 1);
});
test('release compacts only an inactive, entirely owned group and never closes drafts', async () => {
  const {tabs, calls} = fixture(), workspace = await createWorkspace(tabs.get(1), binding);
  tabs.get(3).groupId = workspace.groupId; tabs.get(3).draft = 'keep';
  calls.length = 0; await releaseWorkspace(workspace);
  assert(calls.some(call => call[0] === 'groupUpdate' && call[2].collapsed === true));
  assert.equal(tabs.get(3).draft, 'keep'); assert(!calls.some(call => call[0] === 'remove'));
  tabs.get(3).active = true; calls.length = 0; await releaseWorkspace(workspace);
  assert(!calls.some(call => call[0] === 'groupUpdate'));
  tabs.get(3).active = false; tabs.get(2).groupId = workspace.groupId;
  calls.length = 0; await releaseWorkspace(workspace);
  assert(!calls.some(call => call[0] === 'groupUpdate'));
});
function fixture() {
  const tabs=new Map([[1,{id:1,windowId:4,url:'https://page.test/'}],[2,{id:2,windowId:4,url:'https://private.test/'}]]), calls=[], session={};
  let nextTab=3, nextGroup=20;
  globalThis.chrome={storage:{session:{get:async()=>structuredClone(session),set:async patch=>Object.assign(session,structuredClone(patch))}},tabs:{create:async args=>{calls.push(['create',args]);const tab={id:nextTab++,...args};tabs.set(tab.id,tab);return tab;},get:async id=>{if(!tabs.has(id))throw Error('closed');return tabs.get(id);},query:async({windowId})=>[...tabs.values()].filter(t=>t.windowId===windowId),group:async args=>{calls.push(['group',args]);const id=args.groupId??nextGroup++;for(const tabId of args.tabIds)tabs.get(tabId).groupId=id;return id;},update:async(id,patch)=>{calls.push(['update',id,patch]);Object.assign(tabs.get(id),patch);return tabs.get(id);},move:async(id,patch)=>{calls.push(['move',id,patch]);Object.assign(tabs.get(id),patch);return tabs.get(id);},remove:async id=>{calls.push(['remove',id]);tabs.delete(id);}},windows:{get:async id=>({id,type:'normal',state:'maximized'}),getLastFocused:async()=>({id:4,type:'normal',focused:true}),create:async args=>{calls.push(['create',args]);const tab={id:3,windowId:5,url:args.url};tabs.set(3,tab);return{id:5,tabs:[tab]};},update:async(...args)=>calls.push(['window',...args])},tabGroups:{update:async(...args)=>calls.push(['groupUpdate',...args])}};
  return {tabs,calls,session};
}
test('workspaces bind to conversation, provider and authentication instance',()=>{
  assert(workspaceMatches(binding,binding));
  for(const key of Object.keys(binding))assert(!workspaceMatches(binding,{...binding,[key]:'different'}));
});
test('fresh workspace is inactive and stores only ownership, never source DOM',async()=>{
  const {tabs,calls}=fixture(), workspace=await createWorkspace(tabs.get(1),binding);
  assert.deepEqual(workspace.tabIds,[3]);assert.equal(workspace.sourceTabId,1);
  assert.equal(workspace.windowId,4);assert.equal(workspace.layout,'tab-group');assert.equal(calls[0][1].windowId,4);
  assert.equal(calls[0][1].active,false);assert.equal(calls.filter(c=>c[0]==='window').length,0);
  await assert.rejects(()=>workspaceTab(workspace,2),/workspace_changed/);
  tabs.get(2).groupId=workspace.groupId;
  await assert.rejects(()=>workspaceTab(workspace,2),/workspace_changed/);
  await assert.rejects(()=>adoptWorkspaceTab(workspace,2,3,{created:false}),/workspace_changed/);
  tabs.set(6,{id:6,windowId:9,openerTabId:3});
  await adoptWorkspaceTab(workspace,6,3,{created:true});assert.equal(tabs.get(6).windowId,4);
  assert.deepEqual(workspace.tabIds,[3,6]);
  await showWorkspace(workspace);assert(calls.some(c=>c[0]==='window'&&c[2].focused));
  assert(calls.filter(c=>c[0]==='window').every(c=>!('state' in c[2])), 'showing a work tab must preserve a maximized user window');
  tabs.get(6).windowId=7;
  await assert.rejects(()=>workspaceTab(workspace,6),/workspace_changed/);
});
test('initialization failure closes only the newly created tab and closed scope is not reused',async()=>{
  const {tabs,calls}=fixture();chrome.tabGroups.update=async()=>{throw Error('group failed');};
  await assert.rejects(()=>createWorkspace(tabs.get(1),binding),/workspace_unavailable/);
  assert(tabs.has(1)&&tabs.has(2));assert.deepEqual(calls.filter(c=>c[0]==='remove'),[['remove',3]]);
  await assert.rejects(()=>workspaceTab({tabIds:[1],windowId:4,closed:true},1),/workspace_changed/);
});

test('reconnecting a recorded work tab or its source preserves the draft without creating tabs',async()=>{
  const {tabs,calls}=fixture(), workspace=await createWorkspace(tabs.get(1),binding);
  tabs.get(3).draft='unsaved';
  assert.deepEqual(await reconnectWorkspace(workspace,binding,3),workspace);
  assert.deepEqual(await reconnectWorkspace(workspace,binding,1),workspace);
  assert.equal(tabs.get(3).draft,'unsaved');
  assert.equal(calls.filter(call=>call[0]==='create').length,1);
  tabs.set(6,{id:6,windowId:4,url:'https://page.test/child'});
  const multiple={...workspace,tabIds:[3,6]};
  assert.equal((await reconnectWorkspace(multiple,binding,6)).tabId,6);
  assert.equal(multiple.tabId,3,'the checked candidate must not mutate saved state');
});

test('reconnect never adopts a matching URL/group, a different owner, closed or moved tab',async()=>{
  const {tabs}=fixture(), workspace=await createWorkspace(tabs.get(1),binding);
  tabs.get(2).url=tabs.get(3).url;tabs.get(2).groupId=workspace.groupId;
  assert.equal(await reconnectWorkspace(workspace,binding,2),null);
  for(const key of Object.keys(binding))assert.equal(await reconnectWorkspace(workspace,{...binding,[key]:'other'},3),null);
  assert.equal(await reconnectWorkspace({...workspace,closed:true},binding,3),null);
  tabs.get(3).windowId=9;assert.equal(await reconnectWorkspace(workspace,binding,3),null);
  tabs.delete(3);assert.equal(await reconnectWorkspace(workspace,binding,1),null);
});

test('opening full screen reuses a regular chat tab without reloading its draft or requested view',async()=>{
  const {tabs,calls}=fixture(), base='chrome-extension://nubi/index.html';
  chrome.runtime={getURL:path=>'chrome-extension://nubi/'+path,
    getContexts:async()=>[...tabs.values()].map(tab=>({contextType:'TAB',frameId:0,tabId:tab.id,windowId:tab.windowId,documentUrl:tab.url,incognito:!!tab.incognito}))};
  tabs.set(7,{id:7,windowId:4,url:base+'#settings',lastAccessed:1,draft:'preserve'});
  tabs.set(8,{id:8,windowId:4,url:base+'?conversation=other#history',lastAccessed:10});
  tabs.set(9,{id:9,windowId:9,url:base,lastAccessed:20});
  let result=await openChatTab({sourceWindowId:4,hash:'#settings-wiki'});
  assert.equal(result.tab.id,7);assert.equal(result.reused,true);assert.equal(result.hash,'#settings-wiki');
  assert.equal(tabs.get(7).draft,'preserve');assert.equal(tabs.get(7).url,base+'#settings');
  assert.equal(calls.filter(call=>call[0]==='create').length,0);
  assert.equal((await openChatTab({senderTabId:9,sourceWindowId:4})).tab.id,9);
  tabs.delete(7);tabs.delete(9);
  result=await openChatTab({hash:'#settings'});
  assert.equal(result.reused,false);assert.equal(result.tab.url,base+'#settings');
  assert.equal(tabs.get(8).url,base+'?conversation=other#history');
});

test('own runtime contexts find existing chat when Chrome redacts tab URLs without tabs permission',async()=>{
  const {tabs,calls}=fixture(),base='chrome-extension://nubi/index.html';
  tabs.set(7,{id:7,windowId:4,lastAccessed:10});
  tabs.set(8,{id:8,windowId:4,lastAccessed:20,pendingUrl:'https://unrelated.test/'});
  tabs.set(9,{id:9,windowId:4,lastAccessed:30});
  tabs.set(10,{id:10,windowId:4,lastAccessed:40});
  chrome.runtime={getURL:path=>'chrome-extension://nubi/'+path,getContexts:async filter=>{
    assert.deepEqual(filter,{contextTypes:['TAB'],frameIds:[0],incognito:false});
    return [
      {contextType:'TAB',frameId:0,tabId:7,windowId:4,documentUrl:base+'#settings'},
      {contextType:'TAB',frameId:0,tabId:8,windowId:4,documentUrl:base},
      {contextType:'SIDE_PANEL',frameId:0,tabId:9,windowId:4,documentUrl:base},
      {contextType:'TAB',frameId:1,tabId:10,windowId:4,documentUrl:base},
      {contextType:'TAB',frameId:0,tabId:11,windowId:4,documentUrl:base},
    ];
  }};
  chrome.tabs.query=async()=>{throw Error('must not request all browser tab URLs');};
  const result=await openChatTab({sourceWindowId:4});
  assert.equal(result.tab.id,7);assert.equal(result.reused,true);
  assert.equal(calls.filter(call=>call[0]==='create').length,0);
});

test('popup focus guard tracks only owned children and stops after the user leaves Chrome',async()=>{
  const {guardPopupFocus}=await import('../browser-workspace.js');
  const listeners=new Set(),updates=[],tabs=new Map([[9,[{openerTabId:3}]]]);let current={id:4,focused:true};
  globalThis.chrome={windows:{WINDOW_ID_NONE:-1,getLastFocused:async()=>({...current}),update:async(id)=>{updates.push(id);current={id,focused:true};},onFocusChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}},tabs:{onActivated:{addListener:()=>{},removeListener:()=>{}},query:async({windowId})=>tabs.get(windowId)||[]}};
  const workspace={id:'focus',windowId:5,tabIds:[3]};
  const guard=await guardPopupFocus(workspace);
  current={id:9,focused:true};await Promise.all([...listeners].map(f=>f(9)));
  await new Promise(r=>setTimeout(r,0));assert.deepEqual(updates,[4]);
  await guard.created({windowId:9});current={id:5,focused:true};await guard.finish();assert.deepEqual(updates,[4,4]);
  current={id:9,focused:false};await Promise.all([...listeners].map(f=>f(-1)));await guard.finish();assert.equal(updates.length,2);assert.equal(listeners.size,0);
  const backgroundGuard=await guardPopupFocus(workspace);backgroundGuard.close();
});

test('a newly chosen unrelated Chrome window invalidates popup focus restoration',async()=>{
  const {guardPopupFocus}=await import('../browser-workspace.js');
  const listeners=new Set(),updates=[];let current={id:4,focused:true};
  globalThis.chrome={windows:{WINDOW_ID_NONE:-1,getLastFocused:async()=>({...current}),update:async id=>updates.push(id),onFocusChanged:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}},tabs:{onActivated:{addListener:()=>{},removeListener:()=>{}},query:async()=>[]}};
  const guard=await guardPopupFocus({id:'chosen',windowId:5,tabIds:[3]});
  current={id:7,focused:true};await Promise.all([...listeners].map(f=>f(7)));
  current={id:9,focused:true};await guard.created({windowId:9});await guard.finish();assert.deepEqual(updates,[]);assert.equal(listeners.size,0);
});

function followFixture() {
  const state=fixture(), listeners=new Set();
  state.tabs.set(3,{id:3,windowId:4,url:'https://page.test/child'});
  state.tabs.get(1).active=true;
  chrome.tabs.onActivated={addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)};
  chrome.tabs.query=async({windowId,active})=>[...state.tabs.values()].filter(t=>t.windowId===windowId&&(!active||t.active));
  const select=id=>{for(const tab of state.tabs.values())tab.active=tab.id===id;};
  return {...state,listeners,select,workspace:{windowId:4,tabIds:[1,3],tabId:3}};
}
test('automatic follow changes only an owned selection without focusing or restoring the window',async()=>{
  const {calls,workspace,listeners}=followFixture();
  chrome.windows.getLastFocused=async()=>({id:9,focused:true});
  assert.equal(await followWorkspaceTab(workspace),true);
  assert.deepEqual(calls,[['update',3,{active:true}]]);assert.equal(listeners.size,0);
});
test('choosing a user tab pauses follow and returning to an owned tab resumes it',async()=>{
  const {calls,workspace,select}=followFixture();
  select(2);assert.equal(await followWorkspaceTab(workspace),false);assert.deepEqual(calls,[]);
  select(1);assert.equal(await followWorkspaceTab(workspace),true);
});
test('follow rejects cancelled, closed, moved and unowned targets without affecting user tabs',async()=>{
  const {tabs,calls,workspace}=followFixture();
  assert.equal(await followWorkspaceTab(workspace,()=>true),false);
  assert.equal(await followWorkspaceTab({...workspace,closed:true}),false);
  assert.equal(await followWorkspaceTab({...workspace,tabId:2}),false);
  tabs.get(3).windowId=9;assert.equal(await followWorkspaceTab(workspace),false);
  tabs.delete(3);assert.equal(await followWorkspaceTab(workspace),false);
  assert.deepEqual(calls,[]);
});
test('a user selection during the read cancels automatic follow and removes its listener',async()=>{
  const {calls,workspace,listeners,tabs}=followFixture();
  chrome.tabs.query=async()=>{for(const listener of listeners)listener({windowId:4,tabId:2});return [tabs.get(1)];};
  assert.equal(await followWorkspaceTab(workspace),false);assert.deepEqual(calls,[]);assert.equal(listeners.size,0);
});
test('release respects manual regrouping and prunes only closed presentation records',async()=>{
 const {tabs,calls,session}=fixture(),workspace=await createWorkspace(tabs.get(1),binding);
 const group=workspace.groupId;
 tabs.get(3).groupId=999;session.nubiWorkspaceGroups[4].tabIds.push(99);
 calls.length=0;const result=await releaseWorkspace(workspace);
 assert.equal(result.status,'preserved');assert(!calls.some(call=>call[0]==='groupUpdate'));
 assert.deepEqual(session.nubiWorkspaceGroups[4],{groupId:group,tabIds:[3]});
 assert.deepEqual(workspace.tabIds,[3]);assert.equal(tabs.size,3);
 tabs.delete(3);await releaseWorkspace(workspace);assert.equal(session.nubiWorkspaceGroups[4],undefined);
});
