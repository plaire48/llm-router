import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,fixtureReview} from './fixtures.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {contextTokens} from '../../../extensions/aipro-chat/context-manager.js';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000,maxInputTokens:24000,maxOutputTokens:4096}]});

test('desktop reuses two concurrent isolated Pi researchers; child reads do not authorize leader edits', {timeout:15000}, async t=>{
  const {service,root}=await fixture(t,{scriptedReview:true});let parentRound=0,childStarts=0,seenHash,release,reviewed=false;
  const parallel=new Promise(resolve=>{release=resolve;});
  service.providers={status,dispose(){},async complete(messages,tools){
    if(messages[0].content.startsWith(REVIEW_PROMPT)){
      reviewed=true;assert.deepEqual(tools,[]);
      const handoffs=JSON.parse(messages[1].content).advisoryHandoffs;assert.equal(handoffs.length,2);assert.ok(handoffs.every(item=>item.uncertainties.includes('Cross-check original requirements')));
      assert.ok(JSON.parse(messages[1].content).evidence.every(e=>!['read_source','wiki_query'].includes(e.tool)),'child reads cannot become leader evidence');
      return fixtureReview(messages);
    }
    if(messages[0].content.includes('isolated research analyst')){
      assert.doesNotMatch(JSON.stringify(messages),/PARENT_ONLY_HISTORY/);
      assert.ok(tools.every(tool=>['read_analysis_evidence','read_source','source_search','wiki_query'].includes(tool.function.name)));
      const last=messages.findLast(m=>m.role==='tool');
      if(!last){if(++childStarts===2)release();await parallel;return messages[1].content.includes('source branch')?call('read_source',{path:'app.txt'}):call('wiki_query',{query:'welcome'});}
      const packet=JSON.parse(last.content);assert.equal(packet.source_status,'observed');
      if(packet.tool==='read_source'){const source=JSON.parse(packet.text).result;seenHash=source.hash;assert.equal(packet.provenance.path,'app.txt');}
      return {content:JSON.stringify({status:'complete',summary:'Observed project reference',findings:[{text:'The welcome implementation uses app.txt.',evidence_ids:[packet.evidence_id]}],uncertainties:['Cross-check original requirements'],next_step:''}),calls:[]};
    }
    parentRound++;
    if(parentRound===1){assert.ok(tools.some(tool=>tool.function.name==='delegate_analysis'));return call('delegate_analysis',{tasks:['source branch','wiki branch'].map(task=>({role:'research',task,done_when:'Cite a current project reference',evidence_ids:[]}))});}
    const delivered=JSON.stringify(messages).includes('Observed project reference');
    if(!delivered||!seenHash)return call('collect_analysis',{});
    const last=messages.findLast(m=>m.role==='tool');
    if(last&&/source_read_required/.test(last.content))return {content:'주 실행기에서 수정할 구간을 다시 읽어야 합니다.',calls:[]};
    return call('propose_edit',{path:'app.txt',expectedHash:seenHash,content:'Unobserved leader rewrite',reason:'Fixture must be refused'});
  }};
  const task=await service.createTask({request:'PARENT_ONLY_HISTORY: compare source and Wiki'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(childStarts,2);assert.equal(reviewed,true);assert.equal(service.task(task.id).state,'review');assert.equal(service.state().proposals.length,0);
  assert.equal(service.task(task.id).trace.filter(e=>e.tool==='analysis_research'&&e.status==='done').length,2);
  const history=service.analysisHistory({taskId:task.id});
  const roles=history.records.find(record=>record.kind==='roles');
  assert.equal(roles.workers.length,2);assert.equal(roles.state,'partial'); // Unresolved original requirements remain partial after collection.
  assert.ok(roles.workers.every(worker=>worker.analysis.outcome==='partial'));
  const review=history.records.find(record=>record.kind==='review');assert.equal(review.state,'ready');assert.equal(review.advisoryCount,2);
  for(const worker of roles.workers){assert.equal(worker.analysis.delivered,true);assert.equal(worker.analysis.reads,1);assert.equal(worker.analysis.doneWhen,'Cite a current project reference');}
  assert.doesNotMatch(JSON.stringify(history),/PARENT_ONLY_HISTORY/);
  assert.match(await readFile(path.join(root,'app.txt'),'utf8'),/^first\n/);
});

test('a desktop HITL question aborts the in-flight child transport and cannot restart without an answer', {timeout:10000},async t=>{
  const {service}=await fixture(t);let round=0,childStarted=false,childAborted=false;
  service.providers={status,dispose(){},async complete(messages,tools,signal){
    if(messages[0].content.includes('isolated research analyst')){
      childStarted=true;
      return new Promise((resolve,reject)=>{const cancel=()=>{childAborted=true;reject(new Error('cancelled'));};if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});});
    }
    if(round++===0)return call('delegate_analysis',{tasks:[{role:'research',task:'Read project documentation',done_when:'Return evidence',evidence_ids:[]}]});
    return call('ask_user',{question:'변경할 화면은 어디인가요?',choices:[{label:'현재 화면'},{label:'전체 화면'}]});
  }};
  const task=await service.createTask({request:'Improve the requested screen'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.ok(childStarted&&childAborted);assert.equal(service.task(task.id).state,'waiting_input');
  await assert.rejects(service.startAgent({taskId:task.id}),/question_pending/);assert.equal(service.state().proposals.length,0);
});

test('desktop shared context compaction retains every original criterion and answered decision within the model catalog input limit',async t=>{
  const {service}=await fixture(t);let summaries=0,parentCalls=0,maxWireTokens=0;
  const task=await service.createTask({request:'Original user goal',criteria:['CRITERION_FIRST','CRITERION_SECOND','CRITERION_THIRD','CRITERION_FOURTH']});
  service.store.set('computer-action:native-uncertain',{id:'native-uncertain',taskId:task.id,action:'click',state:'attention',execution:'unknown',verification:'not_verified',value:'PRIVATE_CONTROL_VALUE',identity:{windowTitle:'PRIVATE_WINDOW_TITLE'}});
  task.questionHistory=[{text:'범위는?',answer:{text:'USER_DECISION_CURRENT_SCREEN'}}];
  task.messages=Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',content:'Historical project discussion '+String(i)+' '+('reference details '.repeat(500))}));service.store.set('task:'+task.id,task);
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000,maxInputTokens:14000,maxOutputTokens:4096}]}),dispose(){},async complete(messages,tools){
    if(messages[0].content.startsWith('Summarize conversation')){summaries++;return {content:JSON.stringify({goal:'Original user goal',constraints:[],decisions:[],completed:[],pending:['Inspect current source'],references:[]}),calls:[]};}
    parentCalls++;maxWireTokens=Math.max(maxWireTokens,contextTokens(messages,tools));const wire=JSON.stringify(messages);for(const value of ['Original user goal','CRITERION_FIRST','CRITERION_SECOND','CRITERION_THIRD','CRITERION_FOURTH','USER_DECISION_CURRENT_SCREEN'])assert.ok(wire.includes(value),value);
    assert.match(wire,/native-uncertain/);assert.match(wire,/attention/);assert.doesNotMatch(wire,/PRIVATE_CONTROL_VALUE|PRIVATE_WINDOW_TITLE/);
    return {content:'원래 조건과 답변을 유지했습니다. 실행 검증은 아직 하지 않았습니다.',calls:[]};
  }};
  await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.ok(maxWireTokens<=14000,`wire tokens ${maxWireTokens}`);assert.ok(summaries>0);assert.equal(parentCalls,1,service.task(task.id).error);assert.equal(service.task(task.id).state,'review',service.task(task.id).error);assert.equal(service.task(task.id).criteria.every(c=>c.state==='unknown'),true);
  const memory=service.store.get('context:'+task.id)||service.store.get('context-history:'+task.id);
  assert.ok(memory.afterTokens<memory.beforeTokens);
  assert.equal(service.task(task.id).messages.filter(m=>m.content.startsWith('Historical project discussion')).length,24);
});

test('repeated unchanged source failure asks a durable focused question and resumes the original task',async t=>{
  const {service}=await fixture(t);let failures=0,answered=false;
  service.providers={status,dispose(){},async complete(messages,tools){
    if(tools.length===1&&tools[0].function.name==='ask_user')return call('ask_user',{question:'요청하신 설정 파일은 어느 경로에 있나요?',input_mode:'text'});
    if(!answered){failures++;return call('read_source',{path:'missing-settings.txt'});}
    assert.match(JSON.stringify(messages),/ORIGINAL_GOAL|app.txt/);
    return {content:'확인한 경로에서 이어가겠습니다. 아직 변경하지 않았습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'ORIGINAL_GOAL: inspect the requested settings',criteria:['Preserve current behavior']});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const waiting=service.task(task.id);assert.equal(failures,3);assert.equal(waiting.state,'waiting_input');assert.ok(waiting.question?.id);assert.equal(waiting.error,null);
  assert.equal(service.state().proposals.length,0);
  answered=true;await service.answerAgent({taskId:task.id,answer:'app.txt'});await service.agent.promise;
  const resumed=service.task(task.id);assert.equal(resumed.request,task.request);assert.equal(resumed.criteria[0].text,'Preserve current behavior');assert.equal(resumed.questionHistory[0].answer.text,'app.txt');assert.equal(resumed.state,'review');
});
