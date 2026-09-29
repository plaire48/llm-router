import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {goalReviewPayload,reviewCompletion} from './fixtures/goal-review.mjs';
import {editableText} from '../browser-text.js';

const profile=await mkdtemp(resolve(tmpdir(),'nubi-writing-')),extension=resolve(profile,'extension');
const token=`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
const sections=Array.from({length:6},(_,i)=>`${i?'\n\n':''}${i+1}절 안내\n${'업무에 필요한 내용을 확인하고 순서대로 진행합니다. '.repeat(125)}`);
const expected=sections.join(''),checks=[],requests=[],errors=[];
let context,ui,worker,tabId,stage=0,part=0,lastWritten,routeFailure,followupRound=null,formatRejected=false;
const check=text=>{checks.push(text);console.log(`PASS ${text}`);};
const textState=()=>ui.evaluate(async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
async function poll(fn,want) {let actual;for(let i=0;i<1200;i++){if(routeFailure)throw routeFailure;actual=await fn();if(actual===want)return;await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(actual,want);}
function completion(name,args,reason) {
  const delta=name?{tool_calls:[{index:0,id:`write-${stage}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{content:'안내문을 작성하고 저장 상태를 확인했습니다.'};
  return `data: ${JSON.stringify({choices:[{delta,finish_reason:reason|| (name?'tool_calls':'stop')}]})}\n\ndata: ${JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})}\n\ndata: [DONE]\n\n`;
}
try {
  await cp(resolve('dist'),extension,{recursive:true});
  const agentFile=resolve(extension,'browser-agent.js');
  const agentSource=await readFile(agentFile,'utf8');
  assert.equal(agentSource.split('    const allowed = [').length,2,'The isolated error probe must match exactly one catch block');
  await writeFile(agentFile,agentSource.replace('    const allowed = [', '    globalThis.testLastBrowserError = {message:error.message,stack:error.stack};\n    const allowed = ['));
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  // The native first-use site-access prompt is outside this fixture test.
  manifest.host_permissions.push('https://*/*','http://*/*');
  await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.testBrowserAgent={runBrowserAgent,stopBrowserAgent,idle:()=>serial(()=>{})};\n');
  context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('https://draft.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<title>안내문 작성</title><label>제목<input aria-label="제목"></label><iframe title="본문 편집기" src="https://editor.example.test/"></iframe><output id="saved"></output><label>테스트<textarea aria-label="테스트"></textarea></label><label>비밀번호<input type="password" aria-label="비밀번호"></label><script>addEventListener('message',event=>{if(event.origin==='https://editor.example.test'&&event.data==='edited')document.querySelector('output').textContent='초안 자동 저장됨';});</script>`}));
  await context.route('https://editor.example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<title>편집기</title><div role="textbox" aria-label="본문" contenteditable="true"></div><script>window.trusted=[];document.querySelector('div').oninput=event=>{window.trusted.push(event.isTrusted);parent.postMessage('edited','https://draft.example.test');};</script>`}));
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try {
    if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'qwen3.8-27b',display_name:'qwen3.8-27b_CLI',context_length:262144,max_input_tokens:221184}]}});
    const body=route.request().postDataJSON();requests.push(body);
    assert.equal(body.model,'qwen3.8-27b');
    assert.equal(body.messages[0].role,'system');
    assert.equal(body.messages.filter(message=>message.role==='system').length,1,'Qwen: System message must be at the beginning.');
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    const review=goalReviewPayload(body.messages);if(review)return route.fulfill({json:reviewCompletion(review)});
    const last=body.messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    assert(!result?.error,JSON.stringify(result));
    if(followupRound!==null){
      const current=followupRound++;stage++;
      let name,args={};
      if(current===0)name='browser_snapshot';
      else if(current===1){name='select_tools';args={groups:['scripts','input']};}
      else if(current===2){name='run_playwright';args={code:"const field=page.getByLabel('테스트'); await field.fill('후속'); return await field.appendText(' 완료',{expectedLength:2});"};}
      else if(current===3){assert.equal(result.value?.verified,true,JSON.stringify(result));name='verify_page';args={checks:[{kind:'field_value',ref:result.observation.frames.flatMap(frame=>frame.elements||[]).find(element=>element.name==='테스트').ref,expected:'후속 완료'}]};}
      else if(current===4)assert.equal(result.verified,true,JSON.stringify(result));
      // The fixture plan has two stages. After the first passes its stage review
      // the reporting stage answers once more, without another write.
      else {assert.equal(current,5);assert.match(body.messages.at(-1).content,/Later stages remain unfinished/);}
      return route.fulfill({contentType:'text/event-stream',body:completion(name,args)});
    }
    if(result?.value?.error) {
      const frame=context.pages().flatMap(page=>page.frames()).find(frame=>frame.url().startsWith('https://editor.example.test/'));
      const actual=await frame.getByLabel('본문').evaluate(editableText),wanted=sections.slice(0,part).join('');
      const mismatch=[...wanted].findIndex((char,index)=>char!==actual[index]);
      assert.fail(JSON.stringify({value:result.value,actualLength:actual.length,expectedLength:wanted.length,mismatch,actual:actual.slice(Math.max(0,mismatch-20),mismatch+80),wanted:wanted.slice(Math.max(0,mismatch-20),mismatch+80)}));
    }
    if(stage===5&&!formatRejected){formatRejected=true;return route.fulfill({status:422,json:{error:{param:'stream_options.include_usage',message:'private-provider-error'}}});}
    let name,args={},reason;
    const current=stage++;
    if(current===0)name='browser_snapshot';
    else if(current===1){name='select_tools';args={groups:['scripts','input']};}
    else if(current===2){name='update_plan';args={steps:[{text:'안내문을 절별로 작성',status:'in_progress'},{text:'내용과 저장 상태 확인',status:'pending'}]};}
    else if(current===3)return route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{reasoning_content:'synthetic-private-reasoning'},finish_reason:'length'}]})}\n\ndata: ${JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:24576,total_tokens:24676}})}\n\ndata: [DONE]\n\n`});
    else if(current===4){
      assert(body.messages.some(message=>message.content?.includes?.('Output recovery:')));
      name='run_playwright';args={code:`await page.getByLabel('제목').fill('업무 안내'); const first=${JSON.stringify(sections[0])}; await page.frameLocator('iframe[title="본문 편집기"]').getByLabel('본문').fill(first); return {length:first.length};`};part=1;
    } else if(current===5){
      lastWritten=result.value;name='run_playwright';reason='length';
      args={code:`return await page.frameLocator('iframe[title="본문 편집기"]').getByLabel('본문').appendText('MUST_NOT_EXECUTE',{expectedLength:${lastWritten.length}});`};
    } else if(part<sections.length){
      if(current!==6)lastWritten=result.value;
      assert(lastWritten.length>0);name='run_playwright';
      args={code:`return await page.frameLocator('iframe[title="본문 편집기"]').getByLabel('본문').appendText(${JSON.stringify(sections[part++])},${JSON.stringify({expectedLength:lastWritten.length,...(lastWritten.digest?{expectedDigest:lastWritten.digest}:{})})});`};
    } else if(!result?.checks){
      assert.equal(result.value.verified,true,JSON.stringify(result));lastWritten=result.value;
      const elements=result.observation.frames.flatMap(frame=>frame.elements||[]),ref=name=>elements.find(element=>element.name===name).ref;
      name='verify_page';args={checks:[{kind:'field_value',ref:ref('제목'),expected:'업무 안내'},{kind:'field_digest',ref:ref('본문'),expected:lastWritten.digest},{kind:'field_contains',ref:ref('본문'),expected:'6절 안내'},{kind:'text_present',expected:'초안 자동 저장됨'}]};
    } else assert.equal(result.verified,true,JSON.stringify(result));
    return route.fulfill({contentType:'text/event-stream',body:completion(name,args,reason)});
  } catch(error){routeFailure=error;return route.fulfill({status:500,body:'Synthetic assertion failed'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  // This scenario asserts the source editor and probes it again after chat.
  // Dedicated-window ownership is covered by workspace/harness browser suites.
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  const page=await context.newPage();await page.goto('https://draft.example.test/');await page.frameLocator('iframe').getByLabel('본문').waitFor();
  await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:1}}),token);
  ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async()=>!!(await textState()).catalog?.models?.length,true);
  tabId=await worker.evaluate(async()=> (await chrome.tabs.query({})).find(tab=>tab.url==='https://draft.example.test/').id);
  const uiId=await ui.evaluate(async()=> (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId,uiId})=>chrome.storage.session.set({chatSourceTabs:{[uiId]:tabId}}),{tabId,uiId});
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('업무 안내라는 제목으로 여섯 절의 긴 안내문을 작성하고 본문에 반영한 뒤 초안 저장 상태를 확인해줘. 발송하지 마.');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=> (await textState()).chat.messages.at(-1)?.state,'done');
  const frame=page.frames().find(frame=>frame.url().startsWith('https://editor.'));
  await frame.getByLabel('본문').press('ControlOrMeta+A');
  assert(expected.length>16000);assert.equal(await frame.evaluate(()=>getSelection().toString().replace(/\u00a0/g,' ')),expected);
  check('one user request recovers from empty output and a truncated script, then writes all six sections beyond 16K characters');
  assert(!await frame.getByLabel('본문').innerText().then(text=>text.includes('MUST_NOT_EXECUTE')));
  assert(await frame.evaluate(()=>window.trusted.length)>=6);assert(await frame.evaluate(()=>window.trusted.every(Boolean)));
  check('the discarded call never executes, each section is inserted once and all six inputs are trusted browser events');
  const state=await textState();assert.equal(state.chat.messages.at(-1).finishReason,'stop');assert.equal(state.usage.total.aipro.calls,requests.length);
  assert(state.events.some(event=>event.event==='model_request_rejected'&&event.reason==='stream_options'&&event.status===422));
  assert(state.events.some(event=>event.event==='model_request_recovered'&&event.status===200));
  assert(!JSON.stringify(state.events).includes('private-provider-error'));
  check('Qwen CLI requests keep one leading system message and an explicit 422 repair preserves the existing write receipt');
  assert(!JSON.stringify(await ui.evaluate(()=>chrome.storage.local.get(null))).includes('synthetic-private-reasoning'));
  assert.equal(state.chat.task.goalReview.status,'complete');
  check('whole-document digest, requested content and visible save status pass verification before independent goal review');
  await ui.reload();assert.equal((await textState()).chat.messages.at(-1).state,'done');
  await frame.getByLabel('본문').press('ControlOrMeta+A');
  assert.equal(await frame.evaluate(()=>getSelection().toString().replace(/\u00a0/g,' ')),expected);
  check('the completed conversation survives reload and recovery usage counts every model request once');

  followupRound=0;
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('같은 페이지의 테스트 입력란에 후속 완료를 입력하고 확인해줘.');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=>(await textState()).chat.messages.length,4);
  await poll(async()=>(await textState()).chat.messages.at(-1)?.state,'done');
  assert.equal(await page.getByLabel('테스트').inputValue(),'후속 완료');
  assert.equal((await textState()).chat.task.goalReview.status,'complete');
  assert.equal(followupRound,6);
  check('a second real chat request after reload reattaches, appends and verifies the same page with normal lease ownership');

  // The following helper probes intentionally have no chat lease. Close the
  // polling UI and drain its requests so GET_STATE cannot cancel those probes
  // as orphaned work. The actual chat above uses the normal request lifecycle.
  await ui.close();await worker.evaluate(()=>testBrowserAgent.idle());
  const requestId='append-guards';
  const run=code=>worker.evaluate(({requestId,tabId,code})=>testBrowserAgent.runBrowserAgent(requestId,{tabId},'run_playwright',{code}),{requestId,tabId,code});
  let result=await run(`const field=page.getByLabel('테스트'); await field.fill('기존'); return await field.appendText(' 다음',{expectedLength:2});`);
  assert.equal(result.result.value?.verified,true,JSON.stringify({result,detail:await worker.evaluate(()=>globalThis.testLastBrowserError)}));const receipt=result.result.value;
  result=await run(`return await page.getByLabel('테스트').appendText(' 다음',{expectedLength:2});`);
  assert(result.result.error);assert.equal(await page.getByLabel('테스트').inputValue(),'기존 다음');
  check('replaying an append with the old length cannot duplicate an already written section');
  await page.getByLabel('테스트').fill('수정 다음');
  result=await run(`return await page.getByLabel('테스트').appendText(' 다음',${JSON.stringify({expectedLength:receipt.length,expectedDigest:receipt.digest})});`);
  assert(result.result.error);assert.equal(await page.getByLabel('테스트').inputValue(),'수정 다음');
  check('a same-length edit invalidates the preceding digest and preserves the changed field');
  result=await run(`return await page.getByLabel('비밀번호').appendText('forbidden',{expectedLength:0});`);
  assert(result.result.error);assert.equal(await page.getByLabel('비밀번호').inputValue(),'');
  check('append helpers cannot write secret fields');
  await frame.getByLabel('본문').evaluate(el=>{el.innerHTML='<p><strong>기존 서식</strong></p><p><br></p>';});
  const formatted=await frame.getByLabel('본문').evaluate(editableText);
  result=await run(`return await page.frameLocator('iframe[title="본문 편집기"]').getByLabel('본문').appendText('다음 문단',${JSON.stringify({expectedLength:formatted.length})});`);
  assert.equal(result.result.value?.verified,true,JSON.stringify(result));
  assert.equal(await frame.locator('strong').innerText(),'기존 서식');
  await frame.getByLabel('본문').press('ControlOrMeta+A');
  assert.equal(await frame.evaluate(()=>getSelection().toString()),formatted+'다음 문단');
  check('appending after a trailing empty paragraph preserves existing rich-text markup and exact visible line breaks');
  await worker.evaluate(id=>testBrowserAgent.stopBrowserAgent(id),requestId);
  assert.deepEqual(errors,[]);
  await mkdir('verification',{recursive:true});await writeFile('verification/output-recovery-browser.json',JSON.stringify({checks,errors,characters:expected.length,requests:requests.length,syntheticModelResponses:true,realBrowserActions:true,actualCompanyPageVerified:false},null,2));
} catch(error){console.error({stage,part,errors,state:ui?await textState().then(state=>({last:state.chat.messages.at(-1),busy:state.busy})).catch(()=>null):null});throw error;}
finally {await context?.close();await rm(profile,{recursive:true,force:true});}
