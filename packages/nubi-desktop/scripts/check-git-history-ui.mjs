import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/git-history');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/git-history-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.ttf':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();const data=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const checks=[],errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 for(const width of [360,620]){
  await page.setViewportSize({width,height:800});await page.goto(`http://127.0.0.1:${server.address().port}`);
  const rows=page.locator('.desktop-git-commit');await rows.first().waitFor();assert.equal(await rows.count(),25);
  assert(await rows.evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect(),m=node.querySelector('small');return r.right<=innerWidth&&m.scrollWidth<=m.clientWidth+1&&getComputedStyle(m).flexWrap==='nowrap';})));
  await rows.first().hover();assert.equal(await rows.first().evaluate(node=>node.querySelector('strong').getAnimations({subtree:true}).length),0,'commit title stays still');
  await page.screenshot({path:path.join(dir,`list-${width}.png`)});
  await page.getByRole('button',{name:'다음 커밋 페이지',exact:true}).click();await page.getByText('26–50',{exact:true}).waitFor();
  await page.getByRole('button',{name:'다음 커밋 페이지',exact:true}).click();await page.getByText('51–53',{exact:true}).waitFor();assert.equal(await rows.count(),3);assert(await page.getByRole('button',{name:'다음 커밋 페이지',exact:true}).isDisabled());
  await rows.first().click();await page.getByRole('region',{name:'커밋 변경 파일',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.historyCalls.filter(call=>call.path).length),0,'commit selection does not read file contents');assert.equal(await page.locator('.desktop-git-diff').count(),0);
  await page.getByRole('button',{name:'커밋 목록으로',exact:true}).click();await page.getByText('51–53',{exact:true}).waitFor();
  await page.getByRole('button',{name:'검증용 이력 토글'}).click();await page.evaluate(()=>window.historyDelay=800);await page.getByRole('button',{name:'검증용 이력 토글'}).click();assert.equal(await rows.count(),25,'reopening shows the cached first page while checking freshness');
  checks.push(`${width}px: readable rows, static titles, bounded pages, lazy file reading, cached reopen`);
 }
 for(const width of [360,620]){
  await page.setViewportSize({width,height:800});await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('.desktop-git-commit').first().waitFor();
  await page.evaluate(()=>window.historyEmptyCommit=true);
  await page.locator('.desktop-git-commit').first().click();
  const empty=page.locator('.nubi-git-empty-state');await empty.getByText('이 커밋에는 변경이 없어요',{exact:true}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.nubi-git-empty-state img')].every(img=>img.complete&&img.naturalWidth>0));
  assert(await empty.locator('strong').evaluate(node=>node.scrollWidth<=node.clientWidth&&getComputedStyle(node).whiteSpace==='nowrap'));
  await page.screenshot({path:path.join(dir,`empty-commit-${width}.png`),animations:'disabled'});
  await page.getByRole('button',{name:'커밋 목록으로',exact:true}).click();
  await page.evaluate(()=>window.historyEmpty=true);await page.getByRole('button',{name:'커밋 이력 새로고침',exact:true}).click();
  await empty.getByText('아직 커밋이 없어요',{exact:true}).waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await empty.locator('.agent-mark').evaluate(node=>node.getAnimations({subtree:true}).length),0);
  await page.evaluate(()=>window.historyFailure=true);await page.getByRole('button',{name:'커밋 이력 새로고침',exact:true}).click();
  await page.getByRole('button',{name:'다시 불러오기',exact:true}).waitFor();assert.equal(await empty.count(),0,'failure does not pretend to be an empty success');
  await page.evaluate(()=>window.historyFailure=false);await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();
  await empty.getByText('아직 커밋이 없어요',{exact:true}).waitFor();
  checks.push(`${width}px: branded empty results, loaded mascot, single-line title, reduced motion, failure and retry`);
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,boundary:'Synthetic catalog; native Git and Electron verified separately.'},null,2));console.log(JSON.stringify({checks}));
}finally{await browser?.close();server.close();}
