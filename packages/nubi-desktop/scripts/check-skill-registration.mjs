import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,realpath,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {git} from '../runtime/files.mjs';
import {zip} from '../tests/skill-zip-fixture.mjs';
import {assertDesktopDialog} from './identity-browser.mjs';

const temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-skills-ui-'))),root=path.join(temp,'project'),source=path.join(temp,'Company skill');
await mkdir(root);await git(root,['init','-q']);await writeFile(path.join(root,'README.md'),'# UI fixture');await git(root,['add','.']);await git(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture']);
const content=name=>`---\nname: ${name}\ndescription: 회사 문서 작성 규칙\n---\nRead references/한글/guide.md. Use assets/template.docx when requested.`;
await mkdir(path.join(source,'references/한글'),{recursive:true});await mkdir(path.join(source,'assets'));await writeFile(path.join(source,'SKILL.md'),content('folder-writing'));await writeFile(path.join(source,'references/한글/guide.md'),'핵심 결론을 먼저 작성합니다.');const binary=Buffer.from([0x50,0x4b,0,0xff]);await writeFile(path.join(source,'assets/template.docx'),binary);
await writeFile(path.join(temp,'Company skill.zip'),zip([['company/SKILL.md',content('zip-writing')],['company/references/한글/guide.md','첨부 문서의 출처를 확인합니다.'],['company/assets/template.docx',binary]]));
await mkdir('verification',{recursive:true});
const backend=spawn(process.execPath,['browser-app/lib/backend/main.js',root,'--hostname=127.0.0.1','--port=4334'],{env:{...process.env,THEIA_CONFIG_DIR:path.join(temp,'theia'),NUBI_STORAGE_ROOT:path.join(temp,'state')},stdio:['ignore','pipe','pipe']});
let logs='';backend.stdout.on('data',d=>logs+=d);backend.stderr.on('data',d=>logs+=d);
let browser,p;const checks=[],errors=[];
try {
  for(let attempt=0;attempt<100;attempt++){try{if((await fetch('http://127.0.0.1:4334')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});p=await browser.newPage({viewport:{width:1280,height:950}});p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:4334');await p.getByRole('button',{name:'Yes, I trust the authors'}).click();await p.getByRole('button',{name:'스킬 관리',exact:true}).click();
  const panel=()=>p.getByRole('dialog',{name:'스킬 관리',exact:true});
  await panel().getByText('등록한 스킬이 없어요.',{exact:true}).waitFor();
  await assertDesktopDialog(panel());checks.push('skill dialog uses HTML typography, palette, rounded surface and accessible buttons');
  const fonts=await p.evaluate(async()=>{const faces=await document.fonts.load('400 14px "Noto Sans KR"','누비 스킬');return faces.map(face=>face.status);});assert(fonts.length>0&&fonts.every(status=>status==='loaded'));checks.push('bundled Korean font loads without a remote font service');
  assert.equal(await p.getByRole('button',{name:'보고서 스킬로 시작',exact:true}).count(),0);
  async function choose(kind,name) {
    await panel().getByRole('button',{name:kind==='folder'?'폴더 등록':'ZIP 등록',exact:true}).click();
    const dialog=p.locator('.dialogBlock').filter({hasText:kind==='folder'?'스킬 폴더 등록':'스킬 ZIP 등록'});
    await dialog.waitFor();assert.equal(await dialog.evaluate(e=>getComputedStyle(e).fontSize),'14px');assert.equal(await dialog.evaluate(e=>getComputedStyle(e).borderRadius),'20px');
    await dialog.locator('.theia-LocationInputToggle').click();await dialog.locator('.theia-LocationTextInput').fill(temp);await dialog.locator('.theia-LocationTextInput').press('Enter');
    await dialog.getByText(name,{exact:true}).click();await dialog.getByRole('button',{name:'Open',exact:true}).click();
  }
  await choose('folder','Company skill');await panel().getByText('folder-writing',{exact:true}).waitFor();
  assert.equal(await readFile(path.join(root,'.agents/skills/folder-writing/references/한글/guide.md'),'utf8'),'핵심 결론을 먼저 작성합니다.');assert.deepEqual(await readFile(path.join(root,'.agents/skills/folder-writing/assets/template.docx')),binary);
  checks.push('real Theia folder picker registers nested Korean reference and binary asset');
  await choose('zip','Company skill.zip');await panel().getByText('zip-writing',{exact:true}).waitFor();assert.deepEqual(await readFile(path.join(root,'.agents/skills/zip-writing/assets/template.docx')),binary);checks.push('real Theia ZIP picker imports wrapper folder and displays registered skill');
  await choose('zip','Company skill.zip');await p.getByRole('status').getByText('zip-writing 스킬이 같은 내용으로 등록되어 있어요.',{exact:true}).waitFor();await panel().getByText('zip-writing',{exact:true}).waitFor();assert.equal(await panel().locator('.nubi-skill-card').count(),2);checks.push('identical upload verifies stored bytes and reports already registered');
  await writeFile(path.join(root,'.agents/skills/zip-writing/references/한글/guide.md'),'Human edit');await choose('zip','Company skill.zip');await panel().getByText(/같은 이름의 스킬이 있어요/).waitFor();assert.equal(await readFile(path.join(root,'.agents/skills/zip-writing/references/한글/guide.md'),'utf8'),'Human edit');checks.push('changed resource is preserved and duplicate upload reports a conflict');
  await panel().getByRole('button',{name:'ZIP 등록',exact:true}).click();await p.locator('.dialogBlock').filter({hasText:'스킬 ZIP 등록'}).getByRole('button',{name:'Cancel',exact:true}).click();await panel().getByText('zip-writing',{exact:true}).waitFor();assert.equal(await panel().locator('.nubi-skill-card').count(),2);checks.push('picker cancellation does not register a skill');
  await p.screenshot({path:'verification/ui-skill-registration.png'});
  await p.reload();await p.getByRole('button',{name:'스킬 관리',exact:true}).click();await panel().getByText('zip-writing',{exact:true}).waitFor();assert.equal(await panel().locator('.nubi-skill-card').count(),2);checks.push('registered skills remain visible after renderer reload');
  await mkdir(path.join(root,'.agents/skills/broken-skill'));await writeFile(path.join(root,'.agents/skills/broken-skill/SKILL.md'),'Missing metadata');
  await panel().getByRole('button',{name:'목록 새로고침',exact:true}).click();await panel().getByText('확인이 필요한 스킬 1개',{exact:true}).click();await panel().getByText('.agents/skills/broken-skill/SKILL.md',{exact:true}).waitFor();await panel().locator('details').getByText('SKILL.md의 name과 description을 확인해 주세요.',{exact:false}).waitFor();checks.push('invalid skill is disclosed with its path and actionable metadata error');
  await p.setViewportSize({width:360,height:950});await assertDesktopDialog(panel());await p.screenshot({path:'verification/ui-skill-registration-narrow.png'});checks.push('registration panel fits narrow window');
  const refresh=panel().getByRole('button',{name:'목록 새로고침',exact:true});await p.keyboard.press('Tab');await refresh.focus();await p.getByRole('tooltip').getByText('목록 새로고침',{exact:true}).waitFor();await p.keyboard.press('Escape');await panel().waitFor();await p.keyboard.press('Escape');await panel().waitFor({state:'hidden'});assert.equal(await p.getByRole('button',{name:'스킬 관리',exact:true}).evaluate(e=>document.activeElement===e),true);await p.getByRole('button',{name:'스킬 관리',exact:true}).click();await panel().getByText('folder-writing',{exact:true}).waitFor();checks.push('icon help is visible to keyboard users and Escape returns focus to the opener');
  await panel().locator('.nubi-skill-card').filter({hasText:'folder-writing'}).getByRole('button',{name:'지침 열기',exact:true}).click();await p.locator('.lm-TabBar-tabLabel').filter({hasText:'SKILL.md'}).waitFor();checks.push('registered instructions open in the real source editor');
  assert.deepEqual(errors,[]);await writeFile('verification/skill-registration-ui.json',JSON.stringify({passed:true,checks,scope:'Actual Theia browser UI and local worker. No live LLM or Windows native dialog verification.'},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
} catch(error) {if(p){console.error(await p.locator('body').ariaSnapshot());await p.screenshot({path:'verification/ui-skill-registration-failure.png'});}throw error;}
finally {await browser?.close();backend.kill();await new Promise(r=>backend.once('exit',r));await writeFile('verification/skill-registration-ui-backend.log',logs);await rm(temp,{recursive:true,force:true});}
