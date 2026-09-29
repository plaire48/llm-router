import test from 'node:test';
import assert from 'node:assert/strict';
import {documentObservedPage,knowledgeURL,knowledgeState,autoRefreshPage,restoreKnowledge,learnPage,searchKnowledge,invalidatePage,exportKnowledge,KNOWLEDGE_TTL,wikiSource,wikiCreationMessages,parseWikiDraft,wikiOffer,observationHash,observationDrift,executeSiteWiki,siteWikiTools} from '../browser-knowledge.js';
import {skillCommand,skillCommandOptions,resolveSkillCommand} from '../skill-command.js';
const now=Date.now(), candidate={url:'https://portal.example/work?menu=FP',title:'FP 업무',provider:'aipro',verifiedAt:now,document:{headings:['FP 업무'],fields:[{name:'투입 시간',role:'spinbutton',required:true}]},markdown:'# 업무 기록\n투입 시간은 사용자에게 확인합니다.'};
test('wiki preserves verified routes, rejecting credentials and record query parameters instead of altering routes',()=>{
  assert.equal(knowledgeURL(candidate.url),candidate.url);
  for (const url of ['https://portal.example/work?token=abc','https://portal.example/work?id=person123','https://u:p@portal.example/a','https://portal.example/oauth/callback','https://portal.example/#/a?token=x','https://portal.example/work?menu=123456'])assert.equal(knowledgeURL(url),null,url);
  assert.equal(knowledgeURL('https://portal.example/#/work'),'https://portal.example/#/work');
});
test('page extraction records labels and required flags, never values, refs, raw DOM or passwords',()=>{
  const result=documentObservedPage({frames:[{headings:[{name:'업무'}],elements:[{name:'설명',role:'textbox',value:'PRIVATE',ref:'xyz',required:true},{name:'비밀번호',role:'textbox',type:'password'},{name:'제출',role:'button'}]}]});
  assert.deepEqual(result.fields,[{name:'설명',role:'textbox',required:true}]);assert.equal(result.controls[0],'제출');assert(!JSON.stringify(result).includes('PRIVATE'));assert(!JSON.stringify(result).includes('xyz'));
});
test('explicit saved wiki retrieval is origin/provider scoped, revoked by revision, and stale docs are retained but not retrieved',()=>{
  const state=learnPage(null,candidate,0,now);assert.equal(state.entries.length,1);
  const search=(state,origin='https://portal.example',provider='aipro',at=now)=>searchKnowledge(state,{origin,provider,query:'투입 시간 FP 업무'},at);
  assert.equal(search(state).length,1);assert.equal(search(state,'https://other.example').length,0);assert.equal(search(state,undefined,'fabrix').length,0);
  assert.equal(search(state,undefined,undefined,now+KNOWLEDGE_TTL+1).length,0);assert.equal(knowledgeState(state,now+KNOWLEDGE_TTL+1).entries.length,1);
  assert.equal(search(invalidatePage(state,candidate.url,'aipro',now)).length,0);
  assert.equal(learnPage({...state,entries:[],revision:1},candidate,0,now).entries.length,0);
  assert.equal(learnPage({...state,enabled:false},candidate,0,now).entries.length,1);
  assert(exportKnowledge(state,now).includes('# 업무 기록'));assert(exportKnowledge(state,now).includes(candidate.url));
});
test('wiki drafts remain grounded and resumable, strict model schema, isolated from executable skills',()=>{
  const offer=wikiOffer(candidate,2),chat={provider:'aipro',messages:[{id:'m',state:'done',wikiOffer:offer}]};
  const source=wikiSource(chat,'m');assert.equal(source.kind,'wiki');assert.equal(source.revision,2);
  assert(wikiCreationMessages(source)[0].content.includes('ask_user'));
  assert.deepEqual(parseWikiDraft('{"title":"FP 업무","markdown":"# 참고"}'),{title:'FP 업무',markdown:'# 참고'});
  for (const text of ['{}','{"title":"x","markdown":"x","script":"x"}','{"title":"x","markdown":"Bearer abc"}'])assert.throws(()=>parseWikiDraft(text));
  assert.throws(()=>wikiSource({...chat,provider:'fabrix'},'m'));
  assert.throws(()=>wikiSource({...chat,messages:[{...chat.messages[0],wikiOffer:{...offer,status:'dismissed'}}]},'m'));
  assert.equal(skillCommand({name:'wiki'}),'skill-wiki');assert.equal(skillCommandOptions([],'/wi')[0].command,'wiki');assert.equal(resolveSkillCommand([],'/wiki'),null);
});

test('source fingerprints detect observed structure changes while excerpts keep source metadata and bounded context',async()=>{
  const observation={frames:[{headings:[{name:'FP 업무'}],elements:[{name:'투입 시간',role:'spinbutton',required:true}]}]};
  const document=documentObservedPage(observation),sourceHash=await observationHash(document);
  const state=learnPage(null,{...candidate,document,sourceHash,markdown:('# 안내\n'+ '과거 이력 '.repeat(1200))+'\n## 투입 시간\n분을 입력하기 전에 단위를 확인합니다.'},0,now);
  assert.equal(await observationDrift(state,candidate.url,'aipro',observation),false);
  assert.equal(await observationDrift(state,candidate.url,'aipro',{frames:[{coverage:{domTruncated:false,queryFiltered:false},headings:[{name:'새 업무'}],elements:[]}]}),true);
  const results=searchKnowledge(state,{origin:'https://portal.example',provider:'aipro',query:'투입 시간'},now);
  assert(results[0].excerpts.every(item=>item.sourceHash===sourceHash && item.text.length<910));
  assert(results[0].markdown.length<6000);assert(results[0].markdown.includes('단위'));
});

test('always available wiki tools retrieve scoped sources and reject stale versions or unrelated sites',()=>{
 const state=learnPage(null,candidate,0,now),scope={origin:'https://portal.example',provider:'aipro'};
 const search=executeSiteWiki(state,scope,'search_site_wiki',{query:'투입 시간'},now);assert(search.entries.length);assert.equal(search.metadata_only,true);
 const args={url:candidate.url,version:1};
 const read=executeSiteWiki(state,scope,'read_site_wiki',args,now);assert(read.content.includes('사용자'));assert.equal(read.sourceKind,'browser-observation');
 assert.equal(executeSiteWiki(state,scope,'read_site_wiki',{...args,version:2},now).error,'wiki_changed');
 assert.equal(executeSiteWiki(state,{...scope,origin:'https://other.example'},'read_site_wiki',args,now).error,'wiki_not_found');
 assert.equal(executeSiteWiki(state,scope,'read_site_wiki',args,now+KNOWLEDGE_TTL+1).error,'wiki_stale');
 assert.equal(executeSiteWiki({...state,enabled:false},scope,'search_site_wiki',{query:'투입 시간'},now).error,'wiki_disabled');
 assert.throws(()=>executeSiteWiki(state,scope,'read_site_wiki',{...args,query:'time',start:1},now));
 assert.deepEqual(siteWikiTools().map(t=>t.function.name),['search_site_wiki','read_site_wiki']);
});

test('partial observations and ordering changes do not invalidate reviewed knowledge',async()=>{
  const frame={coverage:{domTruncated:false,queryFiltered:false},headings:[{name:'FP 업무'},{name:'작성 안내'}],elements:[{name:'시간',role:'spinbutton',required:true},{name:'설명',role:'textbox',required:false}]};
  const observed={frames:[frame]},document=documentObservedPage(observed);
  const state=learnPage(null,{...candidate,document,sourceHash:await observationHash(document)},0,now);
  for(const observation of [
    {frames:[{...frame,headings:[...frame.headings].reverse(),elements:[...frame.elements].reverse()}]},
    {frames:[{...frame,headings:[frame.headings[0]],elements:[frame.elements[0]],truncated:true}]},
    {frames:[{headings:[],elements:[],unavailable:true}]},
    {frames:[{...frame,elements:[{name:'시간',role:'spinbutton'}]}]},
    {frames:[{...frame,elements:[{...frame.elements[0],required:false},{...frame.elements[0]}]}]},
    {frames:[{...frame,headings:[{name:'일부 영역'}],coverage:{domTruncated:true}}]},
    {frames:[{...frame,headings:[{name:'검색 결과'}],coverage:{queryFiltered:true}}]},
  ]) assert.equal(await observationDrift(state,candidate.url,'aipro',observation),false,JSON.stringify(observation));
  assert.equal(await observationDrift(state,candidate.url,'aipro',{frames:[{...frame,elements:[{...frame.elements[0],required:false}]}]}),true);
  assert.equal(await observationDrift(state,candidate.url,'aipro',{frames:[{...frame,headings:[{name:'다른 업무'}]}]}),true);
});


test('automatic observation updates require opt-in, verified completion and an unchanged source version',async()=>{
 const state=learnPage(null,candidate,0,now),sourceHash=await observationHash(candidate.document);
 const observed={...candidate,verifiedAt:now+1000,sourceHash},guard={revision:0,expectedVersion:1,completed:true};
 const enabled={...state,autoUpdate:true};
 for(const [input,policy] of [[state,guard],[enabled,{...guard,completed:false}],[enabled,{...guard,revision:1}],[enabled,{...guard,expectedVersion:2}],[{...enabled,enabled:false},guard],[{...enabled,entries:[]},guard]]) {
   assert.deepEqual(autoRefreshPage(input,observed,policy,now+1000),knowledgeState(input,now+1000));
 }
 const updated=autoRefreshPage(enabled,observed,guard,now+1000);
 assert.equal(updated.entries[0].documentVersion,2);assert.equal(updated.entries[0].markdown,candidate.markdown);
 assert.equal(updated.entries[0].reviewedAt,now);assert.equal(updated.entries[0].verifiedAt,now+1000);
 assert.equal(updated.entries[0].markdownNeedsReview,false);
 assert.equal(updated.entries[0].previousObservation.documentVersion,1);
 assert.equal(knowledgeState(updated,now+2000).autoUpdate,true);
});

test('auto refresh preserves authored rules, excludes stale prose, serves new observations and restores one prior version',async()=>{
 const before=learnPage(null,candidate,0,now),document={...candidate.document,fields:[{name:'투입 시간',role:'spinbutton',required:false},{name:'메모',role:'textbox',required:false}]};
 const observed={...candidate,document,markdown:'UNTRUSTED REPLACEMENT',verifiedAt:now+1000,sourceHash:await observationHash(document)};
 const updated=autoRefreshPage({...before,autoUpdate:true},observed,{revision:0,expectedVersion:1,completed:true},now+1000),entry=updated.entries[0];
 assert.equal(entry.markdown,candidate.markdown);assert.equal(entry.markdownNeedsReview,true);
 const scope={origin:'https://portal.example',provider:'aipro'};
 const results=searchKnowledge(updated,{...scope,query:'메모 투입 시간'},now+1000);
 assert.equal(results.length,1);assert.equal(results[0].markdown,'');assert(!JSON.stringify(results).includes('사용자에게'));assert(!JSON.stringify(results).includes('previousObservation'));
 const read=executeSiteWiki(updated,scope,'read_site_wiki',{url:candidate.url,version:2},now+1000);
 assert(read.content.includes('메모'));assert(!read.content.includes('사용자에게'));assert.equal(read.markdownNeedsReview,true);
 const restored=restoreKnowledge(updated,{url:candidate.url,provider:'aipro',version:2},now+1000);
 assert.equal(restored.entries[0].documentVersion,3);assert.equal(restored.entries[0].markdownNeedsReview,false);assert.deepEqual(restored.entries[0].document,before.entries[0].document);assert.equal(restored.revision,1);
 assert.throws(()=>restoreKnowledge(updated,{url:candidate.url,provider:'aipro',version:1},now+1000));
 const again=autoRefreshPage(updated,{...observed,verifiedAt:now+2000},{revision:0,expectedVersion:2,completed:true},now+2000);
 assert(!again.entries[0].previousObservation.previousObservation);
 const old=autoRefreshPage({...before,autoUpdate:true},{...observed,document:candidate.document,verifiedAt:now+KNOWLEDGE_TTL+1},{revision:0,expectedVersion:1,completed:true},now+KNOWLEDGE_TTL+1);
 assert.equal(searchKnowledge(old,{...scope,query:'투입 시간'},now+KNOWLEDGE_TTL+1)[0].markdown,'');
});
