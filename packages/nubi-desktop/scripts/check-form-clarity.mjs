import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/form-clarity');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/form-clarity-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,p;const errors=[],checks=[];
try {
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});p=await browser.newPage({viewport:{width:900,height:1000}});p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:'+server.address().port);await p.getByRole('button',{name:'DB 연결',exact:true}).click();
 if(process.argv.includes('--baseline')){await p.screenshot({path:'verification/form-clarity/db-before.png',fullPage:true});}
 else {
 const form=p.getByRole('form',{name:'DB 연결 정보'}),options=form.locator('details');
 assert.equal(await options.getAttribute('open'),null);assert.equal(await form.locator('input:visible,select:visible').count(),5);
 assert.equal(await p.evaluate(()=>window.dbCalls.length),0);checks.push('five basic controls; optional settings collapsed; opening never connects');
 await p.screenshot({path:'verification/form-clarity/db-after.png',fullPage:true});
 await p.setViewportSize({width:440,height:950});await p.screenshot({path:'verification/form-clarity/db-narrow.png',fullPage:true});assert.equal(await form.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
 checks.push('basic form fits a narrow view without horizontal scrolling');
 await form.getByRole('button',{name:'연결해서 읽기'}).click();assert.equal(await p.evaluate(()=>window.dbCalls.length),0);
 checks.push('required account/database fields stop submission before RPC');
 await form.getByLabel('DB 이름',{exact:true}).fill('project');await form.getByLabel('사용자',{exact:true}).fill('reader');await form.getByLabel('비밀번호',{exact:true}).fill('fixture-password');
 await p.evaluate(()=>window.dbFail=true);await form.getByRole('button',{name:'연결해서 읽기'}).click();await form.getByText(/DB에 연결하지 못했어요/).waitFor();
 assert.equal(await form.getByLabel('DB 이름',{exact:true}).inputValue(),'project');assert.equal(await form.getByLabel('비밀번호',{exact:true}).inputValue(),'fixture-password');
 checks.push('failed connection retains entered values for correction');
 await p.evaluate(()=>window.dbFail=false);
 for(const [engine,port,schema] of [['postgres',5432,'public'],['mysql',3306,'project'],['mariadb',3306,'project'],['sqlserver',1433,'dbo'],['oracle',1521,'READER']]){
   await form.getByLabel('DB 종류',{exact:true}).selectOption(engine);await form.getByRole('button',{name:'연결해서 읽기'}).click();
   await p.waitForFunction(count=>window.dbCalls.length===count,2+['postgres','mysql','mariadb','sqlserver','oracle'].indexOf(engine));
   const sent=await p.evaluate(()=>window.dbCalls.at(-1));assert.equal(sent.input.port,port);assert.equal(sent.input.schema,schema);assert.equal(sent.input.tls,true);
   await p.waitForFunction(()=>document.querySelector('input[type=password]').value==='');
 }
 checks.push('five DB engines derive correct port/schema, keep TLS and clear password after success');
 await form.getByLabel('DB 종류',{exact:true}).selectOption('postgres');await options.locator('summary').click();
 await form.getByLabel('스키마',{exact:true}).fill('reporting');await form.getByLabel('포트',{exact:true}).fill('5433');
 await form.getByLabel('연결 ID',{exact:true}).fill('reporting-db');await options.locator('summary').click();await form.getByRole('button',{name:'연결해서 읽기'}).click();
 await p.waitForFunction(()=>window.dbCalls.length===7);let sent=await p.evaluate(()=>window.dbCalls.at(-1));assert.equal(sent.input.schema,'reporting');assert.equal(sent.input.port,5433);assert.equal(sent.id,'reporting-db');
 checks.push('custom connection values survive collapsing options');
 await options.locator('summary').click();await form.getByLabel('포트',{exact:true}).fill('0');await options.locator('summary').click();await form.getByRole('button',{name:'연결해서 읽기'}).click();
 assert.notEqual(await options.getAttribute('open'),null);assert.equal(await p.evaluate(()=>window.dbCalls.length),7);await form.getByLabel('포트',{exact:true}).fill('5433');
 checks.push('invalid hidden settings open for correction without dispatch');
 await p.evaluate(()=>window.dbStatusFail=true);await form.getByRole('button',{name:'연결해서 읽기'}).click();
 await p.getByText('요청은 처리됐지만 연결 목록을 갱신하지 못했어요.',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>window.dbCalls.length),8);
 assert.equal(await form.getByLabel('비밀번호',{exact:true}).inputValue(),'');assert.equal(await form.getByText(/DB에 연결하지 못했어요/).count(),0);
 await p.screenshot({path:'verification/form-clarity/db-status-recovery.png',fullPage:true});
 await p.evaluate(()=>window.dbStatusFail=false);await p.getByRole('button',{name:'연결 상태 다시 확인',exact:true}).click();
 await p.getByRole('button',{name:'연결 상태 다시 확인',exact:true}).waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.dbCalls.length),8);
 checks.push('successful DB action is preserved after status read failure; retry refreshes status without reconnecting');
 await p.goto('http://127.0.0.1:'+server.address().port+'/?voc=1');await p.getByText('VOC 자료',{exact:true}).click();
 await p.evaluate(()=>window.vocFail=true);await p.getByLabel('VOC JSON 파일').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from('{}')});
 await p.getByText('자료 목록을 읽지 못했어요. 검색을 다시 시도해 주세요.',{exact:true}).waitFor();
 assert.deepEqual(await p.evaluate(()=>window.formNotices),['VOC 자료를 보관했어요.']);assert.deepEqual(await p.evaluate(()=>window.formErrors),[]);
 assert.deepEqual(await p.evaluate(()=>window.vocCalls),['importVoc','queryVoc']);
 await p.evaluate(()=>window.vocFail=false);await p.getByRole('button',{name:'VOC 검색 실행',exact:true}).click();await p.getByText('VOC-1 보관한 자료',{exact:true}).waitFor();
 assert.deepEqual(await p.evaluate(()=>window.vocCalls),['importVoc','queryVoc','queryVoc']);
 checks.push('VOC import success remains distinct from failed listing; search never imports the file again');
 assert.deepEqual(errors,[]);await writeFile('verification/form-clarity/result.json',JSON.stringify({passed:checks.length,checks,scope:'Synthetic UI. No actual DB connection or model evaluation.'},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
 }
} finally {await browser?.close();await new Promise(r=>server.close(r));}
