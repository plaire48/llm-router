import {wikiAgentCompletion} from './fixtures/openwiki-model.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {unzipSync,strFromU8} from 'fflate';
import {planCompletion,fixturePlan} from './fixtures/task-plan.mjs';
import {goalReviewPayload} from './fixtures/goal-review.mjs';
import {assertModalTypography} from './helpers/modal-typography.mjs';
import {WIKI_CREATOR_PROMPT} from '../browser-knowledge.js';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-browser-wiki-')),extension=resolve(profile,'extension');
// Long numeric canary avoids accidental matches in UUIDs, hashes, timestamps or ports.
const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><html lang="ko"><title>업무 포털</title><h1>업무 포털</h1><a href="/work">업무 기록</a><label>투입 시간<input type="number" required value="739184620573918"></label><button onclick="window.submits++">등록</button><script>window.submits=0</script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/portal`;
let context,ui,worker,failure,round=0,creations=0,reused=false, driftPhase=false,driftNotices=0,wikiPhase=0;
const errors=[],checks=[];
const wikiBody = '# 업무 포털\n투입 시간은 사용자가 확인합니다. 단위는 아직 확인하지 않았습니다.\n\n식별자는 `work_item`입니다.\n\n```javascript\nconst workItem = {status: "review"};\nconsole.log(workItem.status);\n```';
async function assertWikiState(expected) {
 const status=ui.locator('.attachment-state').filter({hasText:expected});await status.waitFor();
 const style=await status.evaluate(el=>{const s=getComputedStyle(el);return {text:el.textContent,font:s.fontFamily,size:s.fontSize,line:s.lineHeight};});
 assert.equal(style.text,expected);assert(style.font.includes('Noto Sans KR'));assert.equal(style.size,'14px');assert.equal(style.line,'22px');
}

const reply=(name,args={},content='')=>({choices:[{message:{content,...(name?{tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]}:{})},finish_reason:name?'tool_calls':'stop'}]});
const state=()=>ui.evaluate(async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data);
const memory=()=>worker.evaluate(async()=>(await chrome.storage.local.get('browserKnowledge')).browserKnowledge);
async function until(fn){for(let i=0;i<800;i++){if(failure)throw failure;if(await fn())return;await new Promise(r=>setTimeout(r,40));}console.error(JSON.stringify(await state()));assert.fail('wiki flow timed out');}
try {
 await mkdir('verification',{recursive:true});await cp(resolve('dist'),extension,{recursive:true});
 const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://*/*','https://*/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY || chromium.executablePath(),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try{
   if(route.request().url().endsWith('/api/models'))return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144,max_input_tokens:221184}]}});
   const body=route.request().postDataJSON();
      const wikiReply=wikiAgentCompletion(body); if(wikiReply)return route.fulfill({json:wikiReply});
   if(body.messages[0]?.content.startsWith(WIKI_CREATOR_PROMPT)){
     creations++;const packet=JSON.parse(body.messages.find(m=>m.role==='user').content);
     assert.equal(packet.conversationContext.scope,'current_conversation');
     assert(packet.conversationContext.conversationId);
     assert(packet.conversationContext.statements.length);
     assert.equal(packet.candidate.url,url);assert(!JSON.stringify(packet.candidate).includes('739184620573918'),JSON.stringify(packet.candidate));
     assert(body.tools.every(t=>['ask_user','find_skills','read_skill'].includes(t.function.name)));
     if(!packet.answers?.length)return route.fulfill({json:reply('ask_user',{question:'문서의 범위를 골라주세요.',choices:[{label:'화면 사용법',description:'관찰한 메뉴와 입력 항목을 정리합니다.'},{label:'업무 절차',description:'확인한 업무 기준까지 정리합니다.'}]})});
     assert.equal(packet.answers[0].answer,'화면 사용법');
     return route.fulfill({json:reply(null,{},JSON.stringify({title:'업무 포털 안내',markdown:'# 업무 포털\n\n업무 기록 메뉴에서 투입 시간을 입력합니다. 단위는 아직 확인하지 않았습니다.\n\n등록은 현재 사용자의 승인을 받습니다.'}))});
   }
   const plan=planCompletion(body);if(plan)return route.fulfill({json:plan});
   const review=goalReviewPayload(body.messages);if(review){const proof=review.evidence.findLast(e=>e.tool==='verify_page'&&e.usable&&e.result.verified);assert(proof);assert(!review.evidence.some(e=>JSON.stringify(e.result).includes('historical_navigation')));return route.fulfill({json:reply(null,{},JSON.stringify({status:'complete',checks:[{requirement:'화면 확인',status:'met',evidence_ids:[proof.id]}],next_step:''}))});}
   const last=body.messages.findLast(m=>m.role==='tool'),result=last&&JSON.parse(last.content);
   if(reused && !driftPhase && wikiPhase<2){
     if(!body.tools.some(t=>t.function.name==='ask_openwiki')) {
       const selector=body.tools.find(t=>t.function.name==='select_tools');
       assert(selector?.function.parameters.properties.groups.items.enum.includes('knowledge'));
       return route.fulfill({json:reply('select_tools',{groups:['knowledge']})});
     }
     if(wikiPhase++===0)return route.fulfill({json:reply('ask_openwiki',{wiki:'internal',question:'투입 시간의 단위를 확인해줘'})});
     assert.equal(result.engine,'openwiki-deepagents'); assert(result.evidence.some(e=>e.excerpt.includes('단위는 아직')));
   }
   if(++round%4===1)return route.fulfill({json:reply('read_page')});
   if(round%4===2){assert(result.frames || result.observation);if(driftPhase){if(result.browserKnowledge?.invalidated?.includes(url))driftNotices++;assert.equal(result.browserKnowledge?.entries?.length || 0,0);}else if(reused){assert(result.browserKnowledge?.entries[0].markdown.includes('단위는 아직'));}return route.fulfill({json:reply('verify_page',{checks:[{kind:'text_present',expected:driftPhase ? '새 화면' : '업무 포털'}]})});}
   if(round%4===3){assert(result.verified);if(body.tools.some(t=>t.function.name==='update_plan'))return route.fulfill({json:reply('update_plan',{steps:fixturePlan.map(step=>({...step,status:'completed'}))})});round++;return route.fulfill({json:reply(null,{},'업무 포털의 메뉴와 입력 항목을 확인했습니다.')});}
   assert(result.ok && result.plan?.every(step=>step.status==='completed'),JSON.stringify({round,result}));return route.fulfill({json:reply(null,{},'업무 포털의 메뉴와 입력 항목을 확인했습니다.')});
 }catch(e){failure=e;await route.fulfill({status:500,body:'fixture failed'}).catch(()=>{});}});
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',token:'synthetic-wiki',receivedAt:1}}));
 const source=await context.newPage();await source.goto(url);ui=await context.newPage();await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
 const tab=await ui.evaluate(async()=>(await chrome.tabs.getCurrent()).id);
 await worker.evaluate(async({tab,url})=>{const page=(await chrome.tabs.query({})).find(t=>t.url===url);await chrome.storage.session.set({chatSourceTabs:{[tab]:page.id}});},{tab,url});
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('/wiki');
 await ui.getByRole('button',{name:'전송',exact:true}).click();
 await until(async()=>!(await state()).busy&&(await state()).chat.messages.at(-1)?.question?.kind==='choice');
 assert(!((await memory())?.entries?.length));checks.push('slash command observes page and asks grounded clarification without saving');
 await ui.reload();await ui.getByRole('textbox',{name:'직접 답변',exact:true}).waitFor();assert.deepEqual(errors,[]);await ui.getByRole('button',{name:'화면 사용법',exact:false}).click();
 await until(async()=>!(await state()).busy&&!!(await state()).chat.messages.at(-1)?.wikiDraft);
 assert.equal(creations,2);assert(!((await memory())?.entries?.length));
 for(const width of [320,360,1100]){await ui.setViewportSize({width,height:850});await assertWikiState('검토할 초안');}
 await ui.getByRole('button',{name:'사이트 위키 검토',exact:true}).click();
 await ui.keyboard.press('Escape');
 // A host-side draft refresh is synthetic; reopening must observe its latest text.
 await worker.evaluate(async()=>{
  const {chat}=await chrome.storage.local.get('chat');
  chat.messages.at(-1).wikiDraft={...chat.messages.at(-1).wikiDraft,title:'최신 업무 포털 안내',markdown:'# 새 초안\n최신 저장본의 화면 안내입니다.'};
  await chrome.storage.local.set({chat});
 });
 await ui.locator('.attachment-name').filter({hasText:'최신 업무 포털 안내'}).waitFor();
 await ui.getByRole('button',{name:'사이트 위키 검토',exact:true}).click();
 assert.equal(await ui.getByRole('textbox',{name:'문서 이름',exact:true}).inputValue(),'최신 업무 포털 안내');
 assert.equal(await ui.getByRole('textbox',{name:'내용',exact:true}).inputValue(),'# 새 초안\n최신 저장본의 화면 안내입니다.');
 checks.push('an untouched Wiki editor reopens the latest host draft instead of retaining an old original');
 await ui.getByRole('textbox',{name:'내용',exact:true}).fill(wikiBody);
 await ui.keyboard.press('Escape');
 await ui.getByRole('button',{name:'사이트 위키 검토',exact:true}).click();
 assert.equal(await ui.getByRole('textbox',{name:'내용',exact:true}).inputValue(),wikiBody);
 checks.push('closing and reopening the same Wiki retains its unsaved draft without storage writes');
 for(const width of [320,390,1100]){await ui.setViewportSize({width,height:850});await assertModalTypography(ui.getByRole('dialog',{name:'사이트 위키',exact:true}));const save=ui.getByRole('button',{name:'위키 저장',exact:true});assert.equal(await save.getAttribute('data-icon-only'),'true');assert((await save.boundingBox()).y<850);await ui.screenshot({path:`verification/browser-wiki-review-${width}.png`});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await ui.evaluate(()=>{
  const original=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage=(message,...rest)=>message.type==='SAVE_BROWSER_WIKI'?new Promise(resolve=>{
   window.releaseWikiSave=()=>{chrome.runtime.sendMessage=original;resolve({ok:false,error:'storage_failed'});};
  }):original(message,...rest);
 });
 await ui.getByRole('button',{name:'위키 저장',exact:true}).click();
 await ui.waitForFunction(()=>typeof window.releaseWikiSave==='function');
 const pendingWikiDialog=ui.getByRole('dialog',{name:'사이트 위키',exact:true});
 assert(await pendingWikiDialog.locator('input,textarea').evaluateAll(fields=>fields.length===2&&fields.every(field=>field.disabled)));
 await ui.keyboard.press('Escape');assert(await pendingWikiDialog.isVisible());
 assert(!((await memory())?.entries?.length));
 await ui.evaluate(()=>window.releaseWikiSave());
 await pendingWikiDialog.getByText('처리하지 못했습니다. 다시 시도해 주세요.',{exact:true}).waitFor();
 assert.equal(await ui.getByRole('textbox',{name:'내용',exact:true}).inputValue(),wikiBody);
 assert(await ui.getByRole('textbox',{name:'내용',exact:true}).isEnabled());
 await ui.keyboard.press('Escape');
 await ui.getByRole('button',{name:'사이트 위키 검토',exact:true}).click();
 assert.equal(await ui.getByRole('textbox',{name:'내용',exact:true}).inputValue(),wikiBody);
 checks.push('pending Wiki save locks every input and closing; failed save keeps edits for explicit retry');
 await ui.getByRole('button',{name:'위키 저장',exact:true}).click();
 await until(async()=>!!(await memory())?.entries?.[0]?.markdown.includes('사용자가 확인'));
 await ui.locator('.cx-toast').waitFor();assert((await ui.locator('.cx-toast').boundingBox()).y<100);
 await ui.reload();assert.equal((await memory()).entries.length,1);
 for(const width of [320,360,1100]){await ui.setViewportSize({width,height:850});await assertWikiState('저장됨');}
 checks.push('draft and saved Wiki states retain body 14/22px at 320/360/1100px after reload; reviewed edits persist and toast is at top');
 const downloading=ui.waitForEvent('download');await ui.getByRole('button',{name:'사이트 위키 ZIP 다운로드',exact:true}).click();const download=await downloading;
 const files=unzipSync(new Uint8Array(await readFile(await download.path())));assert(strFromU8(files['site.md']).includes('사용자가 확인'));assert(strFromU8(files['site.md']).includes(url));checks.push('ZIP contains grounded Markdown for OpenWiki');
 // A fresh conversation retrieves the reviewed document. Its evidence is not a completion proof.
 await ui.evaluate(()=>chrome.runtime.sendMessage({type:'NEW_CHAT'}));await ui.reload();reused=true;
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('업무 포털 투입 시간 화면을 확인해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();
 await until(async()=>!(await state()).busy&&!!(await state()).chat.messages.at(-1)?.wikiOffer);
 assert.equal((await memory()).entries[0].confirmations,1);assert.equal(wikiPhase,2);checks.push('agent explicitly searches and reads wiki before observing, without silently overwriting it');
 await ui.getByRole('button',{name:'이번에는 건너뛰기',exact:true}).click();await until(async()=>(await state()).chat.messages.at(-1).wikiOffer.status==='dismissed');await ui.reload();assert.equal(await ui.getByRole('button',{name:'이번에는 건너뛰기',exact:true}).count(),0);
 driftPhase=true;for(const page of context.pages().filter(p=>p.url()===url))await page.locator('h1').evaluate(el=>el.textContent='새 화면');
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('현재 화면에서 투입 시간을 확인해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();
 await until(async()=>!(await state()).busy && !!(await memory()).entries[0].invalidated);assert.equal(driftNotices,1);checks.push('observed structure drift explicitly revokes previously delivered guidance while preserving its source');
 for(const width of [390,1100]){await ui.setViewportSize({width,height:850});await ui.screenshot({path:`verification/browser-wiki-${width}.png`});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 for(const page of context.pages().filter(p=>p.url()===url))assert.equal(await page.evaluate(()=>window.submits),0);
 await ui.getByRole('button',{name:'설정',exact:true}).click();await ui.locator('.browser-knowledge-settings > summary').click();await ui.locator('.browser-knowledge-list > li > div > details > summary').click();await ui.locator('.browser-knowledge-list .message-body').getByText('투입 시간은 사용자가 확인합니다. 단위는 아직 확인하지 않았습니다.',{exact:true}).waitFor();await ui.locator('.browser-knowledge-list').getByText('출처',{exact:true}).click();for(const width of [320,360,1100]){await ui.setViewportSize({width,height:850});const typography=await assertModalTypography(ui.getByRole('dialog',{name:'설정',exact:true}));for(const kind of ['inlineCode','sourceCode','codeMetadata'])assert(typography.some(item=>item.kind===kind),`expanded Wiki includes ${kind}`);const row=await ui.locator('.browser-knowledge-list > li').boundingBox(),body=await ui.locator('.browser-knowledge-list .message-body').boundingBox();assert(body.width>=row.width-70,JSON.stringify({row,body}));await ui.screenshot({path:`verification/browser-wiki-settings-${width}.png`,animations:'disabled'});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}const wikiDialog=ui.getByRole('dialog',{name:'설정',exact:true});
 for(const [selector,property,value] of [['.code-source','font-family','"Noto Sans KR"'],['.message-body p > code','font-size','13px'],['.code-toolbar > span:not(.copy-control)','font-family','monospace']]) {
  const node=wikiDialog.locator(selector).first(),previous=await node.getAttribute('style');
  await node.evaluate((el,{property,value})=>el.style.setProperty(property,value),{property,value});
  try {await assert.rejects(assertModalTypography(wikiDialog),/Modal text must use the shared type scale/);}
  finally {await node.evaluate((el,previous)=>previous===null?el.removeAttribute('style'):el.setAttribute('style',previous),previous);}
 }
 await assertModalTypography(wikiDialog);checks.push('expanded Wiki preserves inline/body-size monospace, 13px code and Noto toolbar; incorrect code fonts or sizes are rejected');
 await ui.keyboard.press('Escape');
 // Opt-in auto refresh is driven by a verified task, not model-generated knowledge.
 const original=(await memory()).entries[0];assert.equal((await memory()).autoUpdate,false);
 await ui.getByRole('button',{name:'설정',exact:true}).click();
 if(!await ui.getByRole('checkbox',{name:'저장된 위키 자동 갱신',exact:true}).isVisible())await ui.locator('.browser-knowledge-settings > summary').click();
 await ui.getByRole('checkbox',{name:'저장된 위키 자동 갱신',exact:true}).click();
 await until(async()=>(await memory()).autoUpdate===true && await ui.getByRole('checkbox',{name:'저장된 위키 자동 갱신',exact:true}).isChecked());await ui.keyboard.press('Escape');await ui.reload();
 const creationCount=creations;
 await ui.getByRole('textbox',{name:'메시지',exact:true}).fill('현재 화면에서 투입 시간을 다시 확인해줘');await ui.getByRole('button',{name:'전송',exact:true}).click();
 await until(async()=>!(await state()).busy && (await memory()).entries[0].documentVersion>original.documentVersion);
 const automatic=(await memory()).entries[0];assert.equal(automatic.markdown,original.markdown);assert.equal(automatic.markdownNeedsReview,true);assert.equal(automatic.invalidated,false);
 assert(automatic.document.headings.includes('새 화면'));assert(automatic.previousObservation);assert.equal(creations,creationCount);
 assert(!(await state()).chat.messages.at(-1).wikiOffer);assert(!JSON.stringify(automatic).includes('739184620573918'),JSON.stringify(automatic));
 await ui.reload();assert.equal((await memory()).entries[0].documentVersion,automatic.documentVersion);
 await ui.getByRole('button',{name:'설정',exact:true}).click();
 if(!await ui.getByRole('checkbox',{name:'저장된 위키 자동 갱신',exact:true}).isVisible())await ui.locator('.browser-knowledge-settings > summary').click();
 for(const width of [320,390,1100]){await ui.setViewportSize({width,height:850});await assertModalTypography(ui.getByRole('dialog',{name:'설정',exact:true}));await ui.screenshot({path:`verification/browser-wiki-auto-${width}.png`,animations:'disabled'});assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await ui.getByRole('button',{name:`${automatic.title} 자동 갱신 되돌리기`,exact:true}).click();
 await until(async()=>(await memory()).entries[0].documentVersion===automatic.documentVersion+1);
 assert.deepEqual((await memory()).entries[0].document,original.document);assert.equal((await memory()).entries[0].invalidated,true);
 await ui.getByRole('checkbox',{name:'저장된 위키 자동 갱신',exact:true}).click();await until(async()=>(await memory()).autoUpdate===false && !await ui.getByRole('checkbox',{name:'저장된 위키 자동 갱신',exact:true}).isChecked());await ui.keyboard.press('Escape');
 checks.push('opt-in auto refresh after verified completion, no model writer or approval, authored text preserved, reload and undo');
 assert.deepEqual(errors,[]);checks.push('skip persists, no page writes or submissions, narrow and wide layouts fit');
 console.log(JSON.stringify({status:'passed',checks,evidence:{actualChrome:true,syntheticPortal:true,mockedModel:true}},null,2));
} catch(error) {console.error('UI ERRORS',errors);console.error((await ui?.locator('body').innerText().catch(()=>''))?.slice(-4000));throw error;} finally {await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
