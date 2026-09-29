import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {goalReviewMessages} from '../goal-review.js';
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<main><h1>처리 목록</h1><p id="position">1 / 3쪽</p><table><thead><tr><th>번호</th><th>상태</th><th>인원</th></tr></thead><tbody></tbody></table></main><button id="prev">이전</button><button id="next">다음</button><script>
const data=[[['K1','완료',5],['K2','대기',7]],[['K3','완료',11],['K4','취소',4]],[['K5','완료',3],['K6','완료',2]]];let p=0;window.visited=[];
function render(){visited.push(p+1);document.querySelector('#position').textContent=(p+1)+' / 3쪽';document.querySelector('tbody').innerHTML=data[p].map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('');prev.disabled=p===0;next.disabled=p===2;}prev.onclick=()=>{p--;render();};next.onclick=()=>{p++;render();};render();</script>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,profile=await mkdtemp(resolve(tmpdir(),'nubi-pagination-')),extension=resolve(profile,'extension');
let context;const actions=[],reviews=[];
try{
 await cp(resolve('dist'),extension,{recursive:true});const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push(origin+'/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 await appendFile(resolve(extension,'background.js'),'\nglobalThis.pagerProbe={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const page=await context.newPage();await page.goto(origin);const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>pagerProbe.ready);
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url+'/').id,origin);
 const tools=browserTools({},BUILTIN_SKILLS.find(s=>s.id==='browser-agent'));
 const initialPlan=[1,2,3].map((n,i)=>({text:`${n}쪽 확인`,status:i?'pending':'in_progress',expected_outcome:`${n}쪽의 번호, 상태, 인원 확인`}));let plan=initialPlan,round=0;
 const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 const result=await runAgent({goal:'3쪽 목록의 완료 항목 번호와 인원을 합산해줘.',messages:[{role:'user',content:'3쪽 목록의 완료 항목 번호와 인원을 합산해줘.'}],tools,signal:new AbortController().signal,harness:true,preparePlan:async()=>initialPlan,
 complete:async wire=>{const last=JSON.parse(wire.findLast(m=>m.role==='tool')?.content||'{}');
  switch(++round){
   case 1:return call('browser_snapshot');
   case 2:case 4:{assert.equal(last.source_capture?.status,'observed',JSON.stringify(last));const el=(last.observation||last).frames.flatMap(f=>f.elements||[]).find(e=>e.id==='next');return call('click_element',{ref:el.ref});}
   case 3:case 5:return call('verify_page',{checks:[{kind:'text_present',expected:round===3?'2 / 3쪽':'3 / 3쪽'}]});
   case 6:assert.equal(last.source_capture?.status,'observed',JSON.stringify(last));return call('update_plan',{steps:initialPlan.map(s=>({...s,status:'completed'}))});
   default:assert.equal(round,7);return {content:'완료 항목은 K1 5명, K3 11명, K5 3명, K6 2명입니다. 총 4건, 21명입니다.'};
  }
 },execute:async(name,args)=>{actions.push(name);if(name==='update_plan'){plan=structuredClone(args.steps);return {ok:true,plan};}return worker.evaluate(async({name,args,tabId})=>(await pagerProbe.runBrowserAgent('pager-run',{tabId},name,args)).result,{name,args,tabId});},
 reviewGoal:async({evidence,phase='final',stepOutcomes,answer,executionLedger})=>{
  assert(executionLedger.taskStartObserved);assert.equal(executionLedger.onlyReadOnlyToolsInvoked,false);
  assert.equal(executionLedger.calls.find(call=>call.tool==='click_element').count,2);
  const refs=evidence.filter(e=>e.referenceOnly&&e.usable);assert.deepEqual(refs.map(e=>e.result.page_view.current),[1,2,3]);
  const text=refs.map(e=>e.result.ranges.map(r=>r.markdown).join('')).join('\n');for(const id of ['K1','K2','K3','K4','K5','K6'])assert(text.includes(id));
  const ctx=goalReviewMessages({goal:'완료 항목 합계',history:[],evidence,phase,stepOutcomes,answer,inputBudget:20000});const payload=JSON.parse(ctx.messages[1].content);assert(refs.every(e=>payload.citeable_evidence_ids.includes(e.id)));
  // Historical controls remain unusable; only text references survive.
  assert.equal(evidence.find(e=>e.tool==='click_element').usable,false);
  assert(evidence.filter(e=>e.tool==='click_element'&&e.usable).every(e=>e.result.observation.frames[0].page_view.current===3));
  reviews.push(phase);return {status:'complete'};
 }});
 assert.equal(plan.filter(s=>s.status==='completed').length,3);assert(result.content.includes('21명'));assert.deepEqual(await page.evaluate(()=>visited),[1,2,3]);
 // Pages 2 and 3 are kept at the click and read once more when their check passes.
 assert.equal(actions.filter(n=>n==='read_page').length,5);assert.deepEqual(reviews,['plan_step','final']);
 // Ambiguous and hidden counters never manufacture a distinct source view.
 await page.evaluate(()=>{const p=document.querySelector('#position');p.insertAdjacentHTML('afterend','<p>1 / 5쪽</p>');});
 const ambiguous=await worker.evaluate(async tabId=>(await pagerProbe.runBrowserAgent('pager-run',{tabId},'browser_snapshot')).result,tabId);assert(!ambiguous.frames[0].page_view);
 await mkdir('verification/browser-30/remaining-fixes',{recursive:true});await page.screenshot({path:'verification/browser-30/remaining-fixes/pagination.png'});
 await writeFile('verification/browser-30/remaining-fixes/pagination-browser.json',JSON.stringify({actualBrowser:true,actualModel:false,plan:'3/3',answer:result.content,actions,reviews,visits:[1,2,3],checks:['all three source views retained','one forward visit per page','stale action evidence unusable','independent step and final review','ambiguous counters rejected']},null,2));
 console.log('PASS pagination references, 3/3 and final answer, no backward rereads');await worker.evaluate(()=>pagerProbe.stopBrowserAgent('pager-run'));
}finally{await context?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
