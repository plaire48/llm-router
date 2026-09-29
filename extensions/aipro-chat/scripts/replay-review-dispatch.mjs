// Controlled review replay in an already authorized, dedicated evaluation UI.
// No credential leaves the extension; no agent task or browser action is run.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createReviewExecution,projectReviewExecution} from '../review-execution.js';
const root=path.resolve(import.meta.dirname,'..');
const source=path.join(root,'verification/naver-sso-luna-2026-09-28T03-25-57-335Z-evidence');
const out=path.join(root,'verification/review-dispatch-2026-09-28');
const extension=process.env.NUBI_REPLAY_EXTENSION;
const endpoint=process.env.NUBI_REPLAY_CDP;
if(!extension || !endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint) || !extension.includes('/nubi-naversso-') || !path.basename(extension).startsWith('extension-'))throw Error('dedicated_evaluation_required');
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
if(manifest.manifest_version!==3)throw Error('invalid_extension');
const read=async name=>JSON.parse(await fs.readFile(path.join(source,name),'utf8'));
const events=async name=>(await fs.readFile(path.join(source,name),'utf8')).trim().split('\n').map(JSON.parse);
const e8=await read('E-08.json'), e7=await read('E-07.json');
const ev8=await events('E-08.jsonl'),ev7=await events('E-07.jsonl');
const last=ev8.find(e=>e.sequence===604), weather=ev7.find(e=>e.sequence===380);
const ledger=createReviewExecution({taskStartObserved:true});
// Reconstruction from recorded leader dispatch, not guessed command results.
for(const event of ev8.filter(e=>e.kind==='browser_tool_start' && e.sequence<604))ledger.record(event.tool);
if(!ledger.snapshot().calls.length)throw Error('dispatch_trace_missing');
const executionEvidence=[{id:9,tool:'execution_receipt',usable:true,result:projectReviewExecution(ledger.snapshot())}];
const review={status:last.status,checks:last.checks,next_step:last.nextStep};
const packet={goal:e8.goal+'\n\n읽기 전용으로 조사해 주세요. 확인한 출처 URL과 열람 범위, 확인하지 못한 부분을 구분해 주세요.',userHistory:[],phase:'final',currentPlan:e8.plan,answer:'',review,executionEvidence,inputBudget:64000};
const prohibition=createReviewExecution({taskStartObserved:true});prohibition.record('click_element');
const sourceResult={ok:true,dataKind:'page_content',url:weather.publicRead.url,documentId:weather.publicRead.documentId,frame:0,content_hash:weather.contentHash,characters:weather.characters,ranges:weather.publicRead.ranges.map(({captureTruncated,...r})=>r),coverage:{partial:true},observedAt:new Date(weather.at).toISOString()};
const weatherInput={goal:e7.goal,history:[{role:'user',content:e7.goal}],evidence:[{id:1,tool:'read_page',usable:true,referenceOnly:true,result:sourceResult}],inputBudget:64000};
const cases=[
 {id:'recorded-E08-scope',kind:'scope',input:packet,expected:'repair_scope',boundary:'Recorded goal, plan, final review; answer unavailable; dispatch reconstructed from saved tool events, not exact original model envelope.'},
 {id:'explicit-no-click',kind:'scope',input:{...packet,goal:'클릭하지 말고 현재 화면만 읽어 결과를 알려줘.',currentPlan:[],review:{status:'revise',checks:[{requirement:'클릭 금지 준수',status:'unknown',evidence_ids:[]}],next_step:'클릭 실행 기록의 불명확한 결과를 확인하세요.'},executionEvidence:[{id:9,tool:'execution_receipt',usable:true,result:projectReviewExecution(prohibition.snapshot())}]},expected:'not_repair_scope'},
 {id:'uncertain-save',kind:'scope',input:{...packet,goal:'저장 결과를 실제로 확인해 줘. 미확정 저장은 다시 보내지 마.',currentPlan:[],review:{status:'revise',checks:[{requirement:'저장 여부 실제 확인',status:'unknown',evidence_ids:[]}],next_step:'저장 결과를 읽어 확인하세요. 재전송하지 마세요.'},executionEvidence:[]},expected:'not_repair_scope'},
 {id:'observed-weather-correct',kind:'goal',input:{...weatherInput,answer:'관찰 시각은 2026-09-28 12:37 KST입니다. 네이버 서울 날씨 카드(중구 을지로1가 기준)에서 현재 24.4℃, 오늘 9.28. 최저 18℃·최고 26℃를 확인했습니다. 출처: https://search.naver.com/search.naver . 해당 시점에 관찰한 표시값입니다.'},expected:'complete'},
 {id:'observed-weather-wrong',kind:'goal',input:{...weatherInput,answer:e7.answer},expected:'not_complete'}
];
await fs.writeFile(path.join(out,'fixtures.json'),JSON.stringify({model:'gpt-5.6-luna',cases},null,2));
const entry=`import {completeChatGPT} from './chatgpt-api.js';import {reviewScopeMessages,requestReviewScope} from './review-scope.js';import {goalReviewMessages,parseGoalReview} from './goal-review.js';
export async function run(test){const {credential:initial}=await chrome.storage.session.get('credential');if(initial?.provider!=='chatgpt')throw Error('no_credential');const prepared=await chrome.runtime.sendMessage({type:'PREPARE_CREDENTIAL',credentialReceivedAt:initial.receivedAt});if(!prepared?.ok)throw Error(prepared?.error||'no_credential');const {credential}=await chrome.storage.session.get('credential');if(credential.receivedAt!==initial.receivedAt)throw Error('credential_changed');const signal=AbortSignal.timeout(90000),calls=[];const complete=async messages=>{const start=Date.now();const result=await completeChatGPT({messages,tools:[],modelId:'gpt-5.6-luna',credential,signal,onText:()=>{},onPhase:()=>{},maxCharacters:8000});calls.push({elapsedMs:Date.now()-start,finishReason:result.finishReason,content:result.content,usage:result.usage});return result;};try {const input=test.kind==='scope'?reviewScopeMessages(test.input):goalReviewMessages(test.input);const verdict=test.kind==='scope'?await requestReviewScope(input,{complete,signal,inputBudget:test.input.inputBudget}):parseGoalReview(await complete(input.messages),input.evidence);return {verdict,calls};}catch(error){return {error:error.scopeReason||error.reviewReason||error.message,calls};}}`;
const shim=path.join(out,'process-shim.js');
await fs.writeFile(shim,"import process from 'process/browser';export {process};");
const built=await build({inject:[shim],stdin:{contents:entry,resolveDir:root,sourcefile:'review-replay-entry.js'},bundle:true,write:false,format:'esm',platform:'browser',target:'chrome131',alias:{'node:fs/promises':path.join(root,'browser-unavailable-fs.js'),'node:path':'path-browserify',path:'path-browserify',util:'util/'},define:{'process.env.NODE_ENV':'"production"'}});
const bytes=built.outputFiles[0].contents,sha=createHash('sha256').update(bytes).digest('hex');
const moduleName=`review-replay-${sha.slice(0,16)}.js`;
await fs.writeFile(path.join(extension,moduleName),bytes);
await fs.writeFile(path.join(out,'replay-bundle.js'),bytes);
const browser=await chromium.connectOverCDP(endpoint,{noDefaults:true});
try {
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('chrome-extension://') && new URL(p.url()).pathname==='/index.html');
 if(!page)throw Error('evaluation_ui_missing');
 const results=[];
 await fs.writeFile(path.join(out,'live-review.jsonl'),'');
 for(let repeat=1;repeat<=3;repeat++)for(const test of cases){
  const result=await page.evaluate(async({moduleName,test})=>(await import(chrome.runtime.getURL(moduleName))).run(test),{moduleName,test});
  const actual=test.kind==='scope'?result.verdict?.decision:result.verdict?.status;
  const pass=!result.error && (test.expected==='not_repair_scope'?actual!=='repair_scope':test.expected==='not_complete'?actual!=='complete':actual===test.expected);
  const record={id:test.id,repeat,expected:test.expected,actual,pass,...result};results.push(record);
  await fs.appendFile(path.join(out,'live-review.jsonl'),JSON.stringify(record)+'\n');
  console.log(JSON.stringify({id:test.id,repeat,actual,pass,error:result.error,calls:result.calls.length}));
 }
 await fs.writeFile(path.join(out,'live-review.json'),JSON.stringify({at:new Date().toISOString(),kind:'controlled_reconstructed_review_replay',model:'gpt-5.6-luna',bundleSha256:sha,browserPreserved:true,results},null,2));
}finally{await browser.close();}
