// Skill registration and use in the real Electron app (2026-10-07). A loopback OpenAI-compatible fixture serves the
// model through the worker's own "compatible" provider, so the composer and the skill menu open without a product hook
// or a real login. Covers folder, ZIP and Markdown registration, a duplicate and a cancelled pick, a malformed instruction
// disclosed and recovered, remove from the project without a trash browser, a skill chosen in the composer that a run discovers, loads and
// follows, the instruction opened in the editor, and registrations surviving a restart.
// Run from the package dir after scripts/build-electron.mjs: node scripts/check-electron-skills.mjs
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startFixtureModel} from './fixture-model.mjs';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {zip} from '../tests/skill-zip-fixture.mjs';
const require=createRequire(import.meta.url),SENTINEL='SENTINEL_SKILL_7F3A';
const temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-skills-check-'))),root=path.join(temporary,'project'),storage=path.join(temporary,'state'),packages=path.join(temporary,'packages');
await mkdir(root);await mkdir(storage);await mkdir(path.join(packages,'fixture-skill','scripts'),{recursive:true});
const git=args=>execFileSync('git',['-C',root,...args]);git(['init']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
await writeFile(path.join(root,'example.js'),'export const value = 1;\n');git(['add','.']);git(['commit','-m','Initial fixture']);
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
// This test isolates skill registration from the separately checked Wiki onboarding.
await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki','home.md'),'# Skill fixture project\n');
const instructions=`---\nname: fixture-skill\ndescription: 검사용 스킬. 요청을 한 줄로 요약한다.\n---\n\n# 검사용 스킬\n\n답변 첫 줄에 ${SENTINEL} 표식을 그대로 적는다.\n`;
await writeFile(path.join(packages,'fixture-skill','SKILL.md'),instructions);await writeFile(path.join(packages,'fixture-skill','scripts','run.mjs'),'console.log("fixture");\n');
await writeFile(path.join(packages,'zipped-skill.zip'),zip([['zipped-skill/SKILL.md','---\nname: zipped-skill\ndescription: ZIP으로 등록한 스킬\n---\n\n# ZIP 스킬\n'],['zipped-skill/notes.md','참고 자료\n']]));
await writeFile(path.join(packages,'quick-note.md'),'# 빠른 메모\n\n메모 형식으로 답한다.\n');
const exists=file=>access(file).then(()=>true,()=>false),installed=(...parts)=>path.join(root,'.nubi','skill',...parts);

// The fixture model (scripts/fixture-model.mjs): discovers the skill, loads it with the hash the discovery returned, and
// answers with the sentinel once the loaded instruction carried it.
let loadedInstruction=false;
const fixture=await startFixtureModel({planSkill:'fixture-skill',respond({results,tools,calls,text,call}){
  if(results.some(result=>JSON.stringify(result).includes(SENTINEL))){loadedInstruction=true;return text(`${SENTINEL} 검사용 스킬 지침대로 요청을 한 줄로 요약했어요.`);}
  const discovered=results.find(result=>Array.isArray(result?.results)),skill=discovered?.results.find(item=>item.kind==='skill'&&item.name==='fixture-skill');
  if(skill&&calls.filter(name=>name==='use_skill').length<2)return call('use_skill',{path:skill.path,expectedHash:skill.hash});
  if(!discovered&&tools.includes('discover_capabilities'))return call('discover_capabilities',{query:'fixture'});
  return text('검사 응답입니다. 스킬을 찾지 못했어요.');
}});
const {calls,requests:seen,reviewProblems,planned}=fixture;

const checks=[];let app,page;const stage=name=>{console.log('stage',checks.length,name);checks.push(name);};
const launch=()=>electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
const request=(method,args={})=>page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
async function open(){
  app=await launch();page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>console.log('PAGE ERROR:',error.message));
  await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
  await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});
  const startup=page.getByText('메일을 연결해 주세요');if(await startup.count()){await page.keyboard.press('Escape');await startup.waitFor({state:'hidden',timeout:5000});}
  const status=await request('provider',{action:'connect',input:fixture.connection});
  assert.equal(status.connected,true,'the compatible provider connects to the fixture: '+JSON.stringify(status.__nubiError||status.provider));
  await trigger().waitFor({timeout:20000});/* the Workbench polls the provider status and shows the composer */
}
const trigger=()=>page.locator('.nubi-composer-skill-trigger'),skillsDialog=()=>page.getByRole('dialog',{name:'스킬 관리',exact:true}),toast=text=>page.locator('.nubi-feedback-toast').filter({hasText:text});
const row=name=>skillsDialog().locator('.nubi-custom-skill-row').filter({has:page.locator('strong',{hasText:name})});
const pick=file=>app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>file?{canceled:false,filePaths:[file]}:{canceled:true,filePaths:[]};},file);
async function openManagement(){await trigger().click();await page.getByRole('dialog',{name:'스킬 목록',exact:true}).getByRole('button',{name:/^내 스킬/}).click();await skillsDialog().waitFor();}
const pickerName=file=>process.platform==='darwin'?'선택':file&&!path.extname(file)?'폴더 선택':'파일 선택';/* one picker on macOS; a file and a folder picker elsewhere */
async function register(file,expected){
  await pick(file);await skillsDialog().getByRole('button',{name:'등록',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'스킬 등록',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:pickerName(file),exact:true}).click();
  if(expected){await toast(expected).waitFor();await skillsDialog().waitFor();}
  return dialog;
}
async function refresh(){await skillsDialog().getByRole('button',{name:'목록 새로고침',exact:true}).click();await skillsDialog().getByRole('status').filter({hasText:'스킬을 확인하고 있어요.'}).waitFor({state:'detached'});}
try{
  await open();stage('fixture model connected through the compatible provider');
  await openManagement();await skillsDialog().getByText('등록한 스킬이 없어요.').waitFor();
  await register(path.join(packages,'fixture-skill'),'스킬을 등록했어요.');await row('fixture-skill').waitFor();
  assert.equal(await readFile(installed('fixture-skill','SKILL.md'),'utf8'),instructions);assert.equal(await exists(installed('fixture-skill','scripts','run.mjs')),true,'bundled resources are copied');
  stage('folder registered into .nubi/skill');
  await register(path.join(packages,'zipped-skill.zip'),'스킬을 등록했어요.');await row('zipped-skill').waitFor();assert.equal(await readFile(installed('zipped-skill','notes.md'),'utf8'),'참고 자료\n');
  await register(path.join(packages,'quick-note.md'),'스킬을 등록했어요.');await row('quick-note').waitFor();
  const listed=await request('listSkills');const note=listed.skills.find(skill=>skill.title==='quick-note');assert.ok(note,'a Markdown file becomes a titled skill');assert.match(await readFile(path.join(root,note.path),'utf8'),/^---\nname: /,'the Markdown file gets a SKILL.md header');
  stage('ZIP and Markdown registered');
  await register(path.join(packages,'fixture-skill'),'같은 스킬이 이미 등록되어 있어요.');
  const cancelled=await register(null);await page.waitForTimeout(1500);assert.equal(await toast(/스킬을 등록했어요|등록하지 못했어요|선택해 주세요/).count(),0,'a cancelled pick says nothing');/* the duplicate toast may still be fading */await cancelled.waitFor();await page.keyboard.press('Escape');await skillsDialog().waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.nubi-custom-skill-row').length===3);/* the list reloads after the registration dialog closes */
  stage('duplicate and cancelled picks');
  const zipped=installed('zipped-skill','SKILL.md'),intact=await readFile(zipped,'utf8');await writeFile(zipped,'---\ndescription: 이름이 없는 지침\n---\n\n깨진 스킬\n');
  await refresh();await row('zipped-skill').getByText('지침을 확인해 주세요.').waitFor();
  const issues=skillsDialog().locator('details.nubi-skill-info');await issues.locator('summary').click();await issues.getByRole('button',{name:'.nubi/skill/zipped-skill/SKILL.md'}).waitFor();
  await writeFile(zipped,intact);await refresh();await row('zipped-skill').waitFor();assert.equal(await row('zipped-skill').getByText('지침을 확인해 주세요.').count(),0);assert.equal(await issues.count(),0,'a repaired instruction leaves no issue');
  stage('malformed instruction disclosed and recovered');
  await row('zipped-skill').getByRole('button',{name:'zipped-skill 삭제'}).click();await page.getByText('스킬을 삭제할까요?').waitFor();await page.getByRole('alertdialog').getByRole('button',{name:'삭제',exact:true}).click();
  await row('zipped-skill').waitFor({state:'detached'});assert.equal(await exists(zipped),false,'a deleted skill leaves the project');
  assert.equal(await skillsDialog().getByRole('button',{name:/휴지통/}).count(),0);
  stage('remove skill with no trash browser in My Skills');
  await page.keyboard.press('Escape');await skillsDialog().waitFor({state:'hidden'});
  await trigger().click();await page.getByRole('dialog',{name:'스킬 목록',exact:true}).getByRole('button',{name:'fixture-skill 스킬 사용'}).click();await toast('스킬을 요청에 추가했습니다').waitFor();
  const composer=page.getByRole('textbox',{name:'작업 요청'});assert.match(await composer.inputValue(),/^\/fixture-skill /,'the command leads the draft');
  await composer.click();await page.keyboard.press('End');await page.keyboard.type('요약해 줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.getByText(new RegExp(SENTINEL)).first().waitFor({timeout:90000});
  assert.deepEqual(calls.slice(0,2),['discover_capabilities','use_skill'],'the run discovers the skill, then loads it with the hash the discovery returned');assert.equal(loadedInstruction,true,'use_skill returned the registered instruction');
  const state=await request('state');const answered=state.tasks.flatMap(task=>task.messages||[]).find(message=>message.role==='assistant'&&message.content.includes(SENTINEL));assert.ok(answered,'the answer is in the conversation');
  assert.equal(await page.locator('.nubi-feedback-toast[data-tone="error"], .nubi-error').count(),0);
  stage('a skill chosen in the composer is discovered, loaded and followed in a run');
  await openManagement();await row('fixture-skill').getByRole('button',{name:'fixture-skill 수정'}).click();await skillsDialog().waitFor({state:'hidden'});
  await page.getByRole('tab',{name:/SKILL\.md/}).waitFor();await page.waitForFunction(sentinel=>document.querySelector('.desktop-editor')?.textContent.includes(sentinel),SENTINEL);
  stage('the instruction opens in the editor');
  await mkdir('verification',{recursive:true});await page.screenshot({path:'verification/electron-skills.png'});
  await app.close();await open();await openManagement();for(const name of ['fixture-skill','quick-note'])await row(name).waitFor();assert.equal(await row('zipped-skill').count(),0);assert.equal(await skillsDialog().locator('.nubi-custom-skill-row').count(),2);
  stage('registrations survive a restart');
  await writeFile('verification/electron-skills.json',JSON.stringify({platform:process.platform,checks,modelRequests:seen,toolCalls:calls,plannerOfferedSkill:planned,reviewProblems,boundary:'Local Electron with a scripted loopback model. No real provider login, marketplace or Windows installation.'},null,2));
  console.log(JSON.stringify({checks,toolCalls:calls,modelRequests:seen.length}));
}catch(error){await mkdir('verification',{recursive:true});await page?.screenshot({path:'verification/electron-skills-failure.png'}).catch(()=>{});console.log('model requests:',JSON.stringify(seen));console.log('tool calls:',JSON.stringify(calls));console.log('review problems:',JSON.stringify(reviewProblems));console.log(await page?.locator('.nubi-feedback-toast,.desktop-error,.nubi-error').allTextContents().catch(()=>[]));throw error;}
finally{await app?.close().catch(()=>{});fixture.close();await rm(temporary,{recursive:true,force:true});}
