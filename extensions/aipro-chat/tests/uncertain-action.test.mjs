import test from 'node:test';
import assert from 'node:assert/strict';
import {uncertainTargets,resolvesTargets,sameVerifiedDocuments} from '../uncertain-action.js';
import {runAgent} from '../agent-runtime.js';
import {BUILTIN_SKILLS,browserTools} from '../skills.js';
const observation=(ref='old',url='https://portal.test/form')=>({url,tabId:101,topDocumentId:'document-a',frames:[{frameId:0,documentId:'document-a',elements:[{ref,name:'시간',role:'textbox'},{ref:'other',name:'부서',role:'textbox'}]}]});
test('uncertain fill requires every requested field value and the same uniquely observed target',()=>{
 const targets=uncertainTargets('fill_form',{fields:[{field_id:'old',value:'480'}]},observation());
 for(const checks of [[{kind:'text_present',expected:'포털'}],[{kind:'field_value',ref:'other',expected:'480'}],[{kind:'field_value',ref:'fresh',expected:'8'}]])assert(!resolvesTargets(targets,checks,observation('fresh')));
 const good=[{kind:'field_value',ref:'fresh',expected:'480'}];assert(resolvesTargets(targets,good,observation('fresh')));
 assert(!resolvesTargets(targets,good,observation('fresh','https://portal.test/other')));
 const duplicate=observation('fresh');duplicate.frames[0].elements.push({ref:'dup',name:'시간',role:'textbox'});assert(!resolvesTargets(targets,good,duplicate));
 const many=uncertainTargets('fill_form',{fields:[{field_id:'old',value:'480'},{field_id:'other',value:'개발'}]},observation());assert(!resolvesTargets(many,good,observation('fresh')));
});
test('a stateful click cannot be reconciled by a page title or another control',()=>{
 const before=observation();before.frames[0].elements[0]={ref:'old',name:'알림',role:'switch',checked:true};
 const targets=uncertainTargets('click_element',{ref:'old'},before);
 assert(!resolvesTargets(targets,[{kind:'text_present',expected:'완료'}],before));
 assert(!resolvesTargets(targets,[{kind:'control_state',ref:'other',expected:'true'}],before));
 assert(resolvesTargets(targets,[{kind:'control_state',ref:'old',expected:'false'}],before));
});
test('Pi refuses a second write after unrelated passing checks, then resumes after exact field verification',async()=>{
 let round=0,writes=0;
 const call=(name,args={})=>({content:'',calls:[{id:String(round),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 const done={content:'초안을 확인했습니다.',calls:null};
 await runAgent({messages:[{role:'user',content:'시간에 480을 입력해줘'}],tools:browserTools({},BUILTIN_SKILLS[0]),signal:new AbortController().signal,stepwise:true,
 complete:async(messages,_,state)=>{
  if(++round===1)return call('read_page');
  if(round===2)return call('fill_form',{fields:[{field_id:'old',value:'480'}]});
  if(round===3)return call('verify_page',{checks:[{kind:'text_present',expected:'포털'}]});
  if(round===4){assert.equal(state.verificationPending,true);assert(JSON.parse(messages.at(-1).content).unresolvedAction);return call('fill_form',{fields:[{field_id:'fresh',value:'480'}]});}
  if(round===5){assert.equal(JSON.parse(messages.at(-1).content).error,'action_outcome_unknown');return call('verify_page',{checks:[{kind:'field_value',ref:'fresh',expected:'480'}]});}
  assert.equal(state.verificationPending,false);return done;
 },execute:async(name,args)=>{
  if(name==='fill_form'){writes++;throw new Error('lost receipt');}
  if(name==='verify_page')return {ok:true,verified:true,checks:args.checks.map(check=>({kind:check.kind,passed:true})),observation:observation('fresh')};
  return observation();
 }});assert.equal(writes,1);assert.equal(round,6);
});

test('failed host verification refreshes refs without reconciling or replaying the write',async()=>{
 let round=0,writes=0,checks=0;
 const call=(name,args={})=>({content:'',calls:[{id:String(round),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 await runAgent({messages:[{role:'user',content:'시간에 480을 입력해줘'}],tools:browserTools({},BUILTIN_SKILLS[0]),signal:new AbortController().signal,stepwise:true,
 complete:async(messages,_,state)=>{
  if(++round===1)return call('read_page');
  if(round===2)return call('fill_form',{fields:[{field_id:'old',value:'480'}]});
  if(round===3)return call('verify_page',{checks:[{kind:'field_value',ref:'old',expected:'480'}]});
  if(round===4){assert.equal(state.verificationPending,true);return call('verify_page',{checks:[{kind:'field_value',ref:'fresh',expected:'480'}]});}
  assert.equal(state.verificationPending,false);return {content:'확인했습니다.',calls:null};
 },execute:async(name,args)=>{
  if(name==='fill_form'){writes++;throw new Error('lost receipt');}
  if(name==='verify_page'){const passed=++checks>1;return {ok:passed,verified:passed,...(!passed?{error:'verification_failed'}:{}),checks:args.checks.map(check=>({kind:check.kind,passed})),observation:observation('fresh')};}
  return observation();
 }});assert.equal(writes,1);assert.equal(checks,2);assert.equal(round,5);
});
test('reconciliation distinguishes frame URL, frame owner, control identity and form context',()=>{
 const before=observation();Object.assign(before.frames[0],{frame:0,url:'https://portal.test/form-a',owner:{id:'form-a'}});Object.assign(before.frames[0].elements[0],{id:'hours-a',context:[{role:'form',name:'업무 A'}]});
 const targets=uncertainTargets('fill_form',{fields:[{field_id:'old',value:'480'}]},before);
 for(const change of [a=>a.frames[0].url='https://portal.test/form-b',a=>a.frames[0].owner.id='form-b',a=>a.frames[0].elements[0].id='hours-b',a=>a.frames[0].elements[0].context[0].name='업무 B',a=>a.frames[0].frame=2]){
  const after=structuredClone(before);after.frames[0].elements[0].ref='fresh';change(after);
  assert.equal(resolvesTargets(targets,[{kind:'field_value',ref:'fresh',expected:'480'}],after),false);
 }
});
test('partial control snapshots cannot prove unique identity for fresh refs',()=>{
 const before=observation();const targets=uncertainTargets('fill_form',{fields:[{field_id:'old',value:'480'}]},before);
 for(const coverage of [{queryFiltered:true},{domTruncated:true},{controlsObserved:20,controlsReturned:2}]){
  const after=observation('fresh');after.frames[0].coverage=coverage;
  assert.equal(resolvesTargets(targets,[{kind:'field_value',ref:'fresh',expected:'480'}],after),false);
 }
});
test('a matching value in another tab or document cannot clear an uncertain write',()=>{
 const before=observation(),targets=uncertainTargets('fill_form',{fields:[{field_id:'old',value:'480'}]},before);
 const checks=[{kind:'field_value',ref:'fresh',expected:'480'}];
 for(const change of [next=>{next.tabId=202;},next=>{next.topDocumentId='document-b';next.frames[0].documentId='document-b';},next=>{next.frames[0].documentId='iframe-b';}]){
  const after=observation('fresh');change(after);assert.equal(resolvesTargets(targets,checks,after),false);
 }
 assert.equal(resolvesTargets(targets,checks,observation('fresh')),true);
 assert.equal(uncertainTargets('fill_form',{fields:[{field_id:'old',value:'480'}]},{...before,topDocumentId:null})[0].identity,null);
});
test('the verified page remains the same host document even when observation refs rotate',()=>{
 const before=observation(),after=observation('fresh'),checks=[{kind:'field_value',ref:'old',expected:'480'}];
 assert.equal(sameVerifiedDocuments(before,after,checks),true);
 const otherTab=structuredClone(after);otherTab.tabId=202;assert.equal(sameVerifiedDocuments(before,otherTab,checks),false);
 const otherDocument=structuredClone(after);otherDocument.topDocumentId='document-b';otherDocument.frames[0].documentId='document-b';assert.equal(sameVerifiedDocuments(before,otherDocument,checks),false);
 const otherFrame=structuredClone(after);otherFrame.frames[0].documentId='document-b';assert.equal(sameVerifiedDocuments(before,otherFrame,checks),false);
 assert.equal(sameVerifiedDocuments(before,after,[{...checks[0],ref:'missing'}]),false);
});
