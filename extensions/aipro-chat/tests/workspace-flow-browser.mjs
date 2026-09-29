import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {planCompletion,fixturePlan} from './fixtures/task-plan.mjs';
import {goalReviewPayload,reviewCompletion} from './fixtures/goal-review.mjs';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-workspace-flow-')),extension=resolve(profile,'extension');
const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(`<!doctype html><meta charset="utf-8"><title>업무 작성</title><label>본문<textarea></textarea></label><button onclick="window.submits++;document.querySelector('output').textContent='등록 완료'">등록</button><output></output><script>window.submits=0</script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let context,worker,ui,stage=0,routeError;const checks=[],errors=[],reviewPhases=[];
const check=text=>{checks.push(text);console.log('PASS '+text);};
const completion=(name,args={},content='')=>({choices:[{message:{content,...(name?{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{})},finish_reason:name?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}});
const ref=(result,name)=>(result.observation||result).frames.flatMap(f=>f.elements||[]).find(e=>e.name===name)?.ref;
async function until(test){for(let i=0;i<700;i++){if(routeError)throw routeError;if(await test())return;await new Promise(r=>setTimeout(r,40));}throw Error('State not reached');}
try {
  await cp('dist',extension,{recursive:true});const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('https://*/*','http://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  // Delay one real content-script connection; the worker's RUN_TOOL queue stays occupied.
  await appendFile(resolve(extension,'background.js'),`\nglobalThis.workspaceGate={hold:false};const originalExecute=chrome.scripting.executeScript.bind(chrome.scripting);chrome.scripting.executeScript=async options=>{if(workspaceGate.hold){workspaceGate.hold=false;await new Promise(resolve=>{workspaceGate.release=resolve;});}try{return await originalExecute(options);}catch(e){workspaceGate.error=e.message;throw e;}};\n`);
  context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});
  context.setDefaultTimeout(15000);context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  await context.route('https://*.example.test/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><title>업무 작성</title><label>본문<textarea></textarea></label><button onclick="window.submits++;document.querySelector(\'output\').textContent=\'등록 완료\'">등록</button><output></output><script>window.submits=0</script>'}));
  await context.route('https://aipro.sdsdev.co.kr/api/models',r=>r.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions',async route=>{
    try {
      const body=route.request().postDataJSON(),plan=planCompletion(body),review=goalReviewPayload(body.messages);
      if(plan)return route.fulfill({json:plan});if(review){
        reviewPhases.push(review.phase);
        assert(review.evidence.some(e=>e.tool==='verify_page' && e.usable && e.result.verified && e.arguments.checks.some(check=>check.kind==='text_present' && check.expected==='등록 완료')));
        return route.fulfill({json:reviewCompletion(review)});
      }
      assert(body.messages.some(m=>typeof m.content==='string'&&m.content.includes('Nubi tab group in the existing browser window')));
      const tool=body.messages.findLast(m=>m.role==='tool'),result=tool?JSON.parse(tool.content):null;
      let answer;
      switch(stage++){
        case 0:answer=completion('browser_snapshot');break;
        case 1:assert.equal(result.title,'업무 작성',JSON.stringify(result));answer=completion('fill_form',{fields:[{field_id:ref(result,'본문'),value:'누비 탭의 검토 초안'}]});break;
        case 2:assert.equal(result.verified,true,JSON.stringify(result));answer=completion('verify_page',{checks:[{kind:'field_contains',ref:ref(result,'본문'),expected:'검토 초안'}]});break;
        case 3:assert.equal(result.verified,true);answer=completion('request_approval',{ref:ref(result,'등록')});break;
        case 4:answer=completion('verify_page',{checks:[{kind:'text_present',expected:'등록 완료'}]});break;
        case 5:assert.equal(result.verified,true);answer=completion('update_plan',{steps:fixturePlan.map(step=>({...step,status:'completed'}))});break;
        case 6:assert(result.ok && result.plan.every(step=>step.status==='completed'));answer=completion(null,{},'누비 작업 탭에 등록하고 결과를 확인했습니다.');break;
        default:throw Error('Unexpected model turn '+stage);
      }
      await route.fulfill({json:answer});
    }catch(error){routeError=error;await route.abort();}
  });
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const source=await context.newPage();await source.goto(`${origin}/form`);await source.getByLabel('본문').fill('사용자의 원본');
  ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('button',{name:'AI Pro',exact:true}).waitFor();
  await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:876}}));
  await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  await source.bringToFront();assert.equal((await ui.evaluate(()=>chrome.runtime.sendMessage({type:'CONNECT_PAGE'}))).ok,true);
  const read=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
  await until(async()=>(await read()).catalog?.models?.length===1);
  assert.equal((await read()).browserWorkMode,'window');
  assert.equal((await worker.evaluate(()=>chrome.windows.getAll())).length,1);
  await worker.evaluate(()=>{workspaceGate.hold=true;});
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('검토 초안을 작성하고 등록해줘');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  await until(()=>worker.evaluate(()=>!!workspaceGate.release));
  const start=Date.now(), pending=await Promise.race([read(),new Promise(resolve=>setTimeout(()=>resolve(null),2500))]);
  assert(pending?.busy);assert(Date.now()-start<2500);
  const observer=await context.newPage();await observer.goto(ui.url());
  assert.equal((await observer.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data)).busy,true);
  const originalUrl=ui.url(); await ui.close();
  ui=observer; await ui.reload();
  await ui.getByRole('button',{name:'중지',exact:true}).waitFor();
  for(const [width,height] of [[360,800],[1100,850]]){await ui.setViewportSize({width,height});await ui.evaluate(async()=>{await document.fonts.ready;document.getAnimations().filter(a=>a.effect.getTiming().iterations!==Infinity).forEach(a=>{try{a.finish();}catch{}});});await ui.screenshot({path:`verification/background-execution/reopened-${width}.png`});}
  const running=await read();
  const forged=ui.evaluate(requestId=>chrome.runtime.sendMessage({type:'RUN_TOOL',requestId,name:'browser_snapshot',args:{}}),running.chat.messages.at(-1).id);
  assert.equal((await worker.evaluate(()=>chrome.storage.session.get('chatLease'))).chatLease.cancelled,undefined);
  await worker.evaluate(()=>workspaceGate.release()); assert.equal((await forged).ok,false);
  check('closing the sending UI during a tool does not cancel execution; a reloaded observer restores stop and cannot impersonate the executor');
  await until(async()=>(await read()).chat.task?.status==='awaiting_user');
  const pendingState=await read(),workspace=(await worker.evaluate(()=>chrome.storage.session.get('browserWorkspaces'))).browserWorkspaces[pendingState.chat.sessionId];
  const work=context.pages().find(p=>p.url()===source.url()&&p!==source);assert(work);
  assert.equal(await source.getByLabel('본문').inputValue(),'사용자의 원본');assert.equal(await work.getByLabel('본문').inputValue(),'누비 탭의 검토 초안');
  assert.equal(await work.evaluate(()=>submits),0);assert.equal(pendingState.workspace.id,workspace.id);
  for (const target of [work,source]) {
    await target.bringToFront();
    assert.equal((await ui.evaluate(()=>chrome.runtime.sendMessage({type:'CONNECT_PAGE'}))).ok,true);
    assert.equal((await read()).workspace?.id,workspace.id);
    assert.equal(await work.getByLabel('본문').inputValue(),'누비 탭의 검토 초안');
  }
  check('reconnecting the owned tab or its original source preserves the same workspace and unsaved draft');
  await ui.getByRole('button',{name:'누비 탭 보기',exact:true}).click();
  await until(async()=>(await worker.evaluate(()=>chrome.windows.getLastFocused())).id===workspace.windowId);
  check('the default workflow drafts and verifies only in the owned tab group, then waits for transaction approval');
  await ui.close(); ui=await context.newPage(); await ui.goto(originalUrl);
  await ui.getByRole('button',{name:'등록',exact:true}).waitFor();
  assert.equal(await work.evaluate(()=>submits),0);
  const user=await context.newPage();await user.goto(`${origin}/user`);
  // The reviewed card remains pinned even when the composer points elsewhere.
  assert.equal((await ui.evaluate(()=>chrome.runtime.sendMessage({type:'CONNECT_PAGE'}))).ok,true);
  const approve=ui.getByRole('button',{name:'등록',exact:true});
  await approve.click();
  await until(async()=>(await read()).chat.messages.at(-1)?.state==='done'&&!(await read()).busy);
  if(routeError)throw routeError;
  const completed=await read();assert(completed.chat.task.plan.every(step=>step.status==='completed'));
  assert.equal(completed.chat.messages.at(-1).content,'누비 작업 탭에 등록하고 결과를 확인했습니다.');
  assert.deepEqual(reviewPhases,['plan_step','final']);assert.equal(stage,7);
  assert.equal(await work.evaluate(()=>submits),1);assert.equal(await source.evaluate(()=>submits),0);assert.equal(await user.evaluate(()=>submits),0);
  assert.equal((await worker.evaluate(id=>chrome.tabs.get(id),workspace.tabId)).autoDiscardable,true);
  check('approval resumes the same workspace after the user switches tabs and submits exactly once');
  await ui.getByRole('button',{name:'설정',exact:true}).click();
  const modes=ui.getByRole('tablist',{name:'브라우저 작업 위치'});await modes.waitFor();
  await ui.setViewportSize({width:420,height:850});await ui.screenshot({path:'verification/workspace-settings-narrow.png'});
  await ui.setViewportSize({width:1280,height:900});await ui.screenshot({path:'verification/workspace-settings-wide.png'});
  await modes.getByRole('tab',{name:'현재 탭에서 작업',exact:true}).click();await until(async()=>(await read()).browserWorkMode==='current');
  await ui.reload();await until(async()=>(await read()).browserWorkMode==='current');
  assert.equal((await read()).workspace,null);assert.equal(await work.getByLabel('본문').inputValue(),'누비 탭의 검토 초안');
  check('CX mode selection persists after reload and changing modes preserves the old work draft');
  assert.deepEqual(errors,[]);await writeFile('verification/workspace-flow-browser.json',JSON.stringify({checks,errors,actualBrowser:true,actualModel:false},null,2));
}catch(error){console.error(JSON.stringify({stage,error:routeError?.message,script:await worker?.evaluate(()=>workspaceGate.error),local:await worker?.evaluate(()=>chrome.storage.local.get(['chat','browserWorkMode'])).catch(()=>null),body:await ui?.locator('body').innerText().catch(()=>null)}));throw error;}finally{await context?.close();server.close();await rm(profile,{recursive:true,force:true});}
