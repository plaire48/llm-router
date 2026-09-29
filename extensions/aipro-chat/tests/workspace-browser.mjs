import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-workspace-')), extension=resolve(profile,'extension');
const checks=[],errors=[],popupFocus=[]; let context,worker;
const check=text=>{checks.push(text);console.log('PASS '+text);};
const body=`<!doctype html><meta charset="utf-8"><title>작업 대상</title><label>본문<textarea></textarea></label>
<button onclick="window.clicks++;window.trusted=event.isTrusted">항목 선택</button>
<a href="/child" target="_blank" rel="noopener">새 탭</a>
<button onclick="window.open('/child','compose','popup,width=600,height=500')">새 창</button>
<script>window.clicks=0;</script>`;
let delayNextPage = false;
const server=createServer((_req,res)=>{const send=()=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(body);};if(delayNextPage){delayNextPage=false;setTimeout(send,1500);}else send();});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const activateTestBrowser=()=>{
  if (process.platform === 'darwin' && process.env.HEADED === '1') {
    const line=execFileSync('ps',['-axo','pid=,command='],{timeout:5000}).toString().split('\n')
      .find(line=>line.includes(`--user-data-dir=${profile}`)&&line.includes('Google Chrome for Testing')&&!line.includes('--type='));
    const pid=Number(line?.trim().split(/\s+/,1)[0]);
    if(!pid)throw new Error('headed_test_browser_process_missing');
    execFileSync('osascript',['-e',`tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`],{timeout:5000});
  }
};
try {
  await cp('dist',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  manifest.host_permissions.push('http://127.0.0.1/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.workspaceTest={runBrowserAgent,stopBrowserAgent,createWorkspace,readyWorkspaceTab,browserAgentContext,resolveBrowserTab};\n');
  context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
  // The native focus check must start with this test browser in front, even
  // when another Chrome/Codex window was active before the headed run.
  activateTestBrowser();
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const source=await context.newPage();await source.goto(origin+'/work');
  await source.getByLabel('본문').fill('사용자의 미저장 초안');
  await source.getByLabel('본문').blur();
  const originalDraft=await source.getByLabel('본문').inputValue();
  assert.equal(originalDraft.trim(),'사용자의 미저장 초안');
  const sourceTab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),source.url());
  const user=await context.newPage();await user.goto(origin+'/user');
  const userTab=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url),user.url());
  const focus=()=>worker.evaluate(async()=>(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.id);
  const focusedWindow=()=>worker.evaluate(async()=>{const windows=await chrome.windows.getAll();return windows.find(window=>window.focused)?.id ?? null;});
  const foreground=async()=>{await worker.evaluate(async({id,windowId})=>{await chrome.tabs.update(id,{active:true});await chrome.windows.update(windowId,{focused:true});},userTab);for(let i=0;i<50;i++){if(await focus()===userTab.id)break;await new Promise(r=>setTimeout(r,20));}assert.equal(await focus(),userTab.id,'foreground fixture must settle before creating work');};
  await foreground();
  delayNextPage=true;
  const workspace=await worker.evaluate(source=>workspaceTest.createWorkspace(source,{conversationId:'isolation',provider:'aipro',credentialReceivedAt:1}),sourceTab);
  const initialInventory=await worker.evaluate(workspace=>workspaceTest.runBrowserAgent('initial-inventory',{tabId:workspace.tabId,browserContext:{tabId:workspace.tabId,workspace}},'list_tabs',{}),workspace);
  assert(initialInventory.result.tabs.some(tab=>tab.tab_id===String(workspace.tabId)),JSON.stringify(initialInventory));
  await worker.evaluate(()=>workspaceTest.stopBrowserAgent());
  check('first inventory retains an owned tab while its initial navigation settles');
  await worker.evaluate(workspace=>workspaceTest.readyWorkspaceTab(workspace,workspace.tabId),workspace);
  assert.equal(await focus(),userTab.id);
  assert.equal(workspace.windowId,sourceTab.windowId);
  assert.equal((await worker.evaluate(()=>chrome.windows.getAll())).length,1);
  const workTab=await worker.evaluate(id=>chrome.tabs.get(id),workspace.tabId);
  const group=await worker.evaluate(id=>chrome.tabGroups.get(id),workspace.groupId);
  assert.equal(workTab.groupId,workspace.groupId);assert.equal(group.title,'✦ 누비');
  let work;
  for(let i=0;i<100&&!work;i++){work=context.pages().find(p=>p.url()===source.url()&&p!==source);if(!work)await new Promise(r=>setTimeout(r,50));}
  assert(work,JSON.stringify({tabs:await worker.evaluate(()=>chrome.tabs.query({})),pages:context.pages().map(p=>p.url())}));
  assert.equal(await work.getByLabel('본문').inputValue(),'');
  check('an inactive tab in the source window and Nubi group are created without copying unsaved source input');

  let requestId='workspace-main', savedContext={tabId:workspace.tabId,workspace};
  const run=(name,args={})=>worker.evaluate(({requestId,savedContext,name,args})=>workspaceTest.runBrowserAgent(requestId,{tabId:savedContext.tabId,browserContext:savedContext},name,args,{vision:true}),{requestId,savedContext,name,args});
  const ref=async name=>{const result=(await run('browser_snapshot')).result;const item=result.frames?.flatMap(f=>f.elements||[]).find(e=>e.name===name);assert(item,JSON.stringify(result));return item.ref;};
  let result=await run('click_element',{ref:await ref('항목 선택')});assert.equal(result.result.ok,true,JSON.stringify(result));
  assert.equal(await work.evaluate(()=>clicks),1);assert.equal(await work.evaluate(()=>trusted),true);
  assert.equal(await source.evaluate(()=>clicks),0);assert.equal(await focus(),userTab.id);
  result=await run('fill_form',{fields:[{field_id:await ref('본문'),value:'누비가 작성한 초안'}]});assert.equal(result.result.verified,true,JSON.stringify(result));
  assert.equal(await work.getByLabel('본문').inputValue(),'누비가 작성한 초안');
  assert.equal(await source.getByLabel('본문').inputValue(),originalDraft);assert.equal(await focus(),userTab.id);
  result=await run('capture_page');assert(result.result.image?.data);assert.equal(await focus(),userTab.id);
  check('trusted click, field input and capture target only the owned tab while the user tab stays active');

  const beforeReuse = await worker.evaluate(() => chrome.tabs.query({}));
  result = await run('navigate_page', {url: source.url(), new_tab: 'yes'});
  assert.equal(result.tabId, workspace.tabId);
  assert.equal((await worker.evaluate(() => chrome.tabs.query({}))).length, beforeReuse.length);
  assert.equal(await work.getByLabel('본문').inputValue(), '누비가 작성한 초안');
  result = await run('navigate_page', {url: origin + '/comparison', new_tab: 'yes'});
  const comparisonId = result.tabId; assert.notEqual(comparisonId, workspace.tabId);
  result = await run('navigate_page', {url: origin + '/comparison', new_tab: 'yes'});
  assert.equal(result.tabId, comparisonId);
  assert.equal((await worker.evaluate(() => chrome.tabs.query({}))).length, beforeReuse.length + 1);
  await run('switch_tab', {tab_id: String(workspace.tabId)});
  await worker.evaluate(id => chrome.tabs.remove(id), comparisonId);
  assert.equal(await focus(), userTab.id);
  check('explicit new-tab requests reuse exact owned URLs without reloading drafts or creating duplicate comparison tabs');

  await worker.evaluate(({tabId,groupId})=>chrome.tabs.group({tabIds:[tabId],groupId}),{tabId:userTab.id,groupId:workspace.groupId});
  result=await run('list_tabs');assert.deepEqual(result.result.tabs.map(t=>+t.tab_id),[workspace.tabId]);
  result=await run('switch_tab',{tab_id:String(userTab.id)});assert.equal(result.result.error,'browser_stale');assert.equal(await focus(),userTab.id);
  check('tab inventory and switching exclude user tabs');

  await worker.evaluate(id=>chrome.tabs.ungroup(id),userTab.id);
  const second=await worker.evaluate(source=>workspaceTest.createWorkspace(source,{conversationId:'other',provider:'aipro',credentialReceivedAt:1}),sourceTab);
  // One Nubi group per window is shared for presentation (browser-workspace.js
  // joinWorkspaceGroup). Ownership stays with each conversation's own tab list.
  assert.equal(second.windowId,workspace.windowId);assert.equal(second.groupId,workspace.groupId);
  assert.deepEqual(second.tabIds,[second.tabId]);assert(!second.tabIds.includes(workspace.tabId));
  result=await run('list_tabs');assert.deepEqual(result.result.tabs.map(t=>+t.tab_id),[workspace.tabId]);
  result=await run('switch_tab',{tab_id:String(second.tabId)});assert.equal(result.result.error,'browser_stale');
  await worker.evaluate(id=>chrome.tabs.remove(id),second.tabId);
  assert.equal(await focus(),userTab.id);
  check('another conversation shares the window group but owns only its own tab; grouping a user tab grants no ownership');

  for(const label of ['새 탭','새 창']) {
    let beforeFocus;
    for(let attempt=0;attempt<10;attempt++){
      activateTestBrowser();await foreground();beforeFocus=await focusedWindow();
      if(beforeFocus===userTab.windowId)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(beforeFocus!==userTab.windowId && process.platform==='darwin')console.log('FOCUS_DIAGNOSTIC',execFileSync('osascript',['-e','tell application "System Events" to get name of first process whose frontmost is true']).toString().trim(),await worker.evaluate(()=>chrome.windows.getAll()));
    assert.equal(beforeFocus,userTab.windowId,'the native focus fixture must start in the test Chrome window');
    result=await run('click_element',{ref:await ref(label)});assert.equal(result.result.ok,true,JSON.stringify(result));
    savedContext=await worker.evaluate(id=>workspaceTest.browserAgentContext(id),requestId);
    const child=await worker.evaluate(id=>chrome.tabs.get(id),savedContext.tabId);
    assert.notEqual(child.id,workspace.tabId);assert.equal(child.windowId,workspace.windowId);assert.equal(child.groupId,workspace.groupId);
    const afterFocus=await focusedWindow();
    // lastFocusedWindow persists even while another application is foreground.
    // Never 'restore' Chrome over that application merely to satisfy a tab id.
    const mode=beforeFocus===null ? 'chrome_background' : 'chrome_foreground';
    const restored=beforeFocus===null ? afterFocus===null : afterFocus===beforeFocus && await focus()===userTab.id;
    popupFocus.push({kind:label,mode,beforeFocus,afterFocus,restored});
    if(!restored)console.log(`LIMIT ${label}: native popup focus isolation failed (${mode})`);
    assert.equal((await worker.evaluate(windowId=>chrome.tabs.query({windowId,active:true}),userTab.windowId))[0].id,userTab.id);
    await worker.evaluate(id=>chrome.tabs.remove(id),child.id);
    result=await run('browser_snapshot');assert.equal(result.tabId,workspace.tabId,JSON.stringify(result));
    savedContext=await worker.evaluate(id=>workspaceTest.browserAgentContext(id),requestId);
  }
  check('new tabs and popup windows stay in the work group; a closed child returns only to its recorded parent');

  // Follow only the owned work surface. User tabs and other windows retain selection.
  await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),workspace.tabId);
  result=await run('click_element',{ref:await ref('새 탭')});assert.equal(result.result.ok,true);
  savedContext=await worker.evaluate(id=>workspaceTest.browserAgentContext(id),requestId);
  const followChild=savedContext.tabId;
  assert.equal(await focus(),followChild);
  result=await run('switch_tab',{tab_id:String(workspace.tabId)});assert.equal(result.tabId,workspace.tabId);
  assert.equal(await focus(),workspace.tabId);
  await foreground();
  result=await run('switch_tab',{tab_id:String(followChild)});assert.equal(result.tabId,followChild);
  assert.equal(await focus(),userTab.id);
  await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),workspace.tabId);
  await run('browser_snapshot');assert.equal(await focus(),followChild);
  check('owned tabs follow the agent, a user-tab selection pauses following, and returning resumes it');

  const otherWindow=await worker.evaluate(url=>chrome.windows.create({url,focused:true}),origin+'/separate-user');
  const otherTab=otherWindow.tabs[0];
  let separate;
  for(let i=0;i<100&&!separate;i++){separate=context.pages().find(p=>p.url()===origin+'/separate-user');if(!separate)await new Promise(r=>setTimeout(r,20));}
  assert(separate);await separate.getByLabel('본문').fill('다른 창의 입력 유지');
  await worker.evaluate(id=>chrome.windows.update(id,{focused:true}),otherWindow.id);
  const beforeWindowState=await worker.evaluate(async()=>({windows:(await chrome.windows.getAll()).map(w=>({id:w.id,focused:w.focused,state:w.state})),last:(await chrome.windows.getLastFocused()).id}));
  await worker.evaluate(()=>{globalThis.followFocusCalls=[];globalThis.originalWindowUpdate=chrome.windows.update;chrome.windows.update=(...args)=>{followFocusCalls.push(args);return originalWindowUpdate(...args);};});
  result=await run('switch_tab',{tab_id:String(workspace.tabId)});assert.equal(result.tabId,workspace.tabId);
  assert.deepEqual(await worker.evaluate(()=>followFocusCalls),[]);
  await worker.evaluate(()=>{chrome.windows.update=originalWindowUpdate;delete globalThis.originalWindowUpdate;});
  const afterWindowState=await worker.evaluate(async()=>({windows:(await chrome.windows.getAll()).map(w=>({id:w.id,focused:w.focused,state:w.state})),last:(await chrome.windows.getLastFocused()).id}));
  assert.deepEqual(afterWindowState,beforeWindowState);
  assert.equal((await worker.evaluate(id=>chrome.tabs.query({windowId:id,active:true}),workspace.windowId))[0].id,workspace.tabId);
  assert.equal((await worker.evaluate(id=>chrome.tabs.query({windowId:id,active:true}),otherWindow.id))[0].id,otherTab.id);
  if(process.env.HEADED==='1'){assert.equal(await focusedWindow(),otherWindow.id);assert.equal(await focus(),otherTab.id);}
  // Headless Chrome can report two windows as focused. Unchanged API state
  // and no focus calls are regression evidence, not native OS focus proof.
  assert.equal(await separate.getByLabel('본문').inputValue(),'다른 창의 입력 유지');
  assert.equal(await source.getByLabel('본문').inputValue(),originalDraft);
  check('agent updates work-tab selection without window-focus calls, changed window state or changes to the other window draft');
  await worker.evaluate(id=>chrome.windows.remove(id),otherWindow.id);
  await worker.evaluate(id=>chrome.tabs.remove(id),followChild);
  savedContext=await worker.evaluate(id=>workspaceTest.browserAgentContext(id),requestId);
  await foreground();
  await worker.evaluate(id=>workspaceTest.stopBrowserAgent(id),requestId);
  assert.equal((await worker.evaluate(id => chrome.tabGroups.get(id), workspace.groupId)).collapsed, true);
  assert.equal(await focus(), userTab.id);
  assert.equal(await work.getByLabel('본문').inputValue(), '누비가 작성한 초안');
  check('ending work compacts the inactive group and preserves the work draft and user selection');
  requestId='workspace-resume';result=await run('browser_snapshot');assert.equal(result.tabId,workspace.tabId);
  assert.equal(await source.getByLabel('본문').inputValue(),originalDraft);
  await worker.evaluate(ids=>chrome.tabs.remove(ids),[workspace.tabId]);
  result=await run('browser_snapshot');assert(result.result.error);assert.equal(await source.evaluate(()=>clicks),0);
  await worker.evaluate(id=>workspaceTest.stopBrowserAgent(id),requestId);
  assert.equal((await worker.evaluate(()=>chrome.windows.getAll())).length,1);
  check('resume preserves owned tabs and closing the workspace never recreates or falls back to the user page');
  assert.deepEqual(errors,[]);
  await writeFile('verification/workspace-browser.json',JSON.stringify({checks,errors,popupFocus,focusIsolationVerified:popupFocus.every(item=>item.restored),headed:process.env.HEADED==='1',actualBrowser:true,actualModel:false,nativeFocusVerified:process.env.HEADED==='1'},null,2));
} finally {await context?.close();await rm(profile,{recursive:true,force:true});await new Promise(resolve=>server.close(resolve));}
