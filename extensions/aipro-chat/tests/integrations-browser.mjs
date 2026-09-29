import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {assertModalTypography} from './helpers/modal-typography.mjs';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-integrations-')),extension=resolve(profile,'extension');
let context,ui,server,worker;const checks=[],errors=[],calls=[];
const token=`header.${Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
const check=text=>{checks.push(text);console.log('PASS '+text);};
const rpc=(type,values={})=>ui.evaluate(message=>chrome.runtime.sendMessage(message),{type,clientId:'integration-fixture',...values});
async function ok(type,values){const response=await rpc(type,values);assert.equal(response.ok,true,JSON.stringify(response));return response.data;}
async function poll(fn){for(let n=0;n<250;n++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,40));}throw new Error('Fixture timed out');}
const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
function answer(message){return message.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:message.method==='tools/list'?{tools:[{name:'echo_note',description:'Return a test note',inputSchema:schema}]}:{content:[{type:'text',text:'Received: '+message.params.arguments.text}]};}
try {
  server=createServer(async(req,res)=>{
    if(req.url==='/secure/attachment/1/note.txt'){res.writeHead(200,{'content-type':'text/plain'});res.end('고객 인수 테스트 첨부');return;}
    if(req.url==='/browse/VOC-42'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="ko"><title>VOC 티켓</title><main><h1>저장 버튼 개선 요청</h1><p>고객이 저장 버튼을 쉽게 찾을 수 있어야 합니다.</p><p hidden>숨긴 댓글은 수집하지 않는다</p><label>임시 입력<input aria-label="제목"></label><a href="/secure/attachment/1/note.txt">테스트 문서</a></main></html>');return;}
    if(req.url!=='/mcp'){res.writeHead(404);res.end();return;}
    if(req.method==='GET'){res.writeHead(405);res.end();return;}
    let body='';for await(const part of req)body+=part;
    const message=JSON.parse(body);calls.push({message,authorization:req.headers.authorization,workspace:req.headers['x-workspace']});
    if(!('id'in message)){res.writeHead(202);res.end();return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:answer(message)}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  await cp(resolve('dist'),extension,{recursive:true});const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),key=publicKey.export({type:'spki',format:'der'});
  manifest.key=key.toString('base64');const id=createHash('sha256').update(key).digest('hex').slice(0,32).replace(/[0-9a-f]/g,n=>String.fromCharCode(97+parseInt(n,16)));
  manifest.host_permissions.push('https://mcp.example.test/*');await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
  context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.CHROME_BINARY,args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`]});context.setDefaultTimeout(15000);
  await context.route('https://aipro.sdsdev.co.kr/api/models',r=>r.fulfill({json:{modelList:[{name:'QWEN3.8-27B-FP8-256K',context_length:262144}]}}));
  await context.route('https://mcp.example.test/mcp',route=>{const req=route.request();if(req.method()==='GET')return route.fulfill({status:405});const message=req.postDataJSON();return route.fulfill(!('id'in message)?{status:202}:{json:{jsonrpc:'2.0',id:message.id,result:answer(message)}});});
  worker=context.serviceWorkers().find(w=>w.url()===`chrome-extension://${id}/background.js`)||await context.waitForEvent('serviceworker',{predicate:w=>w.url()===`chrome-extension://${id}/background.js`});
  await worker.evaluate(async token=>{await chrome.storage.local.set({browserWorkMode:'current'});await chrome.storage.session.set({credential:{provider:'aipro',mode:'browser',token,receivedAt:210}});},token);
  ui=await context.newPage();ui.on('pageerror',e=>errors.push(e.message));await ui.goto(`chrome-extension://${id}/index.html`);await ui.setViewportSize({width:360,height:850});
  await poll(async()=> (await ok('GET_STATE')).catalog?.models?.length);
  await ui.getByRole('button',{name:'설정',exact:true}).click();let dialog=ui.getByRole('dialog',{name:'설정',exact:true});
  await dialog.getByText('MCP 연결',{exact:true}).click();await dialog.getByRole('button',{name:'MCP 연결 추가',exact:true}).click();
  await dialog.getByRole('textbox',{name:'이름',exact:true}).fill('업무 도구');await dialog.getByRole('textbox',{name:'서버 주소',exact:true}).fill(base+'/mcp');
  await dialog.getByText('헤더',{exact:true}).click();await dialog.getByRole('button',{name:'헤더 추가',exact:true}).click();
  await dialog.getByRole('textbox',{name:'헤더 1 이름',exact:true}).fill('Authorization');await dialog.locator('input[type=password]').fill('Bearer synthetic-secret');
  await assertModalTypography(dialog);await dialog.getByRole('tab',{name:'누비 탭에서 작업',exact:true}).waitFor();await dialog.getByRole('tab',{name:'현재 탭에서 작업',exact:true}).waitFor();await ui.screenshot({path:'verification/integrations-settings-360.png'});
  await dialog.getByRole('button',{name:'연결 테스트 후 저장',exact:true}).click();await poll(async()=> (await ok('MCP_STATUS')).servers.length===1);
  assert(calls.length>0);assert(calls.every(c=>c.authorization==='Bearer synthetic-secret'));assert(!JSON.stringify(await ok('MCP_STATUS')).includes('synthetic-secret'));
  const https=await ok('MCP_CONNECT',{connection:{name:'HTTPS 도구',url:'https://mcp.example.test/mcp',headers:[]}});assert.equal(https.servers.length,2);
  check('Actual HTTP initialize/list with custom header and HTTPS transport; secrets omitted from status');
  // Real Chrome handles via OPFS verify serialization and writes. OS picker grant is separate.
  await ui.evaluate(async()=>{window.showDirectoryPicker=async()=>{const root=await navigator.storage.getDirectory();return root.getDirectoryHandle('VOC files',{create:true});};});
  await dialog.getByText('첨부파일 설정',{exact:true}).click();await dialog.getByRole('button',{name:'저장 폴더 선택',exact:true}).click();await poll(async()=> (await ok('WORKSPACE_STATUS'))?.status==='connected');
  for(const width of [360,1100]){await ui.setViewportSize({width,height:850});await assertModalTypography(dialog);assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2));}
  await ui.screenshot({path:'verification/integrations-settings-1100.png'});
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  let started=await ok('START_CHAT',{text:'업무 도구로 테스트 기록을 확인해줘'}),requestId=started.requestId;
  const connection=(await ok('MCP_STATUS')).servers.find(s=>s.name==='업무 도구');
  let result=await ok('RUN_TOOL',{requestId,name:'call_mcp_tool',args:{server_id:connection.id,tool:'echo_note',arguments:{text:'확인할 내용'}}});assert(result.requiresUserInput);
  assert.equal(calls.filter(c=>c.message.method==='tools/call').length,0);
  assert.equal((await rpc('RUN_TOOL',{requestId,name:'apply_approved_mcp',args:{}})).ok,false);
  assert.equal((await rpc('MCP_REMOVE',{id:connection.id})).error,'busy');
  await ok('FINISH_CHAT',{requestId,content:''});let state=await ok('GET_STATE'),question=state.chat.messages.at(-1).question;
  assert.equal(question.kind,'approval');assert.equal(question.hasEditableDraft,false);assert.equal(question.text,'이 도구를 실행할까요?');
  await ui.reload();await ui.getByRole('button',{name:'실행',exact:true}).waitFor();
  started=await ok('START_CHAT',{choice:{questionId:question.id,optionId:'approve'}});requestId=started.requestId;assert.equal(started.approvedToolName,'apply_approved_mcp');
  result=await ok('RUN_TOOL',{requestId,name:'apply_approved_mcp',args:{}});assert.equal(result.ok,true);assert.equal(result.content[0].text,'Received: 확인할 내용');
  assert.equal((await rpc('RUN_TOOL',{requestId,name:'apply_approved_mcp',args:{}})).error,'approval_changed');
  assert.equal(calls.filter(c=>c.message.method==='tools/call').length,1);await ok('FINISH_CHAT',{requestId,content:'확인했습니다.'});
  check('MCP execution waits for persisted approval, blocks replay, and does not require browser page access');
  const target=await context.newPage();await target.goto(base+'/browse/VOC-42');await target.bringToFront();
  // Connect explicitly to the observed fixture tab, no arbitrary page IDs.
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,base+'/browse/VOC-42');await ok('CONNECT_PAGE',{tabId});
  started=await ok('START_CHAT',{text:'이 티켓과 첨부 파일을 저장 폴더에 정리해줘'});requestId=started.requestId;
  result=await ok('RUN_TOOL',{requestId,name:'collect_voc',args:{}});const revision=result.id;assert.equal(result.coverage,'partial');
  const again=await ok('RUN_TOOL',{requestId,name:'collect_voc',args:{}});assert.equal(again.id,revision);assert.equal(again.unchanged,true);
  const read=await ok('RUN_TOOL',{requestId,name:'read_voc',args:{id:revision}});assert(read.body.includes('저장 버튼'));assert(!read.body.includes('숨긴 댓글'));assert.equal(read.attachments.length,1);
  const search=await ok('RUN_TOOL',{requestId,name:'search_voc',args:{query:'저장 버튼'}});assert.equal(search.results[0].id,revision);
  result=await ok('RUN_TOOL',{requestId,name:'download_voc_attachment',args:{id:revision,index:0}});assert.equal(result.ok,true);
  const exported=await ok('RUN_TOOL',{requestId,name:'export_voc',args:{id:revision}});assert.equal(exported.verified,'file_bytes');assert.equal(exported.attachmentsSaved,1);
  const files=await ui.evaluate(async relative=>{let dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('VOC files');for(const part of relative.split('/'))dir=await dir.getDirectoryHandle(part);const names=[];for await(const [name] of dir.entries())names.push(name);return names;},exported.path);assert(files.includes('record.md'));assert(files.some(name=>name.endsWith('.txt')));
  assert.deepEqual((await ok('RUN_TOOL',{requestId,name:'export_voc',args:{id:revision}})).files,exported.files);
  await ui.evaluate(async relative=>{let dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('VOC files');for(const part of relative.split('/'))dir=await dir.getDirectoryHandle(part);const writer=await(await dir.getFileHandle('record.md')).createWritable();await writer.write('USER EDIT');await writer.close();},exported.path);
  assert.equal((await ok('RUN_TOOL',{requestId,name:'export_voc',args:{id:revision}})).error,'workspace_conflict');
  assert.equal((await ok('GET_STATE')).chat.task.steps.at(-1).status,'error');
  await ok('FINISH_CHAT',{requestId,content:'티켓을 정리했습니다.'});await ui.reload();assert.equal((await ok('WORKSPACE_STATUS')).name,'VOC files');
  check('JSM visible evidence deduplicates, hidden comments excluded, attachments preserved, folder bytes verified without overwriting edits');
  await ui.evaluate(async () => {
    const {normalizeSkill}=await import(chrome.runtime.getURL('skills.js'));
    const skill=normalizeSkill({id:'custom-browser-script',name:'제목 입력',description:'테스트 제목 입력',instructions:'Observe the page first and fill the supplied title, then verify.',toolMode:'automatic',resources:[{path:'scripts/fill.browser.js',content:'await page.getByRole("textbox",{name:input.label,exact:true}).fill(input.value); return await page.getByRole("textbox",{name:input.label,exact:true}).inputValue();'}]});
    await chrome.storage.local.set({skills:[skill]});
  });
  started=await ok('START_CHAT',{text:'등록한 스킬로 제목을 입력해줘'});requestId=started.requestId;
  assert(started.tools.some(t=>t.function.name==='run_skill_script'));
  await ok('RUN_TOOL',{requestId,name:'browser_snapshot',args:{}});
  result=await ok('RUN_TOOL',{requestId,name:'run_skill_script',args:{skill_id:'custom-browser-script',path:'scripts/fill.browser.js',input:{label:'제목',value:'스킬로 작성한 제목'}}});
  assert(!result.error,JSON.stringify(result));assert.equal(await target.getByRole('textbox',{name:'제목'}).inputValue(),'스킬로 작성한 제목');
  const observation=await ok('RUN_TOOL',{requestId,name:'browser_snapshot',args:{}});
  const ref=observation.frames.flatMap(f=>f.elements||[]).find(e=>e.name==='제목').ref;
  result=await ok('RUN_TOOL',{requestId,name:'verify_page',args:{checks:[{kind:'field_value',ref,expected:'스킬로 작성한 제목'}]}});assert.equal(result.verified,true);
  await ok('FINISH_CHAT',{requestId,content:'제목 입력을 확인했습니다.'});
  check('Registered browser JavaScript runs inside the existing VM and field values pass independent verification');
  assert.deepEqual(errors,[]);check('Narrow/wide CX typography and reload persistence pass');
}finally{
  await mkdir('verification',{recursive:true});await writeFile('verification/integrations-browser.json',JSON.stringify({passed:checks.length===5,checks,errors,evidence:{realBrowser:true,syntheticMcpAndJsm:true,osFolderPicker:false,liveAccounts:false}},null,2));
  await context?.close();server?.closeAllConnections();if(server?.listening)await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});
}
