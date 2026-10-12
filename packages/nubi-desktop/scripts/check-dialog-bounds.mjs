import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/dialog-bounds');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/surface-audit-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div class="desktop-shell"><div id="root"></div></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const results=[],errors=[];
try {
 browser=await chromium.launch({channel:'chrome',headless:true});
 const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const [width,height,scale] of [[360,560,100],[440,500,200]]) {
  await p.setViewportSize({width,height});
  for(const screen of ['models-long','registration','mail-settings','skills','marketplace','usage','mail-filters','startup','account']) {
   await p.goto('http://127.0.0.1:'+server.address().port+'/?screen='+screen);
   const dialog=p.locator('.deck-dialog:visible').first();await dialog.waitFor();
   await p.evaluate(scale=>document.documentElement.style.fontSize=scale+'%',scale);await p.evaluate(()=>document.fonts.ready);
   const failures=[];
   const bounds=await dialog.boundingBox();
   if(bounds.x<0||bounds.y<0||bounds.x+bounds.width>width+1||bounds.y+bounds.height>height+1)failures.push({kind:'dialog-outside',bounds});
   for(const control of await dialog.locator('button,input,select,textarea,summary').all()) {
    if(!await control.isVisible())continue;
    // An offscreen list item is valid only if scrolling can make it reachable.
    await control.evaluate(e=>e.scrollIntoView({block:'nearest',inline:'nearest'}));
    const clipping=await control.evaluate(el=>{
     const rect=el.getBoundingClientRect();let clip={left:0,top:0,right:innerWidth,bottom:innerHeight};
     for(let node=el.parentElement;node;node=node.parentElement){const style=getComputedStyle(node),r=node.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(style.overflowX)){clip.left=Math.max(clip.left,r.left);clip.right=Math.min(clip.right,r.right);}
      if(/auto|scroll|hidden|clip/.test(style.overflowY)){clip.top=Math.max(clip.top,r.top);clip.bottom=Math.min(clip.bottom,r.bottom);}
     }
     return rect.left<clip.left-1||rect.right>clip.right+1||rect.top<clip.top-1||rect.bottom>clip.bottom+1?{name:el.getAttribute('aria-label')||el.textContent.trim().slice(0,45),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},clip}:null;
    });
    if(clipping)failures.push(clipping);
   }
   await dialog.locator('.cx-panel-body').evaluateAll(nodes=>nodes.forEach(n=>n.scrollTop=0));
   await p.screenshot({path:path.join(dir,screen+'-'+width+'-'+scale+'.png'),animations:'disabled'});
   results.push({screen,width,height,scale,failures});
  }
 }
 await writeFile(path.join(dir,'result.json'),JSON.stringify({results,errors},null,2));
 assert.deepEqual(errors,[]);assert.deepEqual(results.filter(r=>r.failures.length),[]);
 console.log('PASS: '+results.length+' short-window / enlarged-text dialog cases; controls remain reachable through scroll, including footer and close.');
}finally{await browser?.close();server.close();}
