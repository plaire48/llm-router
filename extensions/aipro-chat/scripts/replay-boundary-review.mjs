// Frozen, reduced review comparisons. This never resumes a browser agent task.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {goalReviewMessages,parseGoalReview,reviewEvidence,GOAL_REVIEW_PROMPT} from '../goal-review.js';
import {observeEvaluationDialogs} from './evaluation-dialogs.mjs';
const root=path.resolve(import.meta.dirname,'..');
const out=path.resolve(root,process.env.NUBI_REPLAY_OUTPUT || 'verification/semantic-review-2026-09-28');
const source=path.join(root,'verification/naver-sso-luna-2026-09-28T04-02-30-429Z-evidence');
const extension=process.env.NUBI_REPLAY_EXTENSION,endpoint=process.env.NUBI_REPLAY_CDP;
if(!extension?.includes('/nubi-naversso-') || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint||''))throw Error('dedicated_evaluation_required');
const manifest=JSON.parse(await fs.readFile(path.join(extension,'manifest.json'),'utf8'));
if(!manifest.version_name?.startsWith('evaluation-'))throw Error('evaluation_manifest_required');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const hash=value=>createHash('sha256').update(value).digest('hex');
const before=await read(path.join(out,'before/prompt.json'));
const after=process.env.NUBI_REPLAY_AFTER_PROMPT ? await read(path.resolve(root,process.env.NUBI_REPLAY_AFTER_PROMPT)) : GOAL_REVIEW_PROMPT;
if(typeof before!=='string' || typeof after!=='string')throw Error('invalid_replay_prompt');
await fs.writeFile(path.join(out,'run-lock.json'),JSON.stringify({startedAt:new Date().toISOString(),purpose:'Prevent overwriting a prior measured comparison'}),{flag:'wx'});
const e1=await read(path.join(source,'E-01.json')),e4=await read(path.join(source,'E-04.json'));
const audit=await read(path.join(source,'E-01-link-audit.json'));
const pages=await read(path.join(out,'pdf-pages.json'));
const pdf=await read(path.join(root,'verification/browser-pdf/public-fie-render.json'));
const png=await fs.readFile(path.join(root,'verification/browser-pdf/public-fie-page34.png'));
function reference(text,url,id=1){return reviewEvidence(id,'read_page',{}, {ok:true,dataKind:'page_content',url,frame:0,documentId:'reconstructed-review-fixture',content_hash:hash(text),characters:text.length,ranges:[{start:0,end:text.length,markdown:text}],coverage:{partial:true}});}
const listing=audit[0].result.links.map(link=>`${link.text}\n${link.url}\n${link.context}`).join('\n\n');
const titleGoal='현재 검색 결과 페이지에서 광고를 제외한 일반 결과 2개의 제목과 링크를 알려줘. 원문 열람 여부를 밝혀줘.';
const titleEvidence=[reference(listing,'https://search.naver.com/search.naver')];
const titleWrong=e1.answer.replace('일반 결과 상위 2개','일반 결과 2개');
const titleCorrect=titleWrong.replace('[대한민국 구석구석]',"[국립중앙박물관 > 여행지 - '열린 관광' 모두의 여행]");
const pdfText=pages.filter(p=>p.page!==34).map(p=>`PDF page ${p.page}\n${p.text}`).join('\n\n');
const ruleEvidence=[reference(pdfText,pdf.url)];
const image={mimeType:'image/png',width:pdf.width,height:pdf.height,source:{url:pdf.url,raw_sha256:pdf.rawSha256,page:34,page_count:pdf.pageCount,documentId:'reconstructed-review-fixture'}};
const imageEvidence=reviewEvidence(2,'read_page',{}, {ok:true,dataKind:'pdf_page_reference',referenceImageStatus:'available',referenceImage:image});
const fullRuleEvidence=[...ruleEvidence,imageEvidence];
const excerpt=pages.find(p=>p.page===33).text.match(/THE TARGET[\s\S]*/)[0].split('2   At sabre')[0];
const base=(goal,answer,evidence,extra={})=>({goal,history:[{role:'user',content:goal}],answer,evidence,inputBudget:64000,...extra});
const cases=[
 {id:'result-site-label',expected:'not_complete',input:base(titleGoal,titleWrong,titleEvidence)},
 {id:'result-heading',expected:'complete',input:base(titleGoal,titleCorrect,titleEvidence)},
 {id:'unread-rule-boundary',expected:'not_complete',input:base(e4.goal,e4.answer,ruleEvidence)},
 {id:'observed-rule-boundary',expected:'complete',input:base(e4.goal,`에페는 몸 전체와 의복·장비가 유효면이고, 사브르는 머리·몸통·팔 등 허리 위 유효면이지만 손은 제외됩니다. 에페 t.91과 사브르 t.97 원문, PDF 34쪽 Figure 6에서 손이 색칠된 유효면 밖임을 확인했습니다. 열람 범위는 PDF 31·33쪽 텍스트와 34쪽 그림이며 전체 문서 정독은 아닙니다. 출처: ${pdf.url}`,fullRuleEvidence,{sourceImages:[{...image,evidenceId:2,data:png.toString('base64')}]})},
 {id:'excerpt-only-request',expected:'complete',input:base('제공된 t.97 첫 항목 원문만 인용하고 그 범위를 밝혀줘. 전체 유효면 설명이나 추가 조사는 요청하지 않아.',`PDF 33쪽 t.97 첫 항목 인용: ${excerpt}\n열람 범위는 해당 문장뿐이며 Figure 6은 읽지 않았습니다. 출처: ${pdf.url}`,ruleEvidence)}
];
if(process.env.NUBI_REPLAY_EXPLICIT_RULE_SOURCE==='1') {
 const supplemental=await read(path.join(out,'supplemental-source.json'));
 if(supplemental.url!=='https://www.britishfencing.com/olympic-fencing-facts-and-faqs/' || !supplemental.text.includes('hands'))throw Error('supplemental_source_missing');
 const test=cases.find(test=>test.id==='observed-rule-boundary');
 test.input.evidence.push(reference(supplemental.text,supplemental.url,3));
 test.input.answer=`에페는 몸 전체와 의복·장비가 유효면입니다. 사브르는 허리 위 대부분이 유효면이며 영국펜싱협회 FAQ는 손과 뒷머리를 제외한다고 명시합니다. FIE t.91/t.97의 텍스트와 34쪽 Figure 6, 협회 FAQ의 무기 설명 부분을 읽었습니다. 전체 문서 정독은 아닙니다. 출처: ${pdf.url} 및 ${supplemental.url}`;
}
const latest=await read(path.join(root,'verification/naver-sso-luna-2026-09-28T07-49-14-159Z.json'));
const bad=cases.find(test=>test.id==='unread-rule-boundary');bad.input.answer=latest.trials.find(test=>test.id==='E-04').answer;
const selected=process.env.NUBI_REPLAY_CASES?cases.filter(test=>process.env.NUBI_REPLAY_CASES.split(',').includes(test.id)):cases;
if(!selected.length)throw Error('no_replay_cases');
await fs.writeFile(path.join(out,'fixtures.json'),JSON.stringify({boundary:'Reduced final-review inputs reconstructed from saved public evidence; explicit input interaction/rank removed from E-01. E-04 omits original page-33 pixels and adds page-34 pixels only in the positive control. Optional supplemental source changes the evidence and answer; not a same-input comparison with the original experiment. Not original full envelopes or full browser tasks.',model:'gpt-5.6-luna',cases:selected},null,2));
const entry=`import {completeChatGPT} from './chatgpt-api.js';export async function run(messages){const {credential:initial}=await chrome.storage.session.get('credential');if(initial?.provider!=='chatgpt')throw Error('no_credential');const prepared=await chrome.runtime.sendMessage({type:'PREPARE_CREDENTIAL',credentialReceivedAt:initial.receivedAt});if(!prepared?.ok)throw Error(prepared?.error||'credential_unavailable');const {credential}=await chrome.storage.session.get('credential');if(credential.receivedAt!==initial.receivedAt)throw Error('credential_changed');const started=Date.now();const r=await completeChatGPT({messages,tools:[],modelId:'gpt-5.6-luna',credential,signal:AbortSignal.timeout(90000),onText:()=>{},onPhase:()=>{},maxCharacters:8000});return {content:r.content,finishReason:r.finishReason,elapsedMs:Date.now()-started,usage:r.usage};}`;
const shim=path.join(out,'process-shim.js');await fs.writeFile(shim,"import process from 'process/browser';export {process};");
const bundle=await build({inject:[shim],stdin:{contents:entry,resolveDir:root,sourcefile:'semantic-review-entry.js'},bundle:true,write:false,format:'esm',platform:'browser',target:'chrome131',alias:{'node:fs/promises':path.join(root,'browser-unavailable-fs.js'),'node:path':'path-browserify',path:'path-browserify',util:'util/'},define:{'process.env.NODE_ENV':'"production"'}});
const bytes=bundle.outputFiles[0].contents,moduleName=`semantic-review-${hash(bytes).slice(0,16)}.js`;
await fs.writeFile(path.join(extension,moduleName),bytes);await fs.writeFile(path.join(out,'replay-bundle.js'),bytes);
const browser=await chromium.connectOverCDP(endpoint,{noDefaults:true});
const results=[];
try {
 const context=browser.contexts()[0];observeEvaluationDialogs(context);
 const extensionId=process.env.NUBI_REPLAY_EXTENSION_ID;
 if(!/^[a-p]{32}$/.test(extensionId||''))throw Error('extension_identity_required');
 const page=await context.newPage();await page.goto(`chrome-extension://${extensionId}/index.html`);
 if(await page.evaluate(()=>chrome.runtime.getManifest().version_name)!==manifest.version_name)throw Error('candidate_identity_mismatch');
 const state=(await page.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STATE'}))).data;
 if(state.busy || !state.auth?.present || state.auth.provider!=='chatgpt')throw Error('idle_authorized_evaluation_required');
 await fs.writeFile(path.join(out,'live.jsonl'),'');
 for(let repeat=1;repeat<=2;repeat++) for(const test of selected) for(const variant of repeat%2?['before','after']:['after','before']) {
  const prepared=goalReviewMessages(test.input);
  const messages=structuredClone(prepared.messages);
  if(!messages[0].content.includes(GOAL_REVIEW_PROMPT))throw Error('prompt_replacement_missing');
  messages[0].content=messages[0].content.replace(GOAL_REVIEW_PROMPT,variant==='before'?before:after);
  const raw=await page.evaluate(async({moduleName,messages})=>(await import(chrome.runtime.getURL(moduleName))).run(messages),{moduleName,messages});
  let verdict,error;try{verdict=parseGoalReview(raw,prepared.evidence);}catch(e){error=e.reviewReason||e.message;}
  const pass=!error&&(test.expected==='complete'?verdict.status==='complete':verdict.status!=='complete');
  const row={id:test.id,variant,repeat,expected:test.expected,actual:verdict?.status,pass,verdict,error,...raw};results.push(row);
  await fs.appendFile(path.join(out,'live.jsonl'),JSON.stringify(row)+'\n');
  console.log(JSON.stringify({id:test.id,variant,repeat,actual:row.actual,pass,error}));
 }
}finally{
 await fs.writeFile(path.join(out,'live.json'),JSON.stringify({at:new Date().toISOString(),model:'gpt-5.6-luna',kind:'controlled_reduced_review_comparison',actualModel:true,fullBrowserTask:false,bundleSha256:hash(bytes),beforePromptSha256:hash(before),afterPromptSha256:hash(after),results},null,2));
 await browser.close();
}
