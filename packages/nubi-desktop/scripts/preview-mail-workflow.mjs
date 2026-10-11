// Interactive review with synthetic mail in the production Electron surfaces.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const fixture=path.resolve('verification/all-surfaces/fixture/index.html');
await access(fixture);
const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-review-'));
const require=createRequire(import.meta.url);
const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:root,ELECTRON_RUN_AS_NODE:undefined}});
try{
 const page=await app.firstWindow();
 await page.setViewportSize({width:1600,height:950});
 await page.goto('file://'+fixture+'?integrated&modals&toolbar&mail-flow');
 await page.evaluate(()=>document.title='누비 Workspace — 메일 검토 (예시 데이터)');
 await page.getByRole('textbox',{name:'작업 요청',exact:true}).fill('선택한 메일에서 승인할 항목과 일정을 비교해 주세요.');
 await page.getByRole('button',{name:'메일',exact:true}).click();
 await page.locator('.nubi-mail-result').first().waitFor();
 await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.show();window.focus();});
 console.log('Mail review window ready: 47 synthetic messages. No real account or model calls.');
 await page.waitForEvent('close',{timeout:0});
}finally{await app.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
