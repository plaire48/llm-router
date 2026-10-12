import test from 'node:test';
import assert from 'node:assert/strict';
import {taskCapabilities} from '../runtime/agent-capabilities.mjs';
import {workIntent} from '../runtime/work-plan.mjs';
import {MailSearch} from '../runtime/mail-search.mjs';
import {wikiAnswer} from '../runtime/wiki-evidence.mjs';
import {resultReviewInput} from '../runtime/result-review.mjs';
import {fixture,fixturePlan} from './fixtures.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

test('Personal mail is a valid planning workflow with only the available mail tools',()=>{
 const capabilities=taskCapabilities({skills:[],issues:[]},{request:'메일에서 일정 찾아줘'},['personal_mail_query','read_personal_mail']);
 const mail=capabilities.workflows.find(item=>item.id==='mail');
 assert(mail);assert.deepEqual(mail.tools,['personal_mail_query','read_personal_mail']);
 assert.equal(workIntent({goal:'일정 확인',constraints:[],outcomes:['메일 원문 일정'],workflowIds:['mail'],skillPaths:[]},capabilities).workflowIds[0],'mail');
});

function mailSearch({unavailable=[],truncated=false}={}){
 const store=new Map();
 return new MailSearch({store:{get:key=>store.get(key),set:(key,value)=>store.set(key,value)},rows:()=>['a','b'].map(id=>({id,state:'saved',sourceHash:id})),searchSignature:async row=>row.id,readKnowledge:async()=>({text:''}),read:async id=>{
  if(unavailable.includes(id))throw Error('mail_source_changed');
  return {mail:{subject:'일정',text:'회의 일정',from:'a@example.test',attachments:[],truncated}};
 }});
}
test('unreadable mail is a retrieval gap, not an exhaustive empty result',async()=>{
 const result=await mailSearch({unavailable:['a','b']}).search({query:'일정'});
 assert.equal(result.total,0);assert.equal(result.retrieval.incomplete,true);
 assert.equal(result.retrieval.scope,'collected_personal_mail');
 assert(result.retrieval.reasons.includes('source_unavailable'));
});
test('mail paging and truncated bodies retain separate coverage limits',async()=>{
 const result=await mailSearch({truncated:true}).search({query:'일정',limit:1});
 assert.equal(result.retrieval.incomplete,true);assert(result.retrieval.reasons.includes('body_truncated'));
 assert.equal(result.retrieval.hasMore,true);assert(result.nextCursor);
 const complete=await mailSearch().search({query:'일정',limit:1});
 assert.equal(complete.retrieval.incomplete,false);assert.equal(complete.retrieval.hasMore,true);
});
test('OpenWiki results whose excerpts no longer match current pages are not usable review evidence',()=>{
 const result={dataKind:'openwiki_reference',status:'complete',findings:[{text:'old fact',citations:['e1']}],evidence:[{id:'e1',path:'openwiki/home.md',start:0,end:8,excerpt:'old fact'}]};
 const {delivered,entries}=wikiAnswer(result,{grounded:[]});
 assert.deepEqual(delivered.desktop.grounding.unmatched,['e1']);
 const packet=resultReviewInput({task:{request:'현재 규칙',criteria:[]},evidence:entries,receipts:{},candidate:'old fact',model:{contextLength:32000}});
 assert.equal(packet.data.evidence.find(item=>item.tool==='openwiki_excerpt').usable,false);
 assert.deepEqual(result.evidence[0].excerpt,'old fact','upstream answer is preserved');
});
test('matching Wiki pages retain freshness and source references beside their original findings',()=>{
 const result={dataKind:'openwiki_reference',status:'complete',findings:[{text:'rule',citations:['e1']}],evidence:[{id:'e1',path:'openwiki/home.md',start:0,end:4,excerpt:'rule'}]};
 const grounded=[{openwikiId:'e1',freshness:'source_changed',sourceReferences:[{path:'app.txt',state:'source_changed'}]}];
 const {delivered,entries}=wikiAnswer(result,{grounded});
 assert.equal(delivered.desktop.grounding.matched[0].freshness,'source_changed');
 assert.equal(entries[0].result.currentPageMatched,true);
 assert.equal(entries[0].result.freshness,'source_changed');
});

test('the real planning boundary receives the active mail scope and pending tools before a query executes',async t=>{
 const {service}=await fixture(t,{scriptedPlanning:true});let planned=false,queried=false;
 service.mail=async args=>{assert(planned);assert.equal(args.query,'일정');queried=true;return {scope:'personal-mail',results:[],total:0,retrieval:{incomplete:false,scope:'collected_personal_mail'}};};
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
  if(messages[0].content.startsWith(WORK_PLAN_PROMPT)){
   const data=JSON.parse(messages[1].content);
   assert.equal(data.routing.searchScope,'mail');assert.deepEqual(data.routing.proposedTools,['personal_mail_query']);
   assert(data.capabilities.workflows.some(item=>item.id==='mail'));
   planned=true;return fixturePlan(messages);
  }
  return queried?{content:'수집된 메일에서 일정을 찾지 못했습니다.',calls:[]}:{content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'personal_mail_query',arguments:JSON.stringify({query:'일정'})}}]};
 }};
 const task=await service.createTask({request:'/mail 일정 찾아줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
 assert(planned&&queried);assert.equal(service.task(task.id).error,null);
 assert(!service.store.list('operation:').some(row=>['read_source','ask_openwiki','propose_setup_action'].includes(row.tool)));
});
