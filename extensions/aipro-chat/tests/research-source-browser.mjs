import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
import {goalReviewMessages} from '../goal-review.js';
import {createResearchSourceCapture} from '../research-source-capture.js';
import {createHash} from 'node:crypto';

const visits = {a: 0, b: 0}, checks = [], actions = [], phases = [];
const output = process.env.NUBI_VERIFICATION_DIR || 'verification/research-source';
const server = createServer((req, res) => {
  const key = req.url === '/b' ? 'b' : 'a';
  if (req.url === '/a' || req.url === '/b') visits[key]++;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<title>조건 ${key.toUpperCase()}</title><main><h1>조건 ${key.toUpperCase()}</h1><p>${key === 'a' ? '원문 A의 비용은 1만원이며 신청 마감은 10월 1일입니다.' : '원문 B의 비용은 2만원이며 신청 마감은 10월 2일입니다.'}</p><p>${'확인한 범위는 현재 문서의 비용과 신청 마감입니다. '.repeat(8)}</p></main>${key === 'a' ? '<a id="next-source" href="/b">다른 출처 열기</a>' : ''}`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-research-source-')), extension = resolve(profile, 'extension');
let context;
try {
  await cp(resolve('dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.sourceProbe={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  const page = await context.newPage(); await page.goto(`${origin}/a`);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await sourceProbe.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, `${origin}/a`);
  const run = (name, args) => worker.evaluate(async input => (await sourceProbe.runBrowserAgent('research-probe', {tabId: input.tabId}, input.name, input.args)).result, {tabId, name, args});
  const plan = [{text:'첫 출처 확인',status:'in_progress',expected_outcome:'원문 A의 비용과 마감 시각 확인'},
    {text:'두 번째 출처와 비교',status:'pending',expected_outcome:'원문 B를 읽고 두 원문의 차이와 범위를 설명'}];
  let round=0, savedPlan; const events=[], workerReads=new Set();
  const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const result=await runAgent({goal:'두 원문의 비용과 신청 마감을 비교해줘',messages:[{role:'user',content:'두 원문의 비용과 신청 마감을 비교해줘'}],
    tools:browserTools({},BUILTIN_SKILLS.find(skill=>skill.id==='browser-agent')),signal:new AbortController().signal,
    harness:true,preparePlan:async()=>plan,onStep:event=>events.push(event),
    completeAnalysis:async wire=>{
      const assignment=JSON.parse(wire.find(message=>message.role==='user').content);
      const id=assignment.evidence[0].evidence_id;
      if(!wire.some(message=>message.role==='tool'))return call('read_analysis_evidence',{evidence_id:id});
      workerReads.add(id);
      return {content:JSON.stringify({status:'complete',summary:'배정한 원문의 비용과 마감 확인',findings:[{text:'비용과 신청 마감이 원문에 명시되어 있습니다.',evidence_ids:[id]}],uncertainties:[],next_step:''})};
    },
    complete:async messages=>{
      const payload=JSON.parse(messages.findLast(message=>message.role==='tool')?.content||'{}');
      switch(++round){
        case 1:return call('browser_snapshot');
        case 2:assert.equal(payload.source_capture.status,'observed');assert(payload.source_capture.reference.ranges[0].markdown.includes('1만원'));
          return call('update_plan',{steps:plan.map((step,index)=>({...step,status:index?'in_progress':'completed'}))});
        case 3:{const observation=JSON.parse(messages.find(message=>message.role==='tool'&&message.content.includes('next-source')).content);
          return call('click_element',{ref:observation.frames.flatMap(frame=>frame.elements||[]).find(element=>element.id==='next-source').ref});}
        case 4:assert.equal(payload.source_capture.status,'observed');assert(payload.source_capture.reference.ranges[0].markdown.includes('2만원'));return call('collect_analysis');
        case 5:return call('update_plan',{steps:plan.map(step=>({...step,status:'completed'}))});
        default:assert.equal(round,6);return {content:'열람한 두 원문에서 A는 1만원과 10월 1일, B는 2만원과 10월 2일입니다.'};
      }
    },execute:async(name,args)=>{actions.push(name);if(name==='update_plan'){savedPlan=structuredClone(args.steps);return {ok:true,plan:savedPlan};}return run(name,args);},
    reviewGoal:async({evidence,phase='final',stepOutcomes})=>{
      phases.push(phase);
      const refs=evidence.filter(item=>item.referenceOnly&&item.usable);
      if(phase==='plan_step'&&stepOutcomes[0].text===plan[0].text){assert.equal(refs.length,1);assert.equal(refs[0].result.url,`${origin}/a`);}
      else{assert.equal(refs.length,2);assert(refs.some(item=>item.result.ranges[0].markdown.includes('2만원')));}
      const context=goalReviewMessages({goal:'두 원문 비교',history:[],evidence,answer:'',inputBudget:12000,phase,stepOutcomes});
      if(phase==='plan_step')assert.equal(JSON.parse(context.messages[1].content).evaluation_contract.scope,'step_outcomes_only');
      else assert.match(context.messages[0].content,/FINAL TASK/);
      return {status:'complete'};
    }});
  assert(result.content.includes('2만원'));assert(savedPlan.every(step=>step.status==='completed'));
  assert.equal(workerReads.size,2);assert.equal(actions.filter(name=>name==='read_page').length,2);assert.equal(actions.filter(name=>name==='click_element').length,1);
  assert.deepEqual(visits,{a:1,b:1});assert.equal(new Set(events.filter(event=>event.tool==='analysis_page'&&event.status==='done').map(event=>event.index)).size,2);
  checks.push('opening each real source automatically captures bounded text and passes two frozen IDs to actual Pi workers');
  checks.push('first step passes with its own evidence before later-source work; final review retains both original texts');
  checks.push('both workers read their assignments and the leader finishes without return navigation or repeated source reads');
  const retained=[],eventsAfterReload=[];let reloadOnRead=true;
  const capture=createResearchSourceCapture({enabled:false,preserveReadSources:true,
    tools:browserTools({},BUILTIN_SKILLS.find(skill=>skill.id==='browser-agent')),signal:new AbortController().signal,
    evidence:retained,onStep:event=>eventsAfterReload.push(event),execute:async(name,args)=>{
      if(reloadOnRead){reloadOnRead=false;await page.reload();}
      return run(name,args);
    }});
  const beforeReload=await run('browser_snapshot',{}),oldDocument=beforeReload.frames.find(frame=>frame.frame===0).documentId;
  assert(oldDocument);
  const replaced=await capture('browser_snapshot',beforeReload,true);
  assert.equal(replaced.source_capture.status,'unavailable');assert.equal(retained.length,0);
  const afterReload=await run('browser_snapshot',{}),newDocument=afterReload.frames.find(frame=>frame.frame===0).documentId;
  assert.notEqual(oldDocument,newDocument);assert.equal(beforeReload.url,afterReload.url);
  assert.equal((await capture('browser_snapshot',afterReload,true)).source_capture.status,'observed');
  assert.equal(retained.length,1);assert.equal(retained[0].result.source_document_id,newDocument);
  checks.push('same-URL Chrome reload during automatic capture rejects replacement text; a fresh identified observation captures it');
  assert(Number.isFinite(Date.parse(afterReload.frames[0].observedAt)));
  assert(Number.isFinite(Date.parse(retained[0].result.observedAt)));
  const scripted=await run('run_playwright',{code:'console.log(await browser.snapshot());'});
  assert(!scripted.error);
  assert(Number.isFinite(Date.parse(scripted.observation.frames[0].observedAt)));
  checks.push('static DOM, Playwright observation and preserved content carry host read timestamps independently of source text dates');
  const hashes={};
  for(const file of ['agent-runtime.js','research-source-capture.js','dist/background.js'])hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
  console.log(checks.join('\n'));await mkdir(output,{recursive:true});
  await page.screenshot({path:resolve(output,'second-source.png')});
  await writeFile(resolve(output,'browser.json'),JSON.stringify({checks,actions,phases,visits,workerReads:[...workerReads],actualBrowser:true,actualModel:false,firstStepCompleted:true,finalCompleted:true,
    sourceHostWithExistingBrowserBundle:true,hashes,reload:{oldDocument,newDocument,events:eventsAfterReload}},null,2));
  await worker.evaluate(() => sourceProbe.stopBrowserAgent('research-probe'));
} finally {await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, {recursive: true, force: true});}
