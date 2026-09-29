import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchSourceCapture} from '../research-source-capture.js';
import {goalReviewMessages, reviewEvidence, samePageContentSource, isPageTextRecord} from '../goal-review.js';
import {contentPacket} from '../browser-content.js';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';
const tools = [{function:{name:'read_page',parameters:{properties:{mode:{enum:['screen','content']}}}}}];
const page = url => ({ok:true,observation:{url,frames:[{frame:0,text:'내용',documentId:url}]},navigationOnly:true});
const content = (url, text='검증한 원문',hash='a'.repeat(64)) => ({ok:true,dataKind:'page_content',url,frame:0,source_document_id:url,content_hash:hash,characters:text.length,ranges:[{start:0,end:text.length,markdown:text}],coverage:{partial:true},next_offset:null});
function setup(execute, options={}) {
 const evidence=[], events=[], sources=[];
 const capture=createResearchSourceCapture({enabled:true,tools,execute,signal:new AbortController().signal,onStep:e=>events.push(e),evidence,analyses:{observe:()=>`ev_${sources.length+1}`},onSource:(result,id)=>sources.push({result,id}),...options});
 return {capture,evidence,events,sources};
}
test('opened comparison sources become bounded reference packets with real worker IDs; repeated tab switches do not reread',async()=>{
 let reads=0;
 const state=setup(async()=>content(++reads===1?'https://example.test/a':'https://example.test/b'));
 const a=await state.capture('browser_snapshot',page('https://example.test/a'),true);
 const b=await state.capture('navigate_page',page('https://example.test/b'),true);
 await state.capture('switch_tab',page('https://example.test/a'),true);
 assert.equal(reads,2);assert.equal(state.evidence.length,2);
 assert(state.evidence.every(e=>e.referenceOnly&&e.usable));
 assert.equal(a.source_capture.analysis_evidence_id,'ev_1');assert.equal(b.source_capture.analysis_evidence_id,'ev_2');
 assert.equal(a.source_capture.reference.coverage.partial,true);assert.equal(state.sources.length,2);
 assert.equal(state.events.filter(e=>e.status==='done').length,2);
});
test('a single-source lookup retains the read search excerpt after an inaccessible original without launching analysts',async()=>{
 const search='https://example.test/search', pdf='https://example.test/rules.pdf';let reads=0;
 const state=setup(async()=>{reads++;return reads===1?content(search,'Source A: permitted scope differs from source B.'):{error:'page_read_unavailable'};},
   {enabled:false,preserveReadSources:true});
 const first=await state.capture('navigate_page',page(search),true);
 const failed=await state.capture('navigate_page',page(pdf),true);
 assert.equal(first.source_capture.status,'observed');assert.equal(failed.source_capture.status,'unavailable');
 assert.equal(state.sources.length,0,'Keeping a source does not launch a comparison');
 assert.equal(state.evidence.length,1);assert(state.evidence[0].referenceOnly&&state.evidence[0].usable);
 const payload=JSON.parse(goalReviewMessages({goal:'Explain the difference and disclose what was read',history:[],evidence:state.evidence,answer:'',inputBudget:12000}).messages[1].content);
 assert.deepEqual(payload.source_snapshot_evidence_ids,[1]);assert.equal(payload.evidence[0].result.url,search);
 assert.equal(payload.evidence[0].result.coverage.partial,true);
 await state.capture('navigate_page',page(search),true);assert.equal(reads,2,'No duplicate source read on return');
 await state.capture('navigate_page',page('https://example.test/uncertain'),false);assert.equal(reads,2,'Uncertain actions still block capture');
});
test('explicit content reads, writes/uncertainty, failures and unsupported hosts never trigger automatic source reads',async()=>{
 let reads=0;const state=setup(async()=>{reads++;});
 await state.capture('read_page',content('https://example.test/a'),true);
 await state.capture('switch_tab',page('https://example.test/a'),true);
 await state.capture('navigate_page',page('https://example.test/b'),false);
 await state.capture('fill_form',page('https://example.test/b'),true);
 await state.capture('click_element',{...page('https://example.test/b'),error:'browser_stale'},true);
 assert.equal(reads,0);
 const unsupported=setup(async()=>assert.fail('unsupported'),{tools:[]});await unsupported.capture('read_page',page('https://example.test/c'),true);
});
test('cross-document, empty and failed reads are not evidence, and cancellation stops capture',async()=>{
 for(const result of [content('https://example.test/other'),{...content('https://example.test/a'),source_document_id:'different-document'},{error:'page_permission'},{...content('https://example.test/a'),ranges:[]}]) {
  const state=setup(async()=>result);const value=await state.capture('navigate_page',page('https://example.test/a'),true);
  assert.equal(value.source_capture.status,'unavailable');assert.equal(state.evidence.length,0);assert.equal(state.sources.length,0);
 }
 const abort=new AbortController();const state=setup(async()=>{abort.abort();return content('https://example.test/a');},{signal:abort.signal});
 await assert.rejects(state.capture('read_page',page('https://example.test/a'),true),/cancelled/);
});
test('search queries have distinct opaque identities without exposing query values',async()=>{
 const source={url:'https://example.test/search',frame:0,title:'검색',text:'검색 결과 본문',method:'test',coverage:{partial:true}};
 const a=await contentPacket({...source,documentId:'doc-a',sourceIdentity:['doc-a','https://example.test/search?q=alpha']});
 const b=await contentPacket({...source,documentId:'doc-b',sourceIdentity:['doc-b','https://example.test/search?q=beta']});
 const refreshed=await contentPacket({...source,documentId:'doc-c',sourceIdentity:['doc-c','https://example.test/search?q=alpha']});
 assert.notEqual(a.source_key,b.source_key);assert.equal(a.source_key,refreshed.source_key);
 assert.equal(a.source_document_id,'doc-a');assert(!JSON.stringify(a).includes('alpha'));
 assert.equal(samePageContentSource(a,b),false);assert.equal(samePageContentSource(a,refreshed),true);
 assert.notEqual(a.content_hash,refreshed.content_hash);
 assert(!reviewEvidence(1,'read_page',{}, {...a,source_key:'not-a-hash'}).referenceOnly);
});
test('only a refreshed version of the same query supersedes its reference',async()=>{
 const url='https://example.test/search',keyA='1'.repeat(64),keyB='2'.repeat(64);
 const responses=[{...content(url),source_key:keyA,source_document_id:'doc-a'}, {...content(url),source_key:keyB,source_document_id:'doc-b'}, {...content(url,'새 원문','b'.repeat(64)),source_key:keyA,source_document_id:'doc-c'}];
 const state=setup(async()=>responses.shift());
 for(const documentId of ['doc-a','doc-b','doc-c']) await state.capture('navigate_page',{...page(url),observation:{url,frames:[{frame:0,documentId,text:'내용'}]}},true);
 assert.equal(state.evidence.length,3);assert.equal(state.evidence[0].superseded,true);
 assert.equal(state.evidence[1].usable,true);assert.equal(state.evidence[2].usable,true);
});
test('step review scope does not demand the final report; final still requires every user requirement',()=>{
 const params={goal:'경기를 찾아 세 출처를 비교해줘',history:[],evidence:[reviewEvidence(1,'read_page',{},content('https://example.test/a'))],answer:'',inputBudget:8000};
 const step=goalReviewMessages({...params,phase:'plan_step',stepOutcomes:[{text:'경기 식별',expected_outcome:'경기 이름과 시각 확인'}]});
 assert.deepEqual(JSON.parse(step.messages[1].content).evaluation_contract.outcomes,[{text:'경기 식별',expected_outcome:'경기 이름과 시각 확인'}]);
 assert.doesNotMatch(step.messages[0].content,/Complete requires ALL requirements met/);
 assert.match(step.messages[0].content,/WITHIN THE SPECIFIED EVALUATION SCOPE/);
 const final=goalReviewMessages(params);assert.match(final.messages[0].content,/FINAL TASK/);
 assert.match(final.messages[0].content,/every material requirement in the original user request/);
});
test('invalid delegation returns available frozen IDs and exact scope errors without launching any worker',async()=>{
 const c=createAnalysisCoordinator({signal:new AbortController().signal,tools:[],run:()=>assert.fail('worker must not launch'),complete:()=>assert.fail('model must not run')});
 try {
  const id=c.observe('read_page',{},content('https://example.test/a'));
  const r=await c.execute('delegate_analysis',{tasks:[{role:'research',task:'웹 페이지 대조',done_when:'원문 인용',evidence_ids:['missing']}]});
  assert.equal(r.error,'analysis_scope');assert(r.scope_issues.some(x=>x.reason==='unknown_evidence'));assert(r.scope_issues.some(x=>x.reason==='research_source_required'));
  assert.deepEqual(r.available_evidence,[{analysis_evidence_id:id,tool:'read_page',status:'observed'}]);assert.equal(c.status().length,0);
 }finally{c.dispose();}
});
test('same-document pages retain separate original references without enabling comparison workers', async()=>{
 const url='https://example.test/list', doc='one-document';let current=1, reads=0;
 const state=setup(async()=>({...content(url,`row-${current}`,String(current).repeat(64)),source_document_id:doc,page_view:{current,total:3}}),{enabled:false});
 const observe=()=>({ok:true,frames:[{frame:0,documentId:doc,page_view:{current,total:3},text:`row-${current}`}],url});
 for(current=1;current<=3;current++){const value=await state.capture('browser_snapshot',observe(),true);assert.equal(value.source_capture.status,'observed');reads++;}
 current=1;assert(!((await state.capture('browser_snapshot',observe(),true)).source_capture));
 assert.equal(state.evidence.length,3);assert.equal(state.sources.length,0);assert(state.evidence.every(item=>item.usable&&item.referenceOnly));
 const review=goalReviewMessages({goal:'Compare all three pages',history:[],evidence:state.evidence,answer:'',inputBudget:16000,phase:'plan_step',stepOutcomes:[{text:'Read pages',expected_outcome:'Observe facts from all three pages'}]});
 assert.deepEqual(JSON.parse(review.messages[1].content).source_snapshot_evidence_ids,state.evidence.map(item=>item.id));
 assert(review.messages[0].content.includes('Do not demand simultaneous live DOM from different pages'));
 const payload=JSON.parse(goalReviewMessages({goal:'합계',history:[],evidence:state.evidence,answer:'',inputBudget:12000}).messages[1].content);
 assert.deepEqual(payload.citeable_evidence_ids,[1,2,3]);
 assert.equal(samePageContentSource(state.evidence[0].result,state.evidence[1].result),false);
 assert.equal(samePageContentSource(state.evidence[0].result,{...state.evidence[0].result,content_hash:'f'.repeat(64)}),true);
});
test('page changes while capturing never attach a different view to the prior observation',async()=>{
 const url='https://example.test/list';const state=setup(async()=>({...content(url),page_view:{current:2,total:3}}));
 const result=await state.capture('browser_snapshot',{url,frames:[{frame:0,documentId:url,page_view:{current:1,total:3}}]},true);
 assert.equal(result.source_capture.status,'unavailable');assert.equal(state.evidence.length,0);
 assert(!reviewEvidence(1,'read_page',{}, {...content(url),page_view:{current:0,total:3}}).usable);
});

test('the fresh verification observation preserves a paginated source without an extra snapshot',async()=>{
 const url='https://example.test/list';
 const state=setup(async()=>({...content(url),page_view:{current:2,total:3}}),{enabled:false});
 const result={ok:true,verified:true,observation:{url,frames:[{frame:0,documentId:url,page_view:{current:2,total:3}}]}};
 assert.equal((await state.capture('verify_page',result,true)).source_capture.status,'observed');
 assert.equal(state.evidence.length,1);assert.equal(state.sources.length,0);
 await state.capture('verify_page',result,false);
 assert.equal(state.evidence.length,1);
});

test('the exact E08 citation request retains all opened originals after navigation without enabling comparison workers', async()=>{
 const original='펜싱 선수 오상욱의 종목과 소속을 찾아 알려줘. 동명이인이나 오래된 소속이면 구분하고 출처를 붙여 줘.';
 for(const goal of [original,original+'\n'+('출처마다 인물 식별 근거와 기사 날짜를 확인하고 확인되지 않은 내용은 미확인으로 표시해 주세요. '.repeat(45))]) {
 const sources=['https://example.test/kbs','https://example.test/yna','https://example.test/tjb'];
 const texts=['KBS 2026-09-26 오상욱 남자 사브르 대전광역시청','연합뉴스 2026-09-26 오상욱 남자 사브르 대전광역시청','TJB 2021 오상욱 성남시청에서 대전광역시청으로 이적'];
 const catalog=browserTools({},BUILTIN_SKILLS.find(skill=>skill.id==='browser-agent')).filter(tool=>tool.function.name!=='update_plan');
 const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 let round=0,current=-1,reviews=0,analystCalls=0;const executed=[],events=[];
 const result=await runAgent({goal,messages:[{role:'user',content:goal}],tools:catalog,harness:true,
  signal:new AbortController().signal,onStep:event=>events.push(event),
  completeAnalysis:async()=>{analystCalls++;throw new Error('unexpected_automatic_comparison');},
  complete:async()=>{assert(++round<=5);return round===1?call('select_tools',{groups:['navigation']}):round<=4?call('navigate_page',{url:sources[round-2]}):{content:'KBS와 연합뉴스의 2026년 보도와 TJB의 2021년 소속을 구분했습니다.'};},
  execute:async(name,args)=>{executed.push(name);if(name==='navigate_page'){current=sources.indexOf(args.url);return page(args.url);}if(name==='read_page')return content(sources[current],texts[current],String(current+1).repeat(64));throw new Error('unexpected_test_tool');},
  reviewGoal:async({evidence})=>{
   reviews++;const input=goalReviewMessages({goal,history:[],evidence,answer:'출처별 시점 구분',inputBudget:16000});
   const payload=JSON.parse(input.messages[1].content),refs=payload.evidence.filter(item=>item.referenceOnly);
   assert.deepEqual(refs.map(item=>item.result.url),sources);
   assert.deepEqual(refs.map(item=>item.result.ranges[0].markdown),texts);
   assert(refs.every(item=>item.usable&&item.result.coverage.partial));
   assert.deepEqual(payload.source_snapshot_evidence_ids,refs.map(item=>item.id));
   // A page that was left keeps its observed text as a record. Its controls are gone, so it cannot serve an action.
   assert(evidence.filter(item=>item.tool==='navigate_page').slice(0,-1).every(item=>item.superseded&&!item.usable||isPageTextRecord(item.result)&&!JSON.stringify(item.result).includes('"elements"')),'Old DOM must not become current action evidence');
   assert(!payload.evidence.filter(item=>isPageTextRecord(item.result)).some(item=>item.referenceOnly),'A record is not a source snapshot');
   return {status:'complete',checks:[{requirement:'출처별 사실',status:'met',evidence_ids:refs.map(item=>item.id)}],next_step:''};
  }});
 assert(result.content.includes('2026년'));assert.equal(reviews,1);
 assert.deepEqual(executed,['navigate_page','read_page','navigate_page','read_page','navigate_page','read_page']);
 assert(!events.some(event=>event.tool==='analysis_page'),'Preserving citations is not a request for comparison workers');
 assert.equal(analystCalls,0);
 }
});

test('source capture remains bounded to sixteen validated originals independent of request length',async()=>{
 let current=0,reads=0;
 const state=setup(async()=>{reads++;return content(`https://example.test/${current}`);},{enabled:false,preserveReadSources:true});
 for(current=0;current<17;current++)await state.capture('navigate_page',page(`https://example.test/${current}`),true);
 assert.equal(reads,16);assert.equal(state.evidence.length,16);
 assert(state.evidence.every(item=>item.referenceOnly&&item.usable&&item.result.source_document_id===item.result.url));
});

test('source retention does not add reads to a write, an uncertain write or a user wait',async()=>{
 for(const uncertain of [false,true]) {
  const goal='관찰한 입력란에 초안을 작성하고 확인해줘';
  const catalog=browserTools({},BUILTIN_SKILLS.find(skill=>skill.id==='browser-agent')).filter(tool=>tool.function.name!=='update_plan');
  const call=(name,args={})=>({calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  let round=0;const executed=[];
  const result=await runAgent({goal,messages:[{role:'user',content:goal}],tools:catalog,harness:true,signal:new AbortController().signal,
   complete:async()=>{
    assert(++round<=4);
    if(round===1)return call('select_tools',{groups:['input']});
    if(round===2)return call('fill_form',{fields:[{field_id:'f1',value:'초안'}]});
    if(round===3)return call('browser_snapshot');
    return call('ask_user',{question:'현재 입력 결과를 확인해 주세요',input_mode:'long_text'});
   },execute:async name=>{
    executed.push(name);
    if(name==='fill_form'){if(uncertain)throw new Error('lost receipt');return {ok:true,applied:1,actionIssued:true,observation:page('https://example.test/draft').observation};}
    if(name==='browser_snapshot')return page('https://example.test/draft');
    if(name==='ask_user')return {...page('https://example.test/draft'),requiresUserInput:true};
    throw new Error('unexpected_automatic_read');
   }});
  assert(result.awaitingUser);assert.deepEqual(executed,['fill_form','browser_snapshot','ask_user']);
 }
});

test('unknown or conflicting top-document identity cannot bind an automatic source, even at the same URL',async()=>{
 const url='https://example.test/same';
 for(const frames of [
  [{frame:0,text:'unknown document'}],
  [{frame:0,documentId:'',text:'empty identity'}],
  [{frame:0,documentId:17}],
  [{frame:0,documentId:url,unavailable:true},{frame:1,documentId:'child'}],
  [{frame:0,documentId:url},{frame:0,documentId:'duplicate'}],
 ]) {
  let reads=0;const state=setup(async()=>{reads++;return content(url);});
  await state.capture('browser_snapshot',{url,frames},true);
  assert.equal(reads,0);assert.equal(state.evidence.length,0);
  await state.capture('browser_snapshot',page(url),true);
  assert.equal(reads,1,'A later identified observation can still capture the source');
 }
 const state=setup(async()=>assert.fail('Conflicting top document must not be read'));
 await state.capture('browser_snapshot',{...page(url).observation,topDocumentId:'other-document'},true);
});

test('same-URL document replacement during content capture never becomes reference evidence',async()=>{
 const url='https://example.test/same';let current='replacement';
 const state=setup(async()=>({...content(url),source_document_id:current}));
 const observe=documentId=>({url,frames:[{frame:0,documentId}]});
 const stale=await state.capture('browser_snapshot',observe('original'),true);
 assert.equal(stale.source_capture.status,'unavailable');assert.equal(state.evidence.length,0);
 const fresh=await state.capture('browser_snapshot',observe(current),true);
 assert.equal(fresh.source_capture.status,'observed');assert.equal(state.evidence.length,1);
});

test('an explicit child-frame content read cannot mark the top-frame source as already captured',async()=>{
 const url='https://example.test/frame';let reads=0;
 const state=setup(async()=>{reads++;return content(url);});
 await state.capture('read_page',{...content(url),frame:1},true);
 await state.capture('browser_snapshot',page(url),true);
 assert.equal(reads,1);assert.equal(state.evidence.length,1);
});
test('a click that turns a counted list keeps that page before its check has passed, and nothing else does',async()=>{
 const url='https://example.test/list';
 const view=(current,extra={})=>({ok:true,actionIssued:true,observation:{url,frames:[{frame:0,text:`${current}쪽`,documentId:'doc',page_view:{current,total:3}}]},...extra});
 const read=current=>({...content(url,`${current}쪽 본문`,String(current).repeat(64)),source_document_id:'doc',page_view:{current,total:3}});
 let reads=0,current=1;
 const state=setup(async()=>{reads++;return read(current);},{enabled:false});
 // The first page is kept by an ordinary observation.
 await state.capture('browser_snapshot',{url,frames:[{frame:0,text:'1쪽',documentId:'doc',page_view:{current:1,total:3}}]},true);
 // Two clicks in a row: neither has a passed check yet.
 current=2;const second=await state.capture('click_element',view(2),false,true);
 current=3;const third=await state.capture('click_element',view(3),false,true);
 assert.equal(second.source_capture.status,'observed');assert.equal(third.source_capture.status,'observed');
 assert.equal(reads,3);assert.deepEqual(state.evidence.map(item=>item.result.page_view.current),[1,2,3]);
 assert(state.evidence.every(item=>item.referenceOnly&&item.usable&&!item.superseded));
 // Returning to a kept page reads nothing again.
 current=2;await state.capture('click_element',view(2),false,true);assert.equal(reads,3);
 // A later permitted observation reads the kept view once more: unchanged content keeps the same evidence,
 current=2;const again=await state.capture('verify_page',{ok:true,verified:true,observation:view(2).observation},true);
 assert.equal(reads,4);assert.equal(again.source_capture.review_evidence_id,second.source_capture.review_evidence_id);assert.equal(state.evidence.length,3);
 await state.capture('verify_page',{ok:true,verified:true,observation:view(2).observation},true);assert.equal(reads,4);
 // and content that finished loading after the click replaces what the click kept.
 const loaded={...content(url,'3쪽 전체 본문','f'.repeat(64)),source_document_id:'doc',page_view:{current:3,total:3}};
 const late=setup(async()=>late.next,{enabled:false});late.next=read(3);
 const early=await late.capture('click_element',view(3),false,true);late.next=loaded;
 const final=await late.capture('verify_page',{ok:true,verified:true,observation:view(3).observation},true);
 assert.notEqual(final.source_capture.review_evidence_id,early.source_capture.review_evidence_id);
 assert.deepEqual(late.evidence.map(item=>[item.usable,!!item.superseded]),[[false,true],[true,false]]);
 const other=setup(async()=>assert.fail('must not read'),{enabled:false});
 // No counted view, an unissued or failed click, an input, or an uncertain run: no capture.
 await other.capture('click_element',{ok:true,actionIssued:true,observation:{url,frames:[{frame:0,text:'본문',documentId:'doc'}]}},false,true);
 await other.capture('click_element',view(2,{actionIssued:false}),false,true);
 await other.capture('click_element',view(2,{error:'browser_stale'}),false,true);
 await other.capture('fill_form',view(2),false,true);
 await other.capture('select_option',view(2),false,true);
 await other.capture('click_element',view(2),false,false);
 assert.equal(other.evidence.length,0);
});
