import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {REVIEW_PROMPT,resultReviewInput,reviewResult,createReviewProgress,runReviewedAgent} from '../runtime/result-review.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const reply=content=>({content,calls:[]});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const isReview=messages=>messages[0]?.content.startsWith(REVIEW_PROMPT);
const decision=(messages,status='ready')=>reply(JSON.stringify({status,checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'확인한 범위만 설명합니다.'})),nextStep:status==='revise'?'app.txt를 읽고 확인한 내용만 답하세요.':''}));

test('a claimed approval wait without any host action resumes preparation instead of delivering ready',async()=>{
  const input={task:{request:'복사본을 만들어 줘'},candidate:'승인해 주시면 복사하겠습니다.',evidence:[],model:{contextLength:32000},signal:new AbortController().signal,
    receipts:{proposals:[],setupActions:[],processes:[],computer:{actions:[],omittedActions:0,unresolvedCount:0}},
    invoke:async messages=>reply(JSON.stringify({status:'ready',checks:JSON.parse(messages[1].content).requirements.map(r=>({requirementId:r.id,state:'pending',evidenceIds:['host'],detail:'사용자 승인을 기다립니다.'})),nextStep:''}))};
  const result=await reviewResult(input);
  assert.equal(result.status,'revise');assert.equal(result.normalized,'missing_host_boundary');assert.equal(result.checks[0].state,'unknown');
  assert.equal(input.receipts.computer.actions.length,0,'review creates no action or approval');
  for(const record of [{state:'proposed'},{state:'starting'},{state:'attention',execution:'unknown'},{state:'interrupted',execution:'unknown'}]){
    const protectedResult=await reviewResult({...input,receipts:{...input.receipts,computer:{actions:[record]}}});
    assert.equal(protectedResult.status,'ready','existing or uncertain work must not be prepared again');
  }
  const omitted=await reviewResult({...input,receipts:{...input.receipts,computer:{actions:[],omittedActions:1}}});
  assert.equal(omitted.normalized,undefined,'an incomplete list cannot prove absence');
});

test('independent review resumes the same Pi task, preserves corrections and records evidence without granting passes',async t=>{
  const {service,root}=await fixture(t,{scriptedReview:true});let executor=0,reviews=0;
  service.providers={status,dispose(){},complete:async(messages,tools)=>{
    if(isReview(messages)){
      reviews++;assert.deepEqual(tools,[]);
      const input=JSON.parse(messages[1].content);
      assert.equal(input.requirements[0].text,'app.txt 내용을 확인해 주세요.');assert.equal(input.requirements[1].text,'파일을 변경하지 않는다');
      assert.deepEqual(input.corrections,['첫 줄을 중심으로 확인해 주세요.']);
      assert.ok(input.answeredQuestions[0].answer.text==='app.txt');
      if(reviews===1){assert.equal(input.evidence.filter(e=>e.tool==='read_source').length,0);return decision(messages,'revise');}
      const observed=input.evidence.find(e=>e.tool==='read_source');assert.equal(observed.result.path,'app.txt');
      const result=JSON.parse(decision(messages).content);result.checks[0]={requirementId:'request',state:'supported',evidenceIds:[observed.id],detail:'현재 파일의 첫 줄을 읽었습니다.'};return reply(JSON.stringify(result));
    }
    executor++;
    if(executor===1)return reply('완료했습니다.');
    if(executor===2){assert.match(JSON.stringify(messages),/Independent review found unfinished work/);return call('read_source',{path:'app.txt'});}
    assert.ok(messages.findLast(m=>m.role==='tool'));return reply('app.txt의 첫 줄은 first입니다. 파일은 변경하지 않았습니다.');
  }};
  const task=await service.createTask({request:'app.txt 내용을 확인해 주세요.',criteria:['파일을 변경하지 않는다']});
  service.store.set('task:'+task.id,{...task,messages:[{role:'user',content:'첫 줄을 중심으로 확인해 주세요.'}],questionHistory:[{text:'대상 파일은?',answer:{text:'app.txt'}}]});
  await service.startAgent({taskId:task.id});await service.agent.promise;
  const saved=service.task(task.id);assert.equal(saved.state,'review');assert.equal(executor,3);assert.equal(reviews,2);
  assert.equal(saved.criteria[0].state,'unknown');assert.equal(saved.resultReview.status,'ready');assert.equal(saved.resultReview.round,2);
  assert.ok(saved.messages.every(m=>m.content!=='완료했습니다.'));assert.equal(service.store.list('result-review:').length,2);
  assert.equal(saved.trace.filter(s=>s.tool==='review_task'&&s.status==='done').length,2);
  assert.match(await readFile(path.join(root,'app.txt'),'utf8'),/^first\n/);
  service.store.close();await service.open(root);assert.equal(service.task(task.id).resultReview.round,2);
});

// User decision 2026-09-29: three reviews without new evidence hand the answer
// over with its open checks, as the limit of four reviews does. Until then the
// host replaced the answer with a question that quoted the review's
// instruction to the executor.
test('three unchanged review failures hand the answer over with its open checks, not unlimited answer retries',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0,executor=0;
  service.providers={status,dispose(){},complete:async messages=>{if(isReview(messages)){reviews++;return decision(messages,'revise');}executor++;return reply('근거 없이 같은 답변');}};
  const task=await service.createTask({request:'현재 소스에서 확인해 주세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const saved=service.task(task.id);assert.equal(executor,3);assert.equal(reviews,3);
  assert.equal(saved.state,'review');assert.equal(saved.question,null,'no question replaces the answer');
  assert.equal(saved.messages.at(-1).content,'근거 없이 같은 답변');
  assert.equal(saved.resultReview.status,'revise','the host does not call an unfinished review ready');assert.equal(saved.resultReview.handoff,'review_stalled');
  assert.equal(saved.resultReview.nextStep,'app.txt를 읽고 확인한 내용만 답하세요.');
  assert.equal(service.state().proposals.length,0);
});

test('review corrects an applied claim to a pending proposal without applying or duplicating it',async t=>{
  const {service,root}=await fixture(t,{scriptedReview:true});let executor=0,reviews=0,hash;
  service.providers={status,dispose(){},complete:async messages=>{
    if(isReview(messages)){
      reviews++;const data=JSON.parse(messages[1].content),host=data.evidence.find(e=>e.id==='host').result;
      assert.equal(host.proposals.length,1);assert.notEqual(host.proposals[0].state,'applied');
      const result=JSON.parse(decision(messages,reviews===1?'revise':'ready').content);
      if(reviews===1)result.nextStep='이미 준비한 수정안의 사용자 반영 승인을 기다린다고 답하세요. 새 수정안을 만들거나 실행하지 마세요.';
      else result.checks=result.checks.map(check=>({...check,state:'pending',evidenceIds:['host'],detail:'수정안은 준비됐으며 반영 승인은 아직입니다.'}));
      return reply(JSON.stringify(result));
    }
    executor++;
    if(executor===1)return call('read_source',{path:'app.txt'});
    if(executor===2){hash=JSON.parse(messages.findLast(m=>m.role==='tool').content).hash;return call('record_change_plan',{summary:'Change first line',requirements:[{id:'R1',text:'Change first line'}],targets:[{path:'app.txt',reason:'Observed content',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'inspection',description:'Read back saved first line'}],assumptions:[]});}
    if(executor===3)return call('propose_patch',{path:'app.txt',expectedHash:hash,edits:[{oldText:'first',newText:'updated'}],reason:'Requested text'});
    return reply(executor===4?'수정을 반영했습니다.':'수정안을 준비했습니다. 반영 승인을 기다립니다.');
  }};
  const task=await service.createTask({request:'첫 줄을 updated로 변경해 주세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(reviews,2);assert.equal(executor,5);assert.equal(service.state().proposals.length,1);
  assert.match(await readFile(path.join(root,'app.txt'),'utf8'),/^first\n/);assert.ok(service.task(task.id).messages.every(m=>m.content!=='수정을 반영했습니다.'));
  assert.equal(service.task(task.id).resultReview.checks[0].state,'pending');assert.equal(service.task(task.id).resultReview.evidence,undefined);
});

test('malformed reviews repair once and pause without publishing an unchecked answer',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0;
  service.providers={status,dispose(){},complete:async messages=>{if(isReview(messages)){reviews++;return reply('{broken');}return reply('모두 성공했습니다.');}};
  const task=await service.createTask({request:'확인해 주세요.'});await service.startAgent({taskId:task.id});await service.agent.promise;
  // The structured repair asks once more for valid JSON (2 calls); the read-only recovery of 2026-10-02 then runs the
  // executor again and reviews once more (2 calls) before the pause.
  assert.equal(reviews,4);assert.equal(service.task(task.id).state,'paused');assert.equal(service.task(task.id).error,'goal_review_failed');assert.equal(service.task(task.id).messages.length,0);assert.equal(service.task(task.id).resultReview.status,'error');
});

test('a pending user question bypasses result review and preserves the same task',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let reviews=0;
  service.providers={status,dispose(){},complete:async messages=>{if(isReview(messages)){reviews++;return decision(messages);}return call('ask_user',{question:'어떤 문구로 바꿀까요?',input_mode:'long_text'});}};
  const task=await service.createTask({request:'문구 변경'});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(reviews,0);assert.equal(service.task(task.id).state,'waiting_input');
});

test('cancellation during independent review never publishes a result or starts another executor',async t=>{
  const {service}=await fixture(t,{scriptedReview:true});let start;const started=new Promise(resolve=>{start=resolve;});let executor=0;
  service.providers={status,dispose(){},complete:async(messages,tools,signal)=>{if(isReview(messages)){start();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));}executor++;return reply('검토 전 답변');}};
  const task=await service.createTask({request:'확인'});await service.startAgent({taskId:task.id});await started;await service.stopAgent({taskId:task.id});
  assert.equal(executor,1);assert.equal(service.task(task.id).state,'cancelled');assert.equal(service.task(task.id).messages.length,0);
});

const input=()=>({task:{request:'Original request',criteria:[{id:'AC-1',text:'Preserve original acceptance'}],questionHistory:[]},evidence:[{tool:'read_source',result:{path:'a.ts',text:'const x=1',hash:'abc'}}],receipts:{proposals:[],processes:[]},candidate:'Observed x=1',model:{contextLength:32000},signal:new AbortController().signal});
test('truncated evidence never supports a requirement: the check is kept as unverified',async()=>{
  // Changed 2026-09-29 after live runs: this used to refuse the whole review and discard the answer.
  const args=input();args.evidence[0].result.text='x'.repeat(13000);let calls=0;
  const review=await reviewResult({...args,invoke:async messages=>{calls++;const body=JSON.parse(decision(messages).content);body.checks[0].state='supported';body.checks[0].evidenceIds=['tool:0'];return reply(JSON.stringify(body));}});
  assert.equal(calls,1);assert.equal(review.checks[0].state,'unknown');assert.deepEqual(review.checks[0].evidenceIds,[]);assert.deepEqual(review.setAside,['tool:0']);
  assert.equal(review.evidence.find(e=>e.id==='tool:0').usable,false);
  assert.equal(review.status,'revise','removing the sole proof must recheck the candidate, not just its badge');
  assert.equal(review.normalized,'unsupported_evidence');
});

test('failed and unmatched evidence cannot leave an unsupported claim ready',async()=>{
  for(const result of [{error:'file_missing'},{ok:false},{content:'old wiki',currentPageMatched:false}]){
    const args=input();args.evidence=[{tool:'read_source',result}];
    const review=await reviewResult({...args,invoke:async messages=>{
      const value=JSON.parse(decision(messages).content);value.checks[0]={...value.checks[0],state:'supported',evidenceIds:['tool:0']};return reply(JSON.stringify(value));
    }});
    assert.equal(review.status,'revise');assert.equal(review.checks[0].state,'unknown');
    assert.match(review.nextStep,/재실행하지/);
  }
});

test('honest unknowns remain deliverable and losing a model-only interpretation does not block delivery',async()=>{
  const args=input();args.evidence=[{tool:'read_source',result:{error:'file_missing'}}];
  const honest=await reviewResult({...args,invoke:async messages=>decision(messages)});
  assert.equal(honest.status,'ready');
  args.task.workPlan={intent:{outcomes:['Additional model interpretation']}};
  const interpretation=await reviewResult({...args,invoke:async messages=>{
    const value=JSON.parse(decision(messages).content),check=value.checks.find(c=>c.requirementId.startsWith('intent:'));
    check.state='supported';check.evidenceIds=['tool:0'];return reply(JSON.stringify(value));
  }});
  assert.equal(interpretation.status,'ready');
});

test('discarding sole evidence continues the same run and replaces the unsupported final answer',async()=>{
  const args=input();args.evidence=[{tool:'read_source',result:{error:'file_missing'}}];
  const outcomes=[];let runs=0;
  const answer=await runReviewedAgent({messages:[],signal:args.signal,waiting:()=>false,continuation:()=>[],
    run:async messages=>{runs++;if(runs>1)assert.match(messages.at(-1).content,/Do not repeat completed or uncertain actions/);return reply(runs===1?'파일 저장을 확인했습니다.':'파일을 읽지 못해 저장 여부를 확인하지 못했습니다.');},
    snapshot:()=>args,
    review:async value=>reviewResult({...args,candidate:value.candidate,invoke:async messages=>{
      const body=JSON.parse(decision(messages).content);
      if(runs===1)body.checks[0]={...body.checks[0],state:'supported',evidenceIds:['tool:0']};
      return reply(JSON.stringify(body));
    }}),onReview:async outcome=>outcomes.push(outcome.status)});
  assert.equal(runs,2);assert.deepEqual(outcomes,['revise','ready']);assert.equal(answer.content,'파일을 읽지 못해 저장 여부를 확인하지 못했습니다.');
});

test('progress ignores unmatched Wiki but distinguishes different mail identities',()=>{
  const progress=createReviewProgress();
  const fact=id=>[{tool:'read_personal_mail',result:{id,subject:'Same title',body:'Same body'}}];
  assert.equal(progress(fact('mail-a')),false);
  assert.equal(progress(fact('mail-a')),false);
  assert.equal(progress(fact('mail-b')),false);
  assert.equal(progress(fact('mail-b')),false,'another mail reset the no-progress streak');
  assert.equal(progress([{tool:'wiki_read',result:{currentPageMatched:false,content:'fabricated different content'}}]),false);
  assert.equal(progress([{tool:'wiki_read',result:{currentPageMatched:false,content:'another unmatched excerpt'}}]),true);
});
test('review rejects missing criteria, invented evidence and tool calls',async()=>{
  for(const mode of ['missing','invented','tool-call']){
    const args=input();
    let calls=0;
    await assert.rejects(reviewResult({...args,invoke:async messages=>{
      calls++;const result=decision(messages),body=JSON.parse(result.content);
      if(mode==='missing')body.checks.pop();
      else{body.checks[0].state='supported';body.checks[0].evidenceIds=[mode==='invented'?'fake':'tool:0'];}
      return {...reply(JSON.stringify(body)),...(mode==='tool-call'?{calls:[{name:'propose_edit'}]}:{})};
    }}),/goal_review_failed/);assert.equal(calls,2);
  }
});

test('review context retains literal requirements, marks omissions and fails closed when protected text exceeds budget',()=>{
  const args=input();args.evidence.push({tool:'observe_computer',result:{image_url:{url:'data:image/png;base64,SECRET_IMAGE'},text:'visible'}});
  const packet=resultReviewInput(args);assert.doesNotMatch(JSON.stringify(packet),/SECRET_IMAGE/);assert.match(JSON.stringify(packet),/Preserve original acceptance/);
  args.task.request='goal '.repeat(40000);assert.throws(()=>resultReviewInput(args),/context_input_too_large/);
});

test('progress uses new evidence rather than query, ID, timestamp, alternating repeats or error text',()=>{
  const progress=createReviewProgress();
  const fact=(text,extra={})=>[{tool:'read_source',result:{path:'a.ts',hash:text,...extra}}];
  assert.equal(progress(fact('A')),false);assert.equal(progress(fact('B')),false);
  assert.equal(progress(fact('A',{id:'new',at:'now',query:'different'})),false);
  assert.equal(progress(fact('B')),false);assert.equal(progress([{tool:'read_source',result:{error:'different_error'}}]),true);
  assert.equal(progress(fact('C')),false);
});

test('child failures and uncertainties reach review but cannot be cited as verified evidence',async()=>{
  const args=input();args.handoffs={items:[{id:'child-only',role:'research',task:'Read a source',state:'error',error:'analysis_format',collected:true,uncertainties:['Unresolved original requirement'],nextStep:'Read original source',image:'SECRET_IMAGE'}],omitted:2,omittedUnresolved:1};
  const packet=resultReviewInput(args);assert.equal(packet.data.advisoryHandoffs[0].state,'error');assert.equal(packet.data.advisoryHandoffs[0].advisory,true);assert.equal(packet.data.omittedHandoffs,2);assert.doesNotMatch(JSON.stringify(packet),/SECRET_IMAGE/);
  assert.ok(!packet.data.evidence.some(item=>item.id==='child-only'));
  assert.equal(packet.data.omittedUnresolvedHandoffs,1);
  await assert.rejects(reviewResult({...args,signal:new AbortController().signal,invoke:async(messages)=>{
    const value=JSON.parse(decision(messages).content);value.checks[0]={...value.checks[0],state:'supported',evidenceIds:['child-only']};return reply(JSON.stringify(value));
  }}),/goal_review_failed/);
});

test('review reports unresolved handoffs omitted by the input budget as well as the selection limit',()=>{
  const args=input();args.model={maxInputTokens:6000};
  args.handoffs={items:Array.from({length:12},(_,i)=>({id:'pending-'+i,role:'review',state:'error',task:'확인할 원문 범위 '.repeat(180),summary:'미확인 내용 '.repeat(110),uncertainties:['사용자 조건을 원본과 대조해야 합니다.'],collected:true})),omitted:3,omittedUnresolved:2};
  const {data}=resultReviewInput(args);
  const dropped=12-data.advisoryHandoffs.length;
  assert.ok(dropped>0);assert.equal(data.omittedHandoffs,3+dropped);assert.equal(data.omittedUnresolvedHandoffs,2+dropped);
  assert.equal(data.requirements[0].text,'Original request');assert.equal(data.requirements[1].text,'Preserve original acceptance');
});

// Found 2026-10-05: a task of 24 long messages in a 64K window paused with context_input_too_large from the review.
import {boundedCorrections,reviewInputLimit} from '../runtime/result-review.mjs';
test('the review keeps the newest user messages within its share and counts the rest, instead of throwing',()=>{
  const long=i=>'Historical project discussion '+i+' '+'reference details '.repeat(500);
  const model={id:'fixture',contextLength:64000,maxOutputTokens:4096},history=Array.from({length:12},(_,i)=>long(i));
  const {data,messages}=resultReviewInput({task:{id:'t',request:'Original user goal',criteria:[],messages:[]},evidence:[],receipts:{},candidate:'답',model,history});
  assert.ok(data.corrections.length>=1&&data.corrections.length<12);assert.equal(data.corrections.at(-1),long(11),'the newest earlier messages are kept');
  assert.equal(data.omittedCorrections,12-data.corrections.length);assert.ok(messages.length>0);
  const limit=reviewInputLimit(model);assert.deepEqual(boundedCorrections(['a','b'],limit),{kept:['a','b'],omitted:0});
  const cut=boundedCorrections(['x'.repeat(200000)],1000);assert.equal(cut.omitted,0);assert.match(cut.kept[0],/이후 생략/);assert.ok(cut.kept[0].length<4000);
});
