import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';
import {prepareEvaluationTrial} from '../scripts/evaluation-reset.mjs';
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-review-budget-')), extension = resolve(profile, 'extension');
let context, ui, worker, failure, reads = 0, reviews = 0, stepReviews = 0, original;
const errors = [], reviewedSteps = [];
const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(`<title>긴 검색 화면</title><h1>관람 안내 검색 결과</h1><a href="${origin}/official">공식 관람 안내</a>${Array.from({length:90},(_,i)=>`<p>관람 안내 ${i} ${'검색 결과에서 실제로 관찰한 설명입니다. '.repeat(8)}<a href="${origin}/item/${i}">안내 ${i}</a></p>`).join('')}`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;

const reply = (name, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: '{}'}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}]});
const wait = async predicate => {for(let i=0;i<500;i++){if(failure)throw failure;if(await predicate())return;await new Promise(r=>setTimeout(r,40));}throw Error('scenario_timeout');};
try {
  await cp(resolve(process.env.NUBI_TEST_DIST || 'dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json')));manifest.host_permissions.push('https://*/*','http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'), '\nconst testExecute=chrome.scripting.executeScript.bind(chrome.scripting);globalThis.testScriptErrors=[];chrome.scripting.executeScript=async options=>{try{return await testExecute(options);}catch(error){testScriptErrors.push(error.message);throw error;}};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', e=>errors.push(e.message)));

  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
    if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144,max_input_tokens:221184}]}});
    const body=route.request().postDataJSON(), planning=planCompletion(body);
    if(planning?.scopeAudit)return route.fulfill({json:planning});
    if(planning){
      planning.choices[0].message.tool_calls[0].function.arguments=JSON.stringify({steps:[
        {text:'현재 검색 화면 확인',status:'in_progress',expected_outcome:'현재 화면의 검색 결과를 관찰한다'},
        {text:'공식 안내 출처 확인',status:'pending',expected_outcome:'관찰한 공식 안내 제목과 링크를 확인한다'},
        {text:'열람 범위와 결과 정리',status:'pending',expected_outcome:'답변에 제목과 링크 및 열람 범위를 포함한다'}]});
      return route.fulfill({json:planning});
    }
    const review=goalReviewPayload(body.messages);
    if(review){
      const receipt=review.evidence.find(item=>item.result?.dataKind==='host_tool_dispatch');
      assert(receipt?.result.taskStartObserved);
      assert.deepEqual(receipt.result.absenceCertificates,['only_observation_or_coordination_tools_dispatched','no_click_input_or_script_tool_dispatched']);
      assert.equal(receipt.result.semanticClickTargetCoverage,'not_established');
      for(const name of ['onlyReadOnlyToolsInvoked','noPageInteractionToolsInvoked','allPageInteractionTargetsObserved'])assert.equal(Object.hasOwn(receipt.result,name),false);
      assert(receipt.result.calls.some(call=>call.tool==='browser_snapshot'));
      const evidence=review.evidence.find(item=>item.tool==='browser_snapshot'&&item.usable);
      assert(evidence, 'Large actual DOM observation must remain citeable');
      assert.equal(evidence.truncated,false);
      assert(review.citeable_evidence_ids.includes(evidence.id));
      const reviewedFrame=evidence.result.frames[0];
      assert.equal(reviewedFrame.textSegments.map(segment=>segment.text).join(''),original.frames[0].text);
      assert.deepEqual(reviewedFrame.retrieval.textRegions,original.frames[0].retrieval.textRegions);
      assert.equal(reviewedFrame.originalTextLength,original.frames[0].text.length);
      assert(JSON.stringify(evidence.result).includes('/official'));
      if(review.phase==='plan_step'){
        stepReviews++;assert.equal(review.stepOutcomes.length,1);
        reviewedSteps.push(review.stepOutcomes[0].text);
        assert.equal(receipt.result.calls.filter(call=>call.tool==='browser_snapshot').length,1,'Step continuation must not reread the page');
        if(stepReviews===1)return route.fulfill({json:reply(null,JSON.stringify({status:'revise',checks:[{requirement:'현재 단계 결과',status:'met',evidence_ids:[evidence.id]}],next_step:'다음 단계 결과도 확인하세요.'}))});
        if(stepReviews===2){assert(body.messages[0].content.includes('Pending later stages cannot block this step'));
          assert.equal(reads,3,'Repair the reviewer without repeating browser work');}
        return route.fulfill({json:reviewCompletion(review)});
      }
      reviews++;
      assert(body.messages[0].content.includes('ONLY final answer delivered'));
      if(reviews===1)return route.fulfill({json:reply(null,JSON.stringify({status:'revise',checks:[{requirement:'출처와 범위',status:'unmet',evidence_ids:[evidence.id]}],next_step:'열람 범위를 더 정확하게 표현하세요.'}))});
      assert.equal(review.proposed_answer,`공식 관람 안내: ${origin}/official. 현재 화면의 검색 결과만 확인했습니다.`);
      return route.fulfill({json:reviewCompletion(review)});
    }
    const result=body.messages.findLast(m=>m.role==='tool');
    if(!reads++){return route.fulfill({json:reply('list_tabs')});}
    if(reads===2){const inventory=JSON.parse(result.content);assert.equal(inventory.tabs.length,1);assert.equal(inventory.tabs[0].current,true);return route.fulfill({json:reply('browser_snapshot')});}
    if(reviews===1){assert.equal(reads,6);assert(body.messages.some(message=>String(message.content).includes('complete, self-contained replacement')));return route.fulfill({json:reply(null,`공식 관람 안내: ${origin}/official. 현재 화면의 검색 결과만 확인했습니다.`)});}
    if(reads===3){original=JSON.parse(result.content);
      assert(JSON.stringify(original).length>14000,'Fixture must reproduce original cutoff: '+JSON.stringify(original));}
    else assert([4,5].includes(reads),'Only the remaining two sequential steps may request another candidate');
    return route.fulfill({json:reply(null,`공식 관람 안내: ${origin}/official. 관찰한 검색 결과 범위에서 확인했습니다.`)});
  }catch(error){failure=error;await route.fulfill({status:500,body:'fixture assertion failed'});}});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>chrome.storage.local.set({browserWorkMode:'window',chat:{messages:[{id:'initial',role:'user',content:'현재 화면의 정보만 읽어주세요.'},{id:'ack',role:'assistant',content:'읽기 전용으로 확인하겠습니다.',state:'done'}],draft:''}}));
  await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token:'synthetic',receivedAt:1}}));
  const source=await context.newPage();await source.goto(origin+'/');
  ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  const rpc=message=>ui.evaluate(message=>chrome.runtime.sendMessage(message),message),state=async()=>(await rpc({type:'GET_STATE'})).data;
  await wait(async()=>!!(await state()).catalog?.models?.length);
  const uiId=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
  await worker.evaluate(async({uiId,origin})=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===origin+'/');await chrome.storage.session.set({chatSourceTabs:{[uiId]:tab.id}});},{uiId,origin});
  await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('현재 검색 결과에서 공식 관람 안내의 제목과 링크를 확인하고 안내문에 반영할 내용을 알려줘.');
  await ui.getByRole('button',{name:'전송',exact:true}).click();
  await wait(async()=>(await state()).chat?.messages?.length>2);
  await wait(async()=>{const current=await state(), last=current.chat?.messages?.at(-1); if(last?.state==='error')throw new Error(JSON.stringify({error:last.error,trace:last.trace,reads,reviews})); return !current.busy&&last?.state==='done';});
  assert.equal(reads,6);assert.equal(reviews,2);assert.equal((await state()).chat.task.goalReview.status,'complete');
  assert.equal(stepReviews,4);
  assert.deepEqual(reviewedSteps,['현재 검색 화면 확인','현재 검색 화면 확인','공식 안내 출처 확인','열람 범위와 결과 정리']);
  const completed=await state();assert(completed.chat.task.plan.every(step=>step.status==='completed'));assert.equal(completed.chat.task.plan.length,3);
  await ui.reload();await ui.locator('.task-plan-count').filter({hasText:'3/3'}).first().waitFor();
  assert.equal(await ui.locator('.task-plan .status-spinner').count(),0);
  assert((await state()).chat.messages.at(-1).content.includes(`${origin}/official`));
  await ui.screenshot({path:'verification/plan-completion-3of3.png',fullPage:true,animations:'disabled'});
  // Exercise the same reset contract used by the real-model runner.
  const next=await prepareEvaluationTrial({state,rpc,wait:ms=>ui.waitForTimeout(ms)});
  assert.equal(next.chat.messages.length,0);
  assert.deepEqual(errors,[]);
  await writeFile('verification/review-budget-browser.json',JSON.stringify({passed:true,observationCharacters:JSON.stringify(original).length,reads:1,reviews,stepReviews,completedPlan:'3/3',reloadVerified:true,finalAnswerVisible:true,resetVerified:true,errors,actualBrowser:true,actualModel:false},null,2));
  console.log('PASS full large observation reaches reviewer without rereading; corrected full answer and new evaluation conversation are verified');
} catch(error) {console.log({errors,reads,reviews,scriptErrors:await worker?.evaluate(()=>testScriptErrors)});if(ui)console.log(JSON.stringify(await ui.evaluate(async()=>{const s=(await chrome.runtime.sendMessage({type:'GET_STATE'})).data;const m=s.chat?.messages?.at(-1);return {busy:s.busy,state:m?.state,error:m?.error,question:m?.question?.text,trace:m?.trace,taskStatus:s.chat?.task?.status};})));throw error;} finally {await context?.close();server.close();await rm(profile,{recursive:true,force:true});}
