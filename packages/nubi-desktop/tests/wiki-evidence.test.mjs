import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,unlink,symlink} from 'node:fs/promises';
import path from 'node:path';
import {stringify} from 'yaml';
import {fixture} from './fixtures.mjs';
import {hash} from '../runtime/files.mjs';
import {SourceObservations} from '../runtime/source-edits.mjs';
import {rememberWikiEvidence,validateWikiEvidence} from '../runtime/wiki-evidence.mjs';
import {recordChangePlan} from '../runtime/change-plan.mjs';
import {RepositoryEvidenceResolver,retrieveWikiEvidence} from '../generated/openwiki.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);

async function claims(root,{resource='repo://app.txt',content='# Welcome\n\nWelcome uses app.txt.\n'}={}){
  const page='openwiki/home.md',sidecar='openwiki/.claims/home.json';
  await writeFile(path.join(root,page),content);await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});
  const evidence=await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource);
  const data={schemaVersion:1,pageVersion:hash(content),claims:[{id:'claim-1',statement:'Welcome uses app.txt.',evidence:[{resource,version:evidence.evidence.version}]}]};
  await writeFile(path.join(root,sidecar),JSON.stringify(data));return {data,page,sidecar};
}
const row=async(service,query='welcome')=>(await service.wikiQuery({query})).results.find(r=>r.path==='openwiki/home.md');
const planInput=evidenceIds=>({summary:'Update welcome',requirements:[{id:'R1',text:'Welcome change',criterionId:'AC-1',evidenceIds}],targets:[{path:'app.txt',reason:'Current implementation',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'inspection',description:'Compare saved text against the requested wording'}],assumptions:[]});

test('OpenWiki Claims resolve actual versions, source drift, missing source and changed document separately',async t=>{
  const {root,service}=await fixture(t);await claims(root);
  const matched=await row(service);assert.equal(matched.freshness,'source_matched');assert.equal(matched.sourceReferences[0].path,'app.txt');assert.equal(matched.provenance.hash,hash(await readFile(path.join(root,matched.path),'utf8')));
  await writeFile(path.join(root,'app.txt'),'changed source');assert.equal((await row(service)).freshness,'source_changed');
  await unlink(path.join(root,'app.txt'));assert.equal((await row(service)).freshness,'unavailable');
  await writeFile(path.join(root,'openwiki/home.md'),'# Welcome\n\nA human changed this documentation.\n');assert.equal((await row(service)).freshness,'document_changed');
});

test('range evidence survives relocation but is only a lookup hint, never an edit observation',async t=>{
  const {root,service}=await fixture(t);await claims(root,{resource:'repo://app.txt#L2-L3'});
  await writeFile(path.join(root,'app.txt'),'new prefix\n'+await readFile(path.join(root,'app.txt'),'utf8'));
  const result=await row(service);assert.equal(result.freshness,'source_matched');assert.equal(result.sourceReferences[0].start,undefined);
  const seen=new SourceObservations();rememberWikiEvidence(seen,[result]);assert.equal(seen.files.size,0);
  const task=await service.createTask({request:'Change welcome',criteria:['Changed wording']});await assert.rejects(recordChangePlan(service,task,planInput([result.evidenceId]),seen,'run'),/source_read_required/);
});

test('unversioned frontmatter stays unverified; excluded, malformed and unsafe evidence cannot become current',async t=>{
  const {root,service,directory}=await fixture(t);
  await writeFile(path.join(root,'openwiki/home.md'),'---\nsources:\n  - resource: repo://app.txt\n---\n# Welcome\n\nWelcome policy.\n');
  assert.equal((await row(service)).freshness,'unverified');assert.equal((await row(service)).sourceReferences[0].path,'app.txt');
  await writeFile(path.join(root,'.openwikiignore'),'app.txt\n');assert.equal((await row(service)).freshness,'unavailable');
  await writeFile(path.join(root,'.openwikiignore'),'openwiki/home.md\n');assert.equal((await service.wikiQuery({query:'welcome'})).results.length,0);
  await unlink(path.join(root,'.openwikiignore'));const {data,sidecar}=await claims(root);
  await writeFile(path.join(root,sidecar),'{bad');assert.equal((await row(service)).freshness,'unavailable');
  await writeFile(path.join(directory,'outside.txt'),'PRIVATE_SENTINEL');await symlink(path.join(directory,'outside.txt'),path.join(root,'escape.txt'));
  data.claims[0].evidence=[{resource:'repo://escape.txt',version:'x'},{resource:'repo://.env',version:'x'},{resource:'https://remote.invalid',version:'x'}];
  await writeFile(path.join(root,'.env'),'PRIVATE_SENTINEL');await writeFile(path.join(root,sidecar),JSON.stringify(data));
  const result=await row(service);assert.equal(result.freshness,'unavailable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SENTINEL/);
});

// Measured 2026-09-30 (S18) and 2026-10-12 (S29): an OpenWiki update also rewrites the files it manages beside the
// Wiki (its agent instructions and update workflow) and its Claims cite them. Desktop applies only openwiki/ (user
// decision 2026-09-29), so those citations never matched the workspace and a page stayed stale after every update.
test('a citation of a file OpenWiki manages beside the Wiki stays unverified instead of making the page stale',async t=>{
  const {root,service}=await fixture(t);const {stalePages}=await import('../runtime/wiki-evidence.mjs');
  const {data,sidecar}=await claims(root);
  data.claims[0].evidence=[{resource:'repo://.github/workflows/openwiki-update.yml#L1-L4',version:'repo-lines-v1:sha256:'+'0'.repeat(64)},{resource:'repo://AGENTS.md#L40-L48',version:'repo-lines-v1:sha256:'+'1'.repeat(64)}];
  await writeFile(path.join(root,sidecar),JSON.stringify(data));
  let result=await row(service);assert.equal(result.freshness,'unverified');
  assert.deepEqual(result.sourceReferences.map(r=>[r.state,r.reason]),[['unverified','managed_not_applied'],['unverified','managed_not_applied']]);
  assert.deepEqual(await stalePages(root),[]);
  // A managed file whose cited version the workspace holds is matched like any other source.
  await writeFile(path.join(root,'AGENTS.md'),'# Rules\n\nKeep app.txt.\n');
  const version=(await new RepositoryEvidenceResolver({rootDir:root}).resolve('repo://AGENTS.md#L1-L3')).evidence.version;
  data.claims[0].evidence=[{resource:'repo://AGENTS.md#L1-L3',version}];await writeFile(path.join(root,sidecar),JSON.stringify(data));
  result=await row(service);assert.equal(result.sourceReferences[0].state,'source_matched');assert.equal(result.freshness,'source_matched');
  // Any other missing file still makes the page stale.
  data.claims[0].evidence=[{resource:'repo://docs/missing.md#L1-L2',version:'repo-lines-v1:sha256:'+'2'.repeat(64)}];await writeFile(path.join(root,sidecar),JSON.stringify(data));
  assert.equal((await row(service)).freshness,'unavailable');assert.deepEqual((await stalePages(root)).map(p=>p.path),['openwiki/home.md']);
});

test('synthetic retrieval evaluation: declared aliases recover cross-vocabulary documents without unrelated matches',async t=>{
  const {root,service}=await fixture(t);await mkdir(path.join(root,'.nubi'));
  const docs=[{id:'openwiki/billing',title:'billing.md',raw:'# Billing\n\nInvoices follow NET30 payment terms.\n'},{id:'openwiki/discount',title:'discount.md',raw:'# Discount\n\nEligible accounts receive a five percent rebate.\n'},{id:'openwiki/login',title:'login.md',raw:'# Login\n\nAUTH_401 means the user needs to sign in again.\n'}];
  for(const doc of docs)await writeFile(path.join(root,doc.id+'.md'),doc.raw);
  const concepts=[['billing','청구',['대금','결제 조건']],['discount','할인',['거래처','우대율']]];
  await writeFile(path.join(root,'.nubi/knowledge.yaml'),stringify({version:1,entities:concepts.flatMap(([id,label,aliases])=>[{id:'concept:'+id,kind:'concept',label,aliases},{id:'wiki:'+id,kind:'wiki',label:id,path:'openwiki/'+id+'.md'}]),schemas:[],relations:concepts.map(([id])=>({from:'wiki:'+id,to:'concept:'+id,type:'documents'}))}));
  const cases=[['Invoices NET30','openwiki/billing.md'],['대금 정산','openwiki/billing.md'],['결제 조건은','openwiki/billing.md'],['거래처 우대율','openwiki/discount.md'],['Discount rebate','openwiki/discount.md'],['AUTH_401','openwiki/login.md']];
  const baselineDocs=[...docs,{id:'openwiki/home',title:'home.md',raw:await readFile(path.join(root,'openwiki/home.md'),'utf8')}];
  let baselineHits=0,enhancedHits=0;const results=[];
  for(const [query,expected] of cases){
    const baseline=retrieveWikiEvidence(baselineDocs,query).results,enhanced=(await service.wikiQuery({query})).results;
    const before=baseline.some(r=>r.provenance.path===expected),after=enhanced.some(r=>r.path===expected);baselineHits+=Number(before);enhancedHits+=Number(after);results.push({query,expected,baselineHit:before,enhancedHit:after});
    assert.ok(after,query);assert.equal(enhanced[0].path,expected);assert.ok(enhanced.reduce((n,r)=>n+r.excerpt.length,0)<=10000);
  }
  assert.equal(baselineHits,3);assert.equal(enhancedHits,6);
  assert.equal((await service.wikiQuery({query:'우주선 궤도'})).results.length,0);
  t.diagnostic(JSON.stringify({scope:'six synthetic retrieval cases plus one unrelated negative; not model accuracy',baselineHits,enhancedHits,results}));
});

test('latest generated revision is searched by default while authored documents and explicit history remain available',async t=>{
  const {root,service}=await fixture(t),dir='openwiki/nubi-evidence/task-one';await mkdir(path.join(root,dir),{recursive:true});
  const body=revision=>'---\nnubiEvidence:\n  taskId: task-one\n  revision: '+revision+'\n---\n# Revision policy\n\nRevision policy '+revision+'.\n';
  for(const n of [1,2])await writeFile(path.join(root,dir,'revision-'+n+'-example.md'),body(n));
  await writeFile(path.join(root,'openwiki/authored.md'),body(1));
  const current=await service.wikiQuery({query:'Revision policy'});assert.equal(current.retrieval.historyOmitted,1);assert.ok(current.results.some(r=>r.path.endsWith('revision-2-example.md')));assert.ok(current.results.some(r=>r.path.endsWith('authored.md')));assert.ok(current.results.every(r=>!r.path.endsWith('revision-1-example.md')));
  assert.ok((await service.wikiQuery({query:'Revision policy',includeHistory:true})).results.some(r=>r.path.endsWith('revision-1-example.md')));
});

test('plan citations require this run and revalidate documents, source files, claims and ignore rules',async t=>{
  const {root,service}=await fixture(t);const {sidecar,data}=await claims(root);
  const task=await service.createTask({request:'Change welcome',criteria:['Changed wording']}),seen=new SourceObservations(),result=await row(service);
  seen.observe(await service.read({path:'app.txt'}));await assert.rejects(recordChangePlan(service,task,planInput([result.evidenceId]),seen,'run'),/wiki_evidence_required/);
  rememberWikiEvidence(seen,[result]);const plan=await recordChangePlan(service,task,planInput([result.evidenceId]),seen,'run');assert.equal(plan.wikiEvidence[0].evidenceId,result.evidenceId);assert.equal(plan.checks[0].state,'not_run');
  const originalSource=await readFile(path.join(root,'app.txt'),'utf8');await writeFile(path.join(root,'app.txt'),originalSource+'changed');await assert.rejects(validateWikiEvidence(service,task.id,plan.wikiEvidence),/wiki_evidence_stale/);await writeFile(path.join(root,'app.txt'),originalSource);
  data.claims[0].statement='Changed statement';await writeFile(path.join(root,sidecar),JSON.stringify(data));await assert.rejects(validateWikiEvidence(service,task.id,plan.wikiEvidence),/wiki_evidence_stale/);
  await claims(root);await writeFile(path.join(root,'.openwikiignore'),'openwiki/home.md\n');await assert.rejects(validateWikiEvidence(service,task.id,plan.wikiEvidence),/wiki_evidence_stale/);await unlink(path.join(root,'.openwikiignore'));
  await writeFile(path.join(root,'openwiki/home.md'),'# Welcome\n\nDifferent human text.');await assert.rejects(validateWikiEvidence(service,task.id,plan.wikiEvidence),/wiki_evidence_stale/);
});

for(const drift of [false,true])test('Pi tool flow links Wiki to requirements and '+(drift?'blocks a proposal after Wiki drift':'produces a reviewable proposal'),async t=>{
  const {root,service}=await fixture(t);await claims(root);let round=0,evidenceId,sourceHash;
  const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
    const last=messages.findLast(m=>m.role==='tool');const result=last?JSON.parse(last.content):null;
    switch(round++){
      case 0:return call('wiki_query',{query:'welcome'});
      case 1:evidenceId=result.results[0].evidenceId;return call('read_source',{path:'app.txt'});
      case 2:sourceHash=result.hash;return call('record_change_plan',planInput([evidenceId]));
      case 3:assert.equal(result.wikiEvidence[0].evidenceId,evidenceId);if(drift)await writeFile(path.join(root,'openwiki/home.md'),'# Welcome\n\nChanged after plan.');return call('propose_patch',{path:'app.txt',expectedHash:sourceHash,edits:[{oldText:'second',newText:'updated'}],reason:'Requested wording'});
      default:if(drift)assert.equal(result.error,'wiki_evidence_stale');else assert.equal(result.state,'proposed');return {content:'근거를 확인했습니다. 실제 반영과 검증은 남아 있습니다.',calls:[]};
    }
  }};
  const task=await service.createTask({request:'Change welcome using Wiki',criteria:['Changed wording']});await service.startAgent({taskId:task.id});await service.agent.promise;
  assert.equal(service.task(task.id).state,'review');assert.equal(round,5);assert.equal(service.state().proposals.length,drift?0:1);assert.match(await readFile(path.join(root,'app.txt'),'utf8'),/second/);
});

test('retrieval excludes private catalogs and claims and reports bounded coverage without DB work',async t=>{
  const {root,service}=await fixture(t);await claims(root);await mkdir(path.join(root,'.nubi'));
  const catalog={version:1,entities:[{id:'concept:welcome',kind:'concept',label:'Landing experience',aliases:['환영화면']},{id:'wiki:welcome',kind:'wiki',label:'Guide',path:'openwiki/home.md'}],schemas:[{id:'unused',label:'Unread database',mode:'sqlite',path:'must-not-be-read.db',defaultSchema:'main'}],relations:[{from:'wiki:welcome',to:'concept:welcome',type:'documents'}]};
  await writeFile(path.join(root,'.nubi/knowledge.yaml'),stringify(catalog));
  const matched=await service.wikiQuery({query:'Explain the Landing experience'});assert.equal(matched.results[0].path,'openwiki/home.md');assert.equal(matched.retrieval.incomplete,false);
  await writeFile(path.join(root,'.openwikiignore'),'.nubi/knowledge.yaml\n');assert.equal((await service.wikiQuery({query:'환영화면'})).results.length,0);
  await writeFile(path.join(root,'.openwikiignore'),'openwiki/.claims/\n');assert.equal((await row(service)).freshness,'unavailable');
  await unlink(path.join(root,'.openwikiignore'));
  const content='---\nsources:\n'+Array.from({length:25},()=> '  - resource: repo://app.txt').join('\n')+'\n---\n# Welcome\n';await writeFile(path.join(root,'docs.md'),content);await writeFile(path.join(root,'openwiki/home.md'),content);await unlink(path.join(root,'openwiki/.claims/home.json'));
  const limited=await row(service);assert.equal(limited.freshness,'unverified');assert.equal(limited.grounding.incomplete,true);
});

test('Wiki records preserve requirement citations and notice later cited document drift',async t=>{
  const {root,service}=await fixture(t);await claims(root);const result=await row(service),seen=new SourceObservations();rememberWikiEvidence(seen,[result]);seen.observe(await service.read({path:'app.txt'}));
  const task=await service.createTask({request:'Change welcome',criteria:['Changed wording']});await recordChangePlan(service,task,planInput([result.evidenceId]),seen,'run');service.store.set('task:'+task.id,task);
  const record=await service.recordKnowledge({taskId:task.id});const content=await readFile(path.join(root,record.path),'utf8');assert.match(content,/## 계획에 사용한 Wiki/);assert.match(content,/openwiki\/home.md:1/);assert.match(content,/연결한 요구사항: Welcome change/);
  assert.equal((await service.knowledgeStatus({taskId:task.id})).state,'matching');await writeFile(path.join(root,'openwiki/home.md'),'# Welcome\nHuman update');assert.equal((await service.knowledgeStatus({taskId:task.id})).state,'outdated');
});
