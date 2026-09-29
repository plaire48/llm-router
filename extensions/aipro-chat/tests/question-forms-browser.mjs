import {completionIntentResponse} from './fixtures/completion-intent.mjs';
import {planCompletion} from './fixtures/task-plan.mjs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, mkdir, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-forms-')), extension = resolve(profile, 'extension');
const checks = [], errors = [], requests = [];
let context, page, mode = 'choice', failure;
const check = text => {checks.push(text); console.log(`PASS ${text}`);};
const rpc = (type, args = {}) => page.evaluate(async ({type,args}) => chrome.runtime.sendMessage({type,...args}), {type,args});
const state = async () => (await rpc('GET_STATE')).data;
async function poll(fn, expected) {let actual; for (let i=0; i<400; i++) {if(failure) throw failure; actual=await fn(); if(actual===expected) return; await new Promise(r=>setTimeout(r,40));} assert.equal(actual,expected);}
const answer = () => page.getByRole('textbox', {name:'직접 답변',exact:true});
const composer = () => page.getByRole('textbox', {name:'메시지',exact:true});
const questionCard = () => page.locator('.question-card[data-answered=false]');
const last = async () => (await state()).chat.messages.at(-1);
async function send(text) {
  const previous = (await last())?.id;
  await composer().fill(text); await page.getByRole('button',{name:'전송',exact:true}).click();
  await poll(async()=>{const message=await last(); return message?.id!==previous&&message?.state==='done';},true);
  const pending = (await last()).question;
  if (pending) await questionCard().getByText(pending.text,{exact:true}).waitFor();
}
const questions = {
  choice: {question:'어떤 형식으로 정리할까요?', choices:[{label:'간단한 요약',description:'핵심 내용을 짧게 정리해요.'},{label:'상세 보고서',description:'근거와 실행 방안을 함께 담아요.'}]},
  short: {question:'누구에게 보낼 내용인가요?',input_placeholder:'받는 팀 이름만 적어주세요.'},
  narrative: {question:'초안에 담을 내용과 원하는 분위기를 알려주세요.',input_mode:'long_text'},
};
try {
  await mkdir('verification',{recursive:true}); await cp(resolve('dist'),extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8')); manifest.host_permissions.push('http://*/*','https://*/*'); await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]}); context.setDefaultTimeout(10000);
  await context.route('https://aipro.sdsdev.co.kr/**',async route=>{try {
    if(route.request().method()==='GET') return route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',display_name:'Qwen 3.8',context_length:262144}]}});
    const body=route.request().postDataJSON(),review=goalReviewPayload(body.messages);
    const intent = completionIntentResponse(body); if (intent) return route.fulfill({json:intent});
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    if(review) return route.fulfill({json:reviewCompletion(review)});
    requests.push(body); let args=questions[mode];
    if (mode === 'repeat-short' && !body.messages.some(message => message.role === 'tool' && message.content.includes('question_already_answered'))) args = questions.short;
    if (mode === 'sequence') {
      // Host continuation reminders may follow the answer. Read the actual
      // user answer in the conversation rather than treating the last slot as it.
      const received = text => body.messages.some(message => message.role === 'user' && (message.content === text || message.content.startsWith(text+'\n<answered_question>')));
      args = received('신입 구성원') ? undefined : received('공지문') ?
        {question:'공지문은 누가 읽나요?',choices:[{label:'신입 구성원'},{label:'전체 구성원'}]} :
        {question:'어떤 문서로 정리할까요?',choices:[{label:'공지문'},{label:'안내서'}]};
    }
    const delta=args?{tool_calls:[{index:0,id:`question-${requests.length}`,type:'function',function:{name:'ask_user',arguments:JSON.stringify(args)}}]}:{content:'말씀하신 내용을 반영해 이어서 진행하겠습니다.'};
    return route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta,finish_reason:args?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`});
  } catch(error) {failure=error;return route.fulfill({status:500,body:'fixture failed'});}});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const token=`header.${Buffer.from(JSON.stringify({exp:Date.now()/1000+3600})).toString('base64url')}.signature`;
  await worker.evaluate(token=>chrome.storage.session.set({credential:{provider:'aipro',token,receivedAt:9}}),token);
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await poll(async()=>(await state()).catalog?.models?.length,1);
  await send('이 자료를 정리해줘');
  let question=(await last()).question;
  assert.equal(question.kind,'choice');assert.equal(requests.length,1);assert(await answer().isVisible());
  assert(await questionCard().getByText('선택하면 답변을 보냅니다.',{exact:true}).isVisible());
  assert.equal(await answer().getAttribute('placeholder'),'선택지에 없다면 직접 적어주세요.');
  assert.equal(await questionCard().getByRole('button',{name:'직접 답변 입력',exact:true}).count(),0);
  assert(await questionCard().getByRole('button',{name:'답변 보내기',exact:true}).isDisabled());
  for(const width of [320,360,1100]) {
    await page.setViewportSize({width,height:850}); await questionCard().scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const fonts=await questionCard().locator('.interaction-heading p,.question-option-copy strong,.question-option-copy>span,.interaction-input label').evaluateAll(els=>els.map(el=>({font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize})));
    assert(fonts.every(font=>font.font.includes('Noto Sans KR')&&font.size==='14px'));
    await page.screenshot({path:`verification/question-choice-${width}.png`});
  }
  await composer().fill('보관할 채팅 초안'); await poll(async()=>(await state()).chat.draft,'보관할 채팅 초안');
  mode='answer'; await questionCard().getByRole('button',{name:/상세 보고서/}).focus(); await page.keyboard.press('Enter');
  await poll(async()=>!((await last()).question),true);await poll(async()=>(await last()).state,'done');
  assert.equal((await state()).chat.messages.find(m=>m.question?.id===question.id).question.answer.optionId,'option-2');
  assert.equal((await state()).chat.draft,'보관할 채팅 초안');
  assert(requests.at(-1).messages.some(m=>m.role==='user'&&m.content.startsWith('상세 보고서\n<answered_question>')));
  check('text choices pause the actual agent loop, fit 320/360/1100px and resume by keyboard without consuming the composer draft');

  mode='short';await send('다음 초안을 준비해줘');question=(await last()).question;
  assert.equal(await answer().evaluate(el=>el.tagName),'TEXTAREA');
  assert.equal(await answer().getAttribute('placeholder'),null);
  assert(await questionCard().getByText('받는 팀 이름만 적어주세요.',{exact:true}).isVisible());
  await answer().fill('개발팀'); await poll(async()=>(await last()).question?.draft,'개발팀');
  assert(await answer().evaluate(el=>el.getAttribute('aria-describedby').split(' ').some(id=>document.getElementById(id)?.textContent==='받는 팀 이름만 적어주세요.')));
  assert.equal(await questionCard().getByText('Enter로 전송',{exact:true}).count(),0);
  await answer().dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});
  assert.equal((await last()).question.id,question.id);assert.equal((await last()).question.answer,undefined);
  const beforeWait = requests.length;
  await worker.evaluate(() => {const now = Date.now.bind(Date); Date.now = () => now() + 15 * 60 * 1000;});
  await page.reload();await answer().waitFor();assert.equal(await answer().inputValue(),'개발팀');
  assert.equal((await state()).chat.task.status,'awaiting_user');assert.equal(requests.length,beforeWait);

  await answer().focus();await answer().evaluate(el=>el.setSelectionRange(el.value.length,el.value.length));await answer().press('Enter');
  assert.equal(await answer().inputValue(),'개발팀\n');assert.equal((await last()).question.answer,undefined);
  await answer().fill('개발팀');
  mode='repeat-short';await answer().press('Control+Enter');await poll(async()=>(await last()).question?.id!==question.id,true);await poll(async()=>(await last()).state,'done');
  assert.equal((await state()).chat.messages.find(m=>m.question?.id===question.id).question.answer.text,'개발팀');
  assert.equal((await rpc('START_CHAT',{choice:{questionId:question.id,text:'오래된 답변'}})).error,'question_changed');
  assert.equal(requests.length,beforeWait+2);
  check('short answers remain editable after 15 simulated minutes and reload; Enter never sends, explicit submit resumes, repeated question returns the submitted answer without another form');

  mode='narrative';await send('요구사항을 자세히 확인해줘');question=(await last()).question;
  const session=(await state()).chat.sessionId, details='목표: 신규 구성원이 쉽게 시작할 수 있는 안내문\n\n친근한 말투로 작성하고 첫 주 일정과 준비물을 포함해주세요.\n<iframe src="https://untrusted.example"></iframe>';
  assert.equal(await answer().evaluate(el=>el.tagName),'TEXTAREA');await answer().fill(details);await poll(async()=>(await last()).question?.draft,details);
  assert.equal(await answer().getAttribute('rows'),'3');
  assert.equal(await answer().evaluate(el=>getComputedStyle(el).resize),'none');
  const longAnswer=('근거와 다음 실행 계획을 확인해 주세요.\n').repeat(16);
  await page.setViewportSize({width:320,height:850});
  await answer().fill(longAnswer);
  const more=questionCard().getByRole('button',{name:'더 보기',exact:true});
  await more.waitFor();
  const compactHeight=await answer().evaluate(el=>el.clientHeight);
  assert(compactHeight<=176);
  await answer().evaluate(el=>el.setSelectionRange(12,24));
  await questionCard().screenshot({path:'verification/question-auto-grow-compact-320.png'});
  await more.click();
  const expandedHeight=await answer().evaluate(el=>el.clientHeight);
  assert(expandedHeight>compactHeight+20);
  assert.equal(await answer().inputValue(),longAnswer);
  assert.deepEqual(await answer().evaluate(el=>[el.selectionStart,el.selectionEnd]),[12,24]);
  await questionCard().screenshot({path:'verification/question-auto-grow-expanded-320.png'});
  await questionCard().getByRole('button',{name:'접기',exact:true}).click();
  assert((await answer().evaluate(el=>el.clientHeight))<expandedHeight-20);
  assert(await answer().evaluate(el=>el===document.activeElement));
  await answer().fill(details);
  await answer().fill('짧은 답변');
  assert.equal(await questionCard().getByRole('button',{name:'더 보기',exact:true}).count(),0);
  assert((await answer().evaluate(el=>el.clientHeight))<compactHeight);
  await answer().fill(details);
  assert.equal(await questionCard().getByText('Enter 줄바꿈, Ctrl/⌘+Enter 전송',{exact:true}).count(),0);
  await answer().press('Enter');assert.equal((await last()).question.answer,undefined);assert.equal(await answer().inputValue(),details+'\n');
  assert.equal(await answer().getAttribute('rows'),'3');
  check('long answers auto-grow without a resize handle, reveal longer content on demand and preserve Enter semantics');
  await answer().fill(details);await composer().fill('다음 요청은 여기에 보관');
  await page.locator('.attachment-input').setInputFiles({name:'next.txt',mimeType:'text/plain',buffer:Buffer.from('다음 요청용 첨부')});
  await poll(async()=>(await state()).chat.draftAttachments?.length,1);
  const attachment=(await state()).chat.draftAttachments[0].id;
  await poll(async()=>(await state()).chat.draft,'다음 요청은 여기에 보관');
  await rpc('NEW_CHAT');await rpc('SELECT_CONVERSATION',{id:session});await page.reload();await answer().waitFor();
  assert.equal(await answer().inputValue(),details);assert.equal(await composer().inputValue(),'다음 요청은 여기에 보관');
  for(const args of [{conversationId:'wrong',provider:'aipro',questionId:question.id,value:'x'},{conversationId:session,provider:'fabrix',questionId:question.id,value:'x'},{conversationId:session,provider:'aipro',questionId:'old',value:'x'}]) assert.equal((await rpc('QUESTION_DRAFT',args)).ok,false);
  for(const width of [320,360,1100]) {
    await page.setViewportSize({width,height:850});await questionCard().scrollIntoViewIfNeeded();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await questionCard().locator('iframe').count(),0);
    await page.screenshot({path:`verification/question-narrative-${width}.png`});
  }
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await questionCard().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.evaluate(()=>{const original=chrome.runtime.sendMessage.bind(chrome.runtime);window.restoreRPC=()=>{chrome.runtime.sendMessage=original;};chrome.runtime.sendMessage=(message,...rest)=>message.type==='START_AGENT'?Promise.resolve({ok:false,error:'busy'}):original(message,...rest);});
  await questionCard().getByRole('button',{name:'답변 보내기',exact:true}).click();await questionCard().getByRole('alert').waitFor();assert.equal(await answer().inputValue(),details);
  await page.evaluate(()=>window.restoreRPC());mode='answer';await answer().press('Control+Enter');await poll(async()=>(await last()).question?.id!==question.id,true);await poll(async()=>(await last()).state,'done');
  const chat=(await state()).chat;assert.equal(chat.messages.find(m=>m.question?.id===question.id).question.answer.text,details);assert.equal(chat.messages.find(m=>m.question?.id===question.id).question.draft,undefined);
  assert.equal(chat.draft,'다음 요청은 여기에 보관');assert.equal(chat.draftAttachments[0].id,attachment);assert.equal(chat.messages.at(-2).attachments,undefined);
  assert(requests.at(-1).messages.some(m=>m.role==='user'&&m.content.startsWith(details+'\n<answered_question>')));
  check('narrative answers preserve newlines and failed-send input, survive conversation switching, reject cross-owner writes, and retain separate composer text/files');

  mode='choice';await send('다른 방식으로 정리해줘');question=(await last()).question;
  await answer().click();assert(await answer().evaluate(el=>el===document.activeElement));
  await answer().fill('abcdef');
  await answer().evaluate(el=>{el.setSelectionRange(2,4);const data=new DataTransfer();data.setData('text/plain','X\r\nY');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  assert.equal(await answer().inputValue(),'abX\nYef');
  assert.deepEqual(await answer().evaluate(el=>[el.selectionStart,el.selectionEnd]),[5,5]);
  await answer().evaluate(el=>{el.setSelectionRange(2,5);const data=new DataTransfer();data.setData('text/plain','X\rY');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  assert.equal(await answer().inputValue(),'abX\nYef');
  assert.deepEqual(await answer().evaluate(el=>[el.selectionStart,el.selectionEnd]),[5,5]);
  await answer().fill('');
  await answer().evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','첫 줄\n두 번째 줄');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  assert.equal(await answer().evaluate(el=>el.tagName),'TEXTAREA');assert.equal(await answer().inputValue(),'첫 줄\n두 번째 줄');
  await answer().evaluate(el=>{el.setSelectionRange(el.value.length,el.value.length);const data=new DataTransfer();data.setData('text/plain','가'.repeat(el.maxLength+1));el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});
  await questionCard().getByRole('alert').waitFor();assert.equal(await answer().inputValue(),'첫 줄\n두 번째 줄');
  assert(await answer().evaluate(el=>el.getAttribute('aria-describedby').split(' ').some(id=>document.getElementById(id)?.getAttribute('role')==='alert')));
  assert.equal(await questionCard().getByRole('alert').evaluate(el=>getComputedStyle(el).fontSize),'14px');
  mode='answer';await questionCard().getByRole('button',{name:'답변 보내기',exact:true}).click();await poll(async()=>(await last()).question?.id!==question.id,true);await poll(async()=>(await last()).state,'done');
  assert.equal((await state()).chat.messages.find(m=>m.question?.id===question.id).question.answer.text,'첫 줄\n두 번째 줄');
  check('every choice form accepts a custom answer; multiline paste is exact and oversized paste preserves the draft with a linked readable error');

  mode='sequence';await send('안내서나 공지문으로 자료를 정리해줘. 독자는 신입 구성원 또는 전체 구성원인데 정하지 못했어. 하나씩 물어봐.');
  const first = (await last()).question, before = requests.length;
  await send('공지문');
  await poll(async()=>(await last()).question?.text,'공지문은 누가 읽나요?');
  await poll(async()=>(await last()).state,'done');
  const second = (await last()).question;
  assert.notEqual(second.id,first.id);
  assert.equal(requests.length,before+1);
  await questionCard().getByText(second.text,{exact:true}).waitFor();
  assert.equal(await questionCard().count(),1);
  await page.reload();await questionCard().waitFor();
  assert.equal((await last()).question.id,second.id);
  assert.equal((await rpc('START_CHAT',{choice:{questionId:first.id,optionId:'option-2'}})).error,'question_changed');
  await questionCard().getByRole('button',{name:/신입 구성원/}).click();
  await poll(async()=>(await last()).question?.id!==second.id,true);await poll(async()=>(await last()).state,'done');
  const wire = requests.at(-1).messages;
  for (const text of ['공지문','신입 구성원']) assert(wire.some(message=>message.role==='user'&&message.content.startsWith(text+'\n<answered_question>')));
  assert(wire.some(message=>message.role==='user'&&message.content.includes('안내서나 공지문으로 자료를 정리해줘')));
  assert.equal((await state()).chat.messages.filter(message=>[first.id,second.id].includes(message.question?.id)&&message.question.answer).length,2);
  check('dependent questions advance one item at a time, retain both answers and original goal, and reject the earlier form after reload');
  assert.deepEqual(errors,[]);await writeFile('verification/question-forms-browser.json',JSON.stringify({checks,errors,actualBrowser:true,syntheticModel:true,liveProvider:false},null,2));
} catch(error) {console.error('PAGE ERRORS',errors);console.error('PAGE TEXT',await page?.locator('body').innerText().catch(()=>''));throw error;}
finally {await context?.close();await rm(profile,{recursive:true,force:true});}
