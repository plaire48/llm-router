import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-click-feedback-')), extension = resolve(profile, 'extension');
const fixture = `<!doctype html><meta charset="utf-8"><title>신청 관리</title><style>body{font:16px sans-serif;padding:32px}button{margin:10px;padding:12px}output{display:block}</style>
<button id="open" onclick="document.querySelector('output').textContent='신청 양식을 열었습니다'">등록 화면 열기</button>
<button id="toggle" aria-pressed="false" onclick="this.setAttribute('aria-pressed',this.getAttribute('aria-pressed')==='true'?'false':'true')">알림 설정</button>
<a id="link" href="/details" onclick="event.preventDefault();document.querySelector('output').textContent='상세 내용'">상세 보기</a>
<button id="delayed" onclick="document.querySelector('output').textContent='창을 준비합니다';setTimeout(()=>window.open('/child','_blank'),1800)">다른 창 열기</button>
<button id="late" onclick="setTimeout(()=>window.open('/child','_blank'),1400)">지연 창</button>
<button id="submit">신청서 제출</button><button id="apply">신청하기</button><button id="delete">신청 내역 삭제</button><button id="send">보내기</button>
<output></output><script>window.clicks=[];document.addEventListener('click',e=>clicks.push({id:e.target.id,trusted:e.isTrusted}));</script>`;
const server = createServer((request,response) => {response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(request.url==='/child'?'<title>새 창</title><h1>새 창 준비 완료</h1><button>자식 동작</button>':fixture);});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`, baseline=process.env.CLICK_BASELINE==='1';
const checks=[],timings=[];let context,worker,page,tabId,requestId;
const check=text=>{checks.push(text);console.log('PASS '+text);};
const elements=result=>(result.observation||result).frames?.flatMap(frame=>frame.elements||[])||[];
const ref=(result,id)=>{const found=elements(result).find(el=>el.id===id);assert(found,JSON.stringify(result));return found.ref;};
const run=(name,args={})=>worker.evaluate(({tabId,requestId,name,args})=>clickTest.runBrowserAgent(requestId,{tabId},name,args,{onApproval:async record=>({requiresUserInput:true,record})}),{tabId,requestId,name,args});
async function reset(){await worker.evaluate(()=>clickTest.stopBrowserAgent());for(const child of context.pages())if(child!==page&&child.url()===url+'child')await child.close();await page.goto(url);requestId=crypto.randomUUID();return(await run('browser_snapshot')).result;}
try{
  await cp('dist',extension,{recursive:true});
  const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));manifest.host_permissions.push('http://127.0.0.1/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  await appendFile(resolve(extension,'background.js'),'\nglobalThis.clickTest={runBrowserAgent,stopBrowserAgent};\n');
  context=await chromium.launchPersistentContext(profile,{headless:process.env.HEADED!=='1',executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');page=await context.newPage();await page.goto(url);
  tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,url);
  for(const id of ['toggle','link','open']){
    const snapshot=await reset(),started=Date.now();
    const result=(await run('click_element',{ref:ref(snapshot,id)})).result;
    timings.push({action:id,durationMs:Date.now()-started,approval:!!result.requiresUserInput,error:result.error});
    if(!baseline){assert(!result.error&&!result.requiresUserInput,JSON.stringify(result));assert(timings.at(-1).durationMs<3500,JSON.stringify(timings));assert.deepEqual(await page.evaluate(()=>clicks),[{id,trusted:true}]);check(`${id} returns actual changed state promptly after one trusted click`);}
  }
  if(!baseline){
    for(const [id,action,label] of [['submit','제출','신청서 제출'],['apply','신청','신청하기'],['delete','삭제','신청 내역 삭제'],['send','발송','보내기']]){
      const snapshot=await reset(),result=(await run('click_element',{ref:ref(snapshot,id)})).result;
      assert.equal(result.requiresUserInput,true,JSON.stringify(result));assert.equal(result.record.action,action);assert.equal(result.record.label,label);assert.equal(result.record.hasEditableDraft,false);assert.deepEqual(await page.evaluate(()=>clicks),[]);check(`${label} pauses before input with its own action and no fictitious draft`);
    }
    let snapshot=await reset();
    let result=await run('click_element',{ref:ref(snapshot,'late')});
    assert.notEqual(result.tabId,tabId);assert.equal((result.result.observation||result.result).title,'새 창',JSON.stringify(result));check('an unknown delayed popup without a local effect is still followed in the same call');
    snapshot=await reset();const started=Date.now();
    result=await run('click_element',{ref:ref(snapshot,'delayed')});
    assert(Date.now()-started<1600,'local progress should release the click without waiting for the delayed child');assert.equal(result.tabId,tabId);
    const child=await context.waitForEvent('page');await child.waitForURL(url+'child');
    const staleRef=ref(result.result,'toggle');
    result=await run('run_playwright',{code:`await browser.ref(${JSON.stringify(staleRef)}).click();`});
    assert.notEqual(result.tabId,tabId);assert.equal(result.result.actionIssued,false);assert.equal(result.result.popupChanged,true);assert.equal(result.result.observation.title,'새 창');
    assert.deepEqual(await page.evaluate(()=>clicks),[{id:'delayed',trusted:true}]);check('a late popup is retained and returns new evidence before the next old-page action can execute');
    const childId=result.tabId;
    result=await run('browser_snapshot');assert.equal(result.tabId,childId);assert.equal(result.result.title,'새 창');check('following a deferred popup does not repeatedly switch or replay the opener click');
    await reset();await page.evaluate(()=>{const form=document.createElement('form');form.innerHTML='<input id="submit-key" aria-label="등록 화면 열기">';form.onsubmit=event=>{event.preventDefault();window.clicks.push({id:'unexpected-submit'});};document.body.append(form);});
    snapshot=(await run('browser_snapshot')).result;
    result=await run('press_key',{ref:ref(snapshot,'submit-key'),key:'ControlOrMeta+Enter'});
    assert.equal(result.result.requiresUserInput,true);assert.equal(result.result.record.action,'제출');assert.deepEqual(await page.evaluate(()=>clicks),[]);
    check('a navigational field label cannot bypass approval for a keyboard submit');
  }
  await writeFile(`verification/click-feedback-${baseline?'before':'browser'}.json`,JSON.stringify({checks,timings,actualBrowser:true,actualModel:false},null,2));console.log(JSON.stringify(timings));
}finally{await context?.close();server.close();await rm(profile,{recursive:true,force:true});}
