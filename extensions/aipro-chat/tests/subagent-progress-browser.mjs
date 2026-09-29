import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-subagent-ui-')),checks=[],errors=[];
let context;
const step=(n,status,outcome,delivered=false)=>({id:`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,tool:n%2?'analysis_page':'analysis_review',status,
  analysis:{task:`담당 ${n}: 신청 조건 확인`,phase:status==='queued'?'queued':status==='running'?'reading':'finished',calls:2,reads:1,delivered,
    ...(outcome?{outcome,summary:'**조건**을 확인했습니다.\n\n- 마감일 근거 확인\n\n<img src="https://invalid.example/image">'}:{})}});
try {
  await mkdir('verification',{recursive:true});
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${resolve('dist')}`,`--load-extension=${resolve('dist')}`]});
  await context.route('https://aipro.sdsdev.co.kr/**',route=>route.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K'}]}}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  // This suite checks detailed execution UI; ordinary mode is covered by debug-plan-ui-browser.
  await worker.evaluate(() => chrome.storage.local.set({debugMode: true}));
  await worker.evaluate(()=>chrome.storage.session.set({credential:{provider:'aipro',token:'synthetic',receivedAt:1}}));
  const ui=await context.newPage();ui.on('pageerror',e=>errors.push(e.message));await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await ui.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  async function render(trace,verified=false) {
    await worker.evaluate(async({trace,verified})=>{
      const {chat}=await chrome.storage.local.get('chat');
      await chrome.storage.local.set({chat:{...chat,task:null,messages:[{id:'subagent-preview',role:'assistant',state:'done',content:'담당별 확인 결과',trace,
        progress:{status:verified?'done':'paused',review:verified?'complete':'partial',plan:[{text:'결과 취합',status:verified?'completed':'in_progress'}]}}]}});
    },{trace,verified});
    await ui.reload();await ui.locator('.agent-trace > summary').click();await ui.locator('.subagent-group > summary').click();
  }
  for(const width of [320,360,1100]) {
    await ui.setViewportSize({width,height:850});
    await render([step(1,'done','complete',true),step(2,'running'),step(3,'running'),step(4,'queued')]);
    assert.match(await ui.locator('.subagent-group > summary').innerText(),/1\/4 완료/);
    assert.equal(await ui.locator('.subagent-group [data-status="running"]').count(),2);
    assert.equal(await ui.locator('.subagent-group [data-status="queued"]').count(),1);
    assert.notEqual(await ui.locator('.agent-trace > summary').innerText(),'메인 에이전트 완료');
    assert.equal(await ui.locator('.subagent-group img, .subagent-group script').count(),0);
    const styles=await ui.locator('.subagent-group :is(summary,.subagent-task,.agent-tool-state,p)').evaluateAll(elements=>elements.map(el=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontSize,s.lineHeight];}));
    assert(styles.every(([font,size,line])=>font.includes('Noto Sans KR')&&size==='14px'&&line==='22px'),JSON.stringify(styles));
    assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await ui.locator('.subagent-group').scrollIntoViewIfNeeded();await ui.screenshot({path:`verification/subagents-${width}.png`});
    const summary=ui.locator('.subagent-group > summary');await summary.focus();await ui.keyboard.press('Enter');assert.equal(await ui.locator('.subagent-group').evaluate(el=>el.open),false);
    await ui.keyboard.press('Enter');assert.equal(await ui.locator('.subagent-group').evaluate(el=>el.open),true);
    checks.push(`${width}px queued/running/delivered states, keyboard disclosure and shared typography`);
    const wiki=(n,role,status,extra={})=>({...step(n,status),tool:'analysis_research',analysis:{...step(n,status).analysis,role,...extra}});
    await render([
      wiki(1,'planner','done'),
      wiki(2,'research','done',{workerId:0,delivered:true,deliveredTo:'synthesis',assignment:{question:'신청 예외 확인',documentIds:['doc'],documents:[{id:'doc',title:'신청 규정'}],range:{documentId:'doc',start:0,end:24000}}}),
      wiki(3,'recovery','running',{workerId:4,assignment:{question:'미열람 구간 확인',documentIds:['doc'],documents:[{id:'doc',title:'신청 규정'}],range:{documentId:'doc',start:18000,end:24000}}}),
      wiki(4,'synthesis','done',{synthesisId:1,phase:'synthesis_finished',outcome:'partial',uncertainties:['화면 두 장의 차이 미확인'],uncertaintiesOmitted:1,nextStep:'원본 이미지 두 장을 다시 비교하세요.'}),
      wiki(5,'coordinator','running',{completed:4,total:5}),
      {...step(6,'running'),analysis:{...step(6,'running').analysis,doneWhen:'원본 화면과 입력 결과 비교',sourceCount:2,sources:[{id:'image1',tool:'capture_page',hasImage:true,imageRead:true,read:true},{id:'image2',tool:'capture_page',hasImage:true,imageRead:false,read:true}]}}
    ]);
    const progress=ui.locator('.subagent-group');
    for(const expected of ['작업 분할','문서 조사 1','누락 보완 5','결과 통합 2','하위 작업 4/5 처리','문자 18,000–24,000','결과 통합에 전달'])assert((await progress.innerText()).includes(expected),expected);
    assert.equal(await progress.getByText('메인 에이전트에 전달',{exact:true}).count(),0);
    for(const details of await progress.locator('.subagent-evidence').all())await details.locator('summary').click();
    assert((await progress.innerText()).includes('완료 조건'));assert((await progress.innerText()).includes('이미지 읽음 1개'));
    for(const text of ['화면 두 장의 차이 미확인','미확인 1개 더 있음','다음 행동','원본 이미지 두 장을 다시 비교하세요.'])assert((await progress.innerText()).includes(text),text);
    assert(!/^0$/m.test(await progress.innerText()), 'Empty details must not render a numeric zero');
    assert((await progress.innerText()).includes('텍스트 읽음'));assert((await progress.innerText()).includes('신청 규정'));
    assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await ui.screenshot({path:`verification/subagents-workers-${width}.png`});
    checks.push(`${width}px Wiki partition, repair, synthesis and actual source/image read details`);
    const prefix='동일 조건 '.repeat(45);
    await render([wiki(7,'synthesis','done',{outcome:'partial',uncertainties:[prefix+'외부 문서 예외 미확인',prefix+'내장 문서 예외 미확인']})]);
    await ui.locator('.subagent-evidence > summary').click();
    const notes=await ui.locator('.subagent-evidence').innerText();
    assert(notes.includes('외부 문서 예외 미확인')&&notes.includes('내장 문서 예외 미확인'));
    assert(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    checks.push(`${width}px distinct long uncertainty suffixes remain visible without overflow`);

  }
  await render([step(1,'done','partial',true),step(2,'error'),step(3,'cancelled')]);
  assert.match(await ui.locator('.subagent-group').innerText(),/일부 확인/);
  assert.match(await ui.locator('.subagent-group > summary').innerText(),/0\/3 완료/);
  assert.notEqual(await ui.locator('.agent-trace > summary').innerText(),'메인 에이전트 완료');
  await render([step(1,'done','complete',true),step(2,'done','complete',true)],true);
  assert.equal(await ui.locator('.agent-trace > summary').innerText(),'메인 에이전트 완료');
  await ui.reload();assert.equal(await ui.locator('.agent-trace').evaluate(el=>el.open),false);
  await ui.locator('.agent-trace > summary').click();assert.equal(await ui.locator('.subagent-group').evaluate(el=>el.open),false);
  await ui.locator('.subagent-group > summary').click();assert.equal(await ui.locator('.subagent-handoff').count(),2);
  await ui.emulateMedia({reducedMotion:'reduce'});
  assert(await ui.locator('.subagent-group > summary > svg').last().evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration)<=0.001));
  checks.push('partial/failure/cancellation never count as success; verified main completion collapses and persists through reload');
  assert.deepEqual(errors,[]);await writeFile('verification/subagent-progress-browser.json',JSON.stringify({checks,errors,actualBrowser:true,syntheticState:true,liveProvider:false},null,2));
  checks.forEach(check=>console.log('PASS '+check));
}finally{await context?.close();await rm(profile,{recursive:true,force:true});}
