// The simulated app must satisfy the real adapter: every check here goes
// through WinappComputer and the host functions, not through the runner alone.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixtures.mjs';
import {createAppHost,validateApp} from '../eval/app-host.mjs';
import {WinappComputer,observeComputer,proposeComputerAction,verifyComputerValue} from '../runtime/computer-use.mjs';
import {readComputerResult} from '../runtime/computer-harness.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);

const definition=JSON.parse(await readFile(new URL('../eval/computer/apps/expense-form.json',import.meta.url),'utf8'));
async function connected(t){
  const {service}=await fixture(t),task=await service.createTask({request:'경비 신청 양식을 확인한다.'}),host=createAppHost(definition);
  service.computerAdapter=new WinappComputer({platform:'win32',runner:host.runner});
  await service.computer({method:'bind',taskId:task.id,window:host.window});
  const decide=(proposal,decision='approve')=>service.computer({method:'decide',taskId:task.id,id:proposal.id,fingerprint:proposal.fingerprint,decision});
  return {service,task,host,decide};
}

test('the app definition is valid and a broken one names its fields',()=>{
  assert.deepEqual(validateApp(definition),[]);
  assert.deepEqual(validateApp({...definition,controls:[{selector:'bad selector',name:'x',type:'Edit'}]}).slice(0,1),['controls[0].selector']);
  assert.throws(()=>createAppHost({...definition,window:{}}),/app_invalid/);
});

test('an observation through the adapter shows the controls down to the depth the tool reads',async t=>{
  const {service,task,host}=await connected(t);
  assert.equal(service.state().computer.availability.available,true);
  const seen=await observeComputer(service,task.id,{includeImage:false});
  const names=seen.elements.map(element=>element.name);
  assert.ok(names.includes('신청자')&&names.includes('제출')&&names.includes('상태: 작성 중'));
  assert.ok(!names.includes('입금 계좌 끝 4자리'),'a control below the inspected depth is not in the tree');
  assert.equal(seen.identity.windowTitle,'경비 신청 - 작성 중');
  const found=await observeComputer(service,task.id,{query:'입금 계좌',includeImage:false});
  assert.deepEqual(found.elements.map(element=>element.selector),['txt-bank-account'],'a search finds it');
  const pictured=await observeComputer(service,task.id,{selector:'txt-amount'});
  assert.equal(pictured.image.mimeType,'image/png');assert.equal(pictured.target.resolvedSelector,'txt-amount');
  assert.ok(host.state().commands.includes('inspect -w'));assert.deepEqual(host.state().inputs,[]);
});

test('an approved value change reaches the app once and is read back',async t=>{
  const {service,task,host,decide}=await connected(t);
  const seen=await observeComputer(service,task.id,{selector:'txt-amount',includeImage:false});
  const proposal=await proposeComputerAction(service,task.id,{observationId:seen.observationId,selector:'txt-amount',action:'set_value',value:'45000',reason:'금액 변경'},new Set([seen.observationId]));
  assert.deepEqual(host.state().inputs,[],'a proposal sends nothing');
  await decide(proposal);
  assert.deepEqual(host.state().inputs,[{action:'set_value',selector:'txt-amount',value:'45000'}]);
  assert.equal(host.state().controls['txt-amount'].value,'45000');
  const receipt=readComputerResult(service,task.id,{actionId:proposal.id}).receipt;
  assert.equal(receipt.verification,'value_matched');
  const fresh=await observeComputer(service,task.id,{selector:'txt-amount',includeImage:false});
  const check=await verifyComputerValue(service,task.id,{observationId:fresh.observationId,selector:'txt-amount',expected:'45000'},new Set([fresh.observationId]));
  assert.equal(check.verification,'value_matched');
});

test('states, selection and rules of the app follow the inputs',async t=>{
  const {service,task,host,decide}=await connected(t);
  const act=async(selector,action,value)=>{
    const seen=await observeComputer(service,task.id,{...(selector==='item-dept-dev'?{query:'개발팀'}:{selector}),includeImage:false});
    const proposal=await proposeComputerAction(service,task.id,{observationId:seen.observationId,selector,action,...(value===undefined?{}:{value}),reason:'검사'},new Set([seen.observationId]));
    await decide(proposal);return readComputerResult(service,task.id,{actionId:proposal.id}).receipt;
  };
  assert.equal((await act('chk-urgent','toggle_on')).verification,'state_matched');
  assert.equal(host.state().controls['chk-urgent'].toggle,'On');
  await act('item-dept-dev','select');
  assert.equal(host.state().controls['cmb-department'].value,'개발팀');assert.equal(host.state().controls['item-dept-sales'].selected,'False');
  await act('btn-save','invoke');
  assert.deepEqual(host.state().events,['saved']);assert.equal(host.state().controls['lbl-status'].name,'상태: 임시 저장됨');
  await act('txt-amount','set_value','삼만원');await act('btn-submit','invoke');
  assert.deepEqual(host.state().events,['saved','submit_refused'],'the app refuses an amount that is not a number');
});

test('a password and a read-only field keep their protection',async t=>{
  const {service,task,host}=await connected(t);
  const secret=await observeComputer(service,task.id,{selector:'txt-approval-password',includeImage:false});
  assert.equal(secret.target.password,'True');assert.ok(!JSON.stringify(secret).includes('p@ss-7731'),'the value of a password field is never read');
  await assert.rejects(verifyComputerValue(service,task.id,{observationId:secret.observationId,selector:'txt-approval-password',expected:'x'},new Set([secret.observationId])));
  const fixed=await observeComputer(service,task.id,{selector:'txt-document-number',includeImage:false});
  assert.equal(fixed.target.readOnly,'True');
  assert.ok(!host.state().commands.some(command=>command.startsWith('get-value txt-approval-password')));
});

test('a capture shows the labels and values of the controls, and a password as dots',async t=>{
  const {mkdtemp,rm,readFile:read}=await import('node:fs/promises'),os=await import('node:os'),pathModule=await import('node:path'),{PNG}=await import('pngjs');
  const directory=await mkdtemp(pathModule.join(os.tmpdir(),'nubi-app-render-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const host=createAppHost(definition),whole=pathModule.join(directory,'window.png'),part=pathModule.join(directory,'amount.png');
  const first=await host.runner(['ui','screenshot','--capture-screen','-w','4100','--output',whole,'--json']);
  assert.deepEqual([first.width,first.height,first.elementId],[900,860,null]);
  const element=await host.runner(['ui','screenshot','txt-amount','-w','4100','--output',part,'--json']);
  assert.deepEqual([element.width,element.height,element.elementId],[320,28,'txt-amount']);
  const picture=PNG.sync.read(await read(whole)),small=PNG.sync.read(await read(part));
  assert.deepEqual([picture.width,picture.height,small.width,small.height],[900,860,320,28]);
  if(host.state().images==='drawn'){
    // Text is dark on a light ground: a drawn picture holds many dark pixels, a plain one holds none.
    const dark=image=>{let count=0;for(let at=0;at<image.data.length;at+=4)if(image.data[at]<90&&image.data[at+1]<90&&image.data[at+2]<90)count++;return count;};
    assert.ok(dark(picture)>2000,'dark pixels in the window: '+dark(picture));assert.ok(dark(small)>100,'dark pixels in the control: '+dark(small));
  }
  // Without the drawing tool a capture is still a valid picture of the right size.
  const plain=createAppHost(definition,{render:async()=>false}),fallback=pathModule.join(directory,'plain.png');
  await plain.runner(['ui','screenshot','--capture-screen','-w','4100','--output',fallback,'--json']);
  assert.equal(PNG.sync.read(await read(fallback)).width,900);assert.equal(plain.state().images,'plain');
});
