// User direction 2026-09-29: OpenWiki answers what it is asked; Desktop acts on
// that answer in the app. The ids of the text that the OpenWiki agent cited
// must be accepted as the evidence of an app action, single or batch, and the
// action keeps where its rule came from.
import {test} from 'node:test';
import {featureTest} from './beta-feature.mjs';
const computerTest=featureTest('computerUse');
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git} from '../runtime/files.mjs';
import {createAppHost} from '../eval/app-host.mjs';
import {WinappComputer} from '../runtime/computer-use.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const definition=JSON.parse(await readFile(new URL('../eval/computer/apps/expense-form.json',import.meta.url),'utf8'));
const RULE='Expenses of 50,000 won or more need the receipt attached.';

async function setup(t){
  const {service,root}=await fixture(t);
  await mkdir(path.join(root,'openwiki','policies'),{recursive:true});
  await writeFile(path.join(root,'openwiki','policies','expense-rules.md'),`---\ntitle: Expense rules\ndescription: Rules for expense claims.\n---\n\n# Expense rules\n\n${RULE}\n`);
  await git(root,['add','-A']);await git(root,['commit','-qm','expense rules']);
  const task=await service.createTask({request:'금액을 72,000원으로 고치고 규정에 맞게 영수증 첨부를 맞춰 줘.'}),host=createAppHost(definition);
  service.computerAdapter=new WinappComputer({platform:'win32',runner:host.runner});
  await service.computer({method:'bind',taskId:task.id,window:host.window});
  return {service,task,host};
}
// A scripted OpenWiki agent: plan, search, read, answer with the id of what it read.
function openwiki(messages){
  const prompt=messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
  if(prompt.includes('Plan OpenWiki research'))return {content:JSON.stringify({mode:'focused',questions:['What does an expense of 72,000 won need?']})};
  const reads=messages.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
  if(prompt.includes('Synthesize')){const ids=JSON.parse(messages.at(-1).content).evidence.map(item=>item.id);return {content:JSON.stringify({status:'complete',answer:RULE,findings:[{text:RULE,citations:ids.slice(0,1)}],uncertainties:[]})};}
  const found=reads.find(item=>Array.isArray(item));
  if(!found)return call('search_wiki',{query:'receipt expense 50,000'});
  const read=reads.find(item=>!Array.isArray(item)&&item.id&&item.excerpt);
  if(!read)return call('read_wiki',{documentId:found[0].documentId,start:0,length:6000});
  return {content:JSON.stringify({status:'complete',answer:RULE,findings:[{text:RULE,citations:[read.id]}],uncertainties:[]})};
}

for(const kind of ['single','batch'])computerTest(`an app action (${kind}) cites the text that the OpenWiki agent returned`,async t=>{
  const {service,task,host}=await setup(t);let leader=0,answer,proposed;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    if(!messages[0].content.startsWith('You are Nubi Desktop'))return openwiki(messages);
    const last=messages.findLast(message=>message.role==='tool'),result=last?JSON.parse(last.content):null;
    switch(leader++){
      case 0:return call('ask_openwiki',{wiki:'external',question:'72,000원 경비에 필요한 설정은? (Wiki language: en)'});
      case 1:answer=result;return call('observe_computer',{includeImage:false});
      case 2:{
        const evidenceIds=[answer.evidence[0].id];
        return kind==='single'
          ?call('propose_computer_action',{observationId:result.observationId,selector:'txt-amount',action:'set_value',value:'72000',reason:'규정에 따라 금액을 고칩니다.',evidenceIds})
          :call('propose_computer_batch',{observationId:result.observationId,reason:'규정에 따라 금액과 영수증 첨부를 맞춥니다.',steps:[{selector:'txt-amount',action:'set_value',value:'72000'},{selector:'chk-receipt',action:'toggle_on'}],evidenceIds});
      }
      default:proposed=result;return {content:'승인을 기다립니다.',calls:[]};
    }
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review',service.task(task.id).error);
  assert.equal(answer.status,'complete');assert.match(answer.evidence[0].id,/^e_/);
  const action=service.state().computer.actions.find(item=>item.taskId===task.id);
  assert.ok(action,'the proposal was made: '+JSON.stringify(proposed||{}).slice(0,300));
  assert.equal(action.state,'proposed');
  assert.deepEqual(action.wikiEvidence.map(row=>row.path),['openwiki/policies/expense-rules.md'],'the action keeps where its rule came from');
  assert.deepEqual(host.state().inputs,[],'nothing is sent before the approval');
  await service.computer({method:'decide',taskId:task.id,id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  assert.equal(host.state().controls['txt-amount'].value,'72000');
});
