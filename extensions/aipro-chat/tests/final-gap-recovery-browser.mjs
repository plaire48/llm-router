import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const visits = {a: 0, b: 0}, checks = [], actions = [];
const server = createServer((req, res) => {
  const key = req.url === '/b' ? 'b' : 'a';
  if (req.url === '/a' || req.url === '/b') visits[key]++;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<title>조건 ${key.toUpperCase()}</title><main><h1>조건 ${key.toUpperCase()}</h1><p>${key === 'a' ? '원문 A의 비용은 1만원이며 신청 마감은 10월 1일입니다.' : '원문 B의 비용은 2만원이며 신청 마감은 10월 2일입니다.'}</p><p>${'확인한 범위는 현재 문서의 비용과 신청 마감입니다. '.repeat(8)}</p></main>${key === 'a' ? '<a id="next-source" href="/b">다른 출처 열기</a>' : ''}`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-final-gap-')), extension = resolve(profile, 'extension');
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
  let rounds=0,reviews=0,analysisCalls=0,analysisReads=0,originalSnapshot;const events=[],results=[];
  const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const result=await runAgent({goal:'원문의 비용과 신청 마감을 확인하세요. 신청하거나 저장하지 마세요.',messages:[{role:'user',content:'원문의 비용과 신청 마감을 확인하세요. 신청하거나 저장하지 마세요.'}],
    tools:browserTools({},BUILTIN_SKILLS.find(skill=>skill.id==='browser-agent')).filter(tool=>tool.function.name!=='update_plan'),signal:new AbortController().signal,
    harness:true,onStep:event=>events.push(event),onDiagnostic:event=>results.push(event),
    completeAnalysis:async(wire,selected)=>{
      analysisCalls++;assert.deepEqual(selected.map(tool=>tool.function.name),['read_analysis_evidence']);
      const brief=JSON.parse(wire[1].content);assert.match(brief.task,/final task answer/);
      const source=brief.evidence.find(item=>item.tool==='browser_snapshot');assert(source);
      // Region metadata makes this real snapshot exceed the bounded 2400-char
      // preload. Follow the allowed reader instead of asserting every brief
      // must contain the full original page, or enlarging the product budget.
      // A large source may carry one query-matched excerpt (analysis-agents.js);
      // it is partial, so the worker still reads the whole observation below.
      assert(source.characters>2400);
      assert((brief.evidence_reads||[]).every(packet=>packet.evidence_id===source.evidence_id&&packet.selection==='query'&&packet.coverage==='partial'));
      const reads=wire.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
      if(!reads.length)return call('read_analysis_evidence',{evidence_id:source.evidence_id});
      analysisReads=reads.length;
      assert(reads.every(packet=>packet.evidence_id===source.evidence_id&&packet.coverage_scope==='returned_observation_only'));
      const last=reads.at(-1);
      if(last.next_offset!==null)return call('read_analysis_evidence',{evidence_id:source.evidence_id,offset:last.next_offset});
      const actual=reads.map(packet=>packet.text).join('');
      const expected=JSON.stringify({input:{},result:originalSnapshot},(key,value)=>key==='image'?undefined:value);
      assert.equal(actual,expected,'The worker must receive the entire original observation including its text, regions and coverage');
      const observed=JSON.parse(actual).result;
      assert(observed.frames.some(frame=>frame.text.includes('10월 1일')));
      assert(observed.frames.some(frame=>frame.retrieval?.textBlocks?.length));
      return {content:JSON.stringify({status:'complete',summary:'마감일 설명이 빠졌습니다.',findings:[{text:'원문에 비용과 신청 마감이 있습니다.',evidence_ids:brief.evidence.map(item=>item.evidence_id)}],uncertainties:[],next_step:'read_page content로 마감일을 확인하고 답변에 포함하세요.'})};
    },
    complete:async wire=>{
      if(++rounds===1)return call('browser_snapshot');
      if(rounds===4){assert(JSON.stringify(wire).includes('Delegated analysis returned.'));return call('read_page',{mode:'content'});}
      assert(rounds<=5);return {content:rounds<4?'비용은 1만원입니다.':'비용은 1만원이며 마감은 10월 1일입니다.',finishReason:'stop'};
    },execute:async(name,args)=>{actions.push(name);assert(['browser_snapshot','read_page'].includes(name));const result=await run(name,args);if(name==='browser_snapshot')originalSnapshot=structuredClone(result);return result;},
    reviewGoal:async({evidence,answer})=>{
      reviews++;
      if(reviews<3)return {status:'revise',checks:[{requirement:'마감일 설명',status:'unmet',evidence_ids:[]}],next_step:'원문 마감일을 확인해 답변에 포함하세요.'};
      assert(answer.includes('10월 1일'));assert(evidence.some(item=>item.referenceOnly&&item.result.ranges.some(range=>range.markdown.includes('10월 1일'))));
      return {status:'complete'};
    }});
  const children=new Set(events.filter(event=>event.tool==='analysis_recovery').map(event=>event.index)).size;
  assert.equal(children,1);assert.equal(analysisCalls,2);assert.equal(analysisReads,1);assert.equal(reviews,3);assert.equal(rounds,5);assert(result.content.includes('10월 1일'));
  // The opened source is captured once by the host (read_page mode=content,
  // research-source-capture.js) before the leader's own read after the advice.
  assert.deepEqual(actions,['browser_snapshot','read_page','read_page']);assert.deepEqual(visits,{a:1,b:0});
  assert(events.some(event=>event.tool==='read_page'&&event.index==='research-source-1'&&event.status==='done'));
  assert(events.some(event=>event.tool==='analysis_recovery'&&event.analysis?.delivered));
  assert.equal(results.at(-1).outcome,'answer');assert.equal(results.at(-1).verification,'passed');
  checks.push('two unchanged final gaps start one actual Pi recovery worker before asking the user');
  checks.push('the worker explicitly reads the assigned snapshot above the preload threshold with exact original text, regions and coverage');
  checks.push('the leader receives review and worker advice together, reads the actual source and passes final review');
  checks.push('no navigation, write, approval or replay occurs; worker advice is not final proof');
  console.log(checks.join('\n'));await mkdir('verification/final-gap-recovery',{recursive:true});
  await page.screenshot({path:'verification/final-gap-recovery/source.png'});
  await writeFile('verification/final-gap-recovery/browser.json',JSON.stringify({checks,actions,visits,rounds,reviews,children,analysisCalls,analysisReads,sourceCharacters:JSON.stringify({input:{},result:originalSnapshot}).length,actualBrowser:true,actualModel:false,finalCompleted:true},null,2));
  await worker.evaluate(() => sourceProbe.stopBrowserAgent('research-probe'));
} finally {await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, {recursive: true, force: true});}
