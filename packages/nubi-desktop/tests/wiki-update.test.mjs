// User decision 2026-09-29: Desktop finds a Wiki that its sources left behind,
// proposes an OpenWiki update and runs it only on approval. The update runs in
// a temporary copy of the workspace; its pages reach the workspace only on a
// second approval, and only under openwiki/. OpenWiki's code is not changed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {git,hash} from '../runtime/files.mjs';
import {RepositoryEvidenceResolver} from '../generated/openwiki.mjs';
import {wikiUpdateStatus,defaultWikiUpdater,CALL_LIMIT,TEXT_REPLY} from '../runtime/wiki-update.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);

const exists=file=>access(file).then(()=>true,()=>false);
// A repository whose Wiki OpenWiki generated at the current commit: a page with a Claim on app.txt.
async function generated(t){
  const {service,root}=await fixture(t);
  const content='# Welcome\n\nWelcome uses app.txt.\n';
  await writeFile(path.join(root,'openwiki','home.md'),content);await mkdir(path.join(root,'openwiki','.claims'),{recursive:true});
  const resource='repo://app.txt',evidence=await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource);
  await writeFile(path.join(root,'openwiki','.claims','home.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(content),claims:[{id:'claim-1',statement:'Welcome uses app.txt.',evidence:[{resource,version:evidence.evidence.version}]}]}));
  await git(root,['add','-A']);await git(root,['commit','-qm','wiki']);
  const head=(await git(root,['rev-parse','HEAD'])).trim();
  await writeFile(path.join(root,'openwiki','.last-update.json'),JSON.stringify({updatedAt:'2026-09-29T00:00:00.000Z',command:'update',gitHead:head,status:'complete',language:'ko'}));
  await git(root,['add','-A']);await git(root,['commit','-qm','wiki record']);
  return {service,root};
}
const commit=async(root,file,content)=>{await writeFile(path.join(root,file),content);await git(root,['add','-A']);await git(root,['commit','-qm','change '+file]);};

test('an existing Wiki without a generation record can recover through an approved update, and a current one is current',async t=>{
  const plain=await fixture(t);
  assert.equal((await wikiUpdateStatus(plain.root)).state,'stale');
  assert.equal((await wikiUpdateStatus(plain.root)).reason,'no_generation_record');
  assert.equal((await plain.service.wikiUpdate({method:'propose'})).state,'proposed');
  const {root}=await generated(t);
  const status=await wikiUpdateStatus(root);
  assert.equal(status.state,'current',JSON.stringify(status));assert.deepEqual(status.changedFiles,[]);assert.deepEqual(status.stalePages,[]);
});

test('a committed source change after the last update makes the Wiki stale and names the page whose evidence changed',async t=>{
  const {root}=await generated(t);
  await commit(root,'app.txt','changed source\n');
  await writeFile(path.join(root,'notes.txt'),'not committed');
  const status=await wikiUpdateStatus(root);
  assert.equal(status.state,'stale');
  assert.deepEqual(status.changedFiles,['app.txt'],'what changed since the last update, without the Wiki itself');
  assert.deepEqual(status.stalePages,[{path:'openwiki/home.md',freshness:'source_changed'}]);
  assert.deepEqual(status.uncommitted,['notes.txt'],'uncommitted changes are named; without a checkpoint of the last run they only count through Claims');
  assert.equal(status.lastUpdate.status,'complete');
});

test('a change to a file OpenWiki ignores does not make the Wiki stale, as OpenWiki decides',async t=>{
  const {root}=await generated(t);
  await writeFile(path.join(root,'.openwikiignore'),'drafts/\n');await git(root,['add','-A']);await git(root,['commit','-qm','ignore drafts']);
  const record=JSON.parse(await readFile(path.join(root,'openwiki','.last-update.json'),'utf8'));
  await commit(root,'openwiki/.last-update.json',JSON.stringify({...record,gitHead:(await git(root,['rev-parse','HEAD'])).trim()}));
  await mkdir(path.join(root,'drafts'));await commit(root,'drafts/idea.txt','draft\n');
  await writeFile(path.join(root,'drafts','later.txt'),'not committed');
  const status=await wikiUpdateStatus(root);
  assert.equal(status.state,'current',JSON.stringify(status));assert.deepEqual(status.uncommitted,[]);
  await commit(root,'app.txt','changed source\n');
  assert.deepEqual((await wikiUpdateStatus(root)).changedFiles,['app.txt']);
});

test('an interrupted update is stale',async t=>{
  const {root}=await generated(t);
  const record=JSON.parse(await readFile(path.join(root,'openwiki','.last-update.json'),'utf8'));
  await writeFile(path.join(root,'openwiki','.last-update.json'),JSON.stringify({...record,status:'interrupted'}));
  const status=await wikiUpdateStatus(root);
  assert.equal(status.state,'stale');assert.equal(status.reason,'interrupted');
});

// A runner that changes a page and a file outside the Wiki, as OpenWiki updates AGENTS.md.
const writer=({block}={})=>async({root,signal,onEvent})=>{
  onEvent?.({type:'plan',pages:1});
  if(block)await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});
  await writeFile(path.join(root,'openwiki','home.md'),'# Welcome\n\nWelcome uses the changed app.txt.\n');
  await writeFile(path.join(root,'openwiki','new-page.md'),'# New\n');
  await writeFile(path.join(root,'AGENTS.md'),'managed snippet\n');
  onEvent?.({type:'page',path:'openwiki/home.md'});
  return {skipped:false};
};
const settle=async(service,id)=>{for(let i=0;i<200;i++){const item=(await service.wikiUpdate({method:'status'})).updates.find(update=>update.id===id);if(!['running','proposed'].includes(item.state))return item;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('not settled');};

test('a proposal runs nothing; an approved run changes only a copy; an approved result reaches only openwiki/',async t=>{
  const {service,root}=await generated(t);service.wikiUpdater=writer();
  const before=await readFile(path.join(root,'openwiki','home.md'),'utf8');
  await assert.rejects(service.wikiUpdate({method:'propose'}),/wiki_update_not_needed/);
  await commit(root,'app.txt','changed source\n');
  const proposal=await service.wikiUpdate({method:'propose'});
  assert.equal(proposal.state,'proposed');assert.deepEqual(proposal.status.stalePages.map(page=>page.path),['openwiki/home.md']);
  assert.equal(await readFile(path.join(root,'openwiki','home.md'),'utf8'),before,'a proposal writes nothing');
  await assert.rejects(service.wikiUpdate({method:'run',id:proposal.id,fingerprint:'0'.repeat(64)}),/wiki_update_changed/);
  await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const ready=await settle(service,proposal.id);
  assert.equal(ready.state,'ready',ready.error);
  assert.deepEqual(ready.changes.filter(change=>change.path.endsWith('.md')),[{path:'openwiki/home.md',change:'modified'},{path:'openwiki/new-page.md',change:'added'}]);
  assert.ok(ready.changes.some(change=>change.path==='openwiki/.nubi-sources.json'&&change.change==='added'),'the checkpoint names the sources the run read (2026-10-12)');
  assert.deepEqual(ready.outside,['AGENTS.md'],'changes outside the Wiki are shown and left out');
  assert.equal(await readFile(path.join(root,'openwiki','home.md'),'utf8'),before,'the workspace is unchanged until the result is approved');
  assert.ok(ready.events.some(event=>event.type==='page'));
  assert.deepEqual(ready.result,{skipped:false},'what the runner reported');
  await service.wikiUpdate({method:'apply',id:proposal.id,fingerprint:ready.fingerprint});
  const applied=(await service.wikiUpdate({method:'status'})).updates.find(update=>update.id===proposal.id);
  assert.equal(applied.state,'applied');
  assert.match(await readFile(path.join(root,'openwiki','home.md'),'utf8'),/changed app\.txt/);
  assert.ok(await exists(path.join(root,'openwiki','new-page.md')));
  assert.equal(await exists(path.join(root,'AGENTS.md')),false,'nothing outside the Wiki was written');
  assert.equal(await exists(ready.copy),false,'the copy is removed');
  assert.equal((await git(root,['worktree','list'])).trim().split('\n').length,1);
});

// Measured 2026-09-29 with gpt-5.6-sol: after an applied update one page was
// unavailable. OpenWiki also writes its part of AGENTS.md, which is not applied,
// and a Claim can cite lines that only the copy holds.
test('a result whose Claims cite a file that is not applied names those pages before it is applied',async t=>{
  const {service,root}=await generated(t);
  service.wikiUpdater=async({root:copy})=>{
    await writeFile(path.join(copy,'AGENTS.md'),'managed snippet\n');
    const cite=async resource=>({resource,version:(await new RepositoryEvidenceResolver({rootDir:copy}).resolve(resource)).evidence.version});
    const content='# Welcome\n\nWelcome uses the changed app.txt and follows AGENTS.md.\n';
    await writeFile(path.join(copy,'openwiki','home.md'),content);
    await writeFile(path.join(copy,'openwiki','.claims','home.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(content),claims:[{id:'claim-1',statement:'Welcome uses app.txt.',evidence:[await cite('repo://app.txt')]},{id:'claim-2',statement:'Follows AGENTS.md.',evidence:[await cite('repo://AGENTS.md#L1-L1')]}]}));
    return {skipped:false};
  };
  await commit(root,'app.txt','changed source\n');
  const proposal=await service.wikiUpdate({method:'propose'});
  await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const ready=await settle(service,proposal.id);
  assert.equal(ready.state,'ready',ready.error);assert.deepEqual(ready.outside,['AGENTS.md']);
  assert.deepEqual(ready.outsideEvidence,[{page:'openwiki/home.md',path:'AGENTS.md'}],'the Claim on app.txt holds in the workspace and is not named');
});

test('a page changed in the workspace during the run is not overwritten',async t=>{
  const {service,root}=await generated(t);service.wikiUpdater=writer();
  await commit(root,'app.txt','changed source\n');
  const proposal=await service.wikiUpdate({method:'propose'});
  await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  const ready=await settle(service,proposal.id);
  await writeFile(path.join(root,'openwiki','home.md'),'# Edited by hand\n');
  await assert.rejects(service.wikiUpdate({method:'apply',id:proposal.id,fingerprint:ready.fingerprint}),/wiki_update_conflict/);
  assert.equal(await readFile(path.join(root,'openwiki','home.md'),'utf8'),'# Edited by hand\n');
  assert.equal(await exists(path.join(root,'openwiki','new-page.md')),false,'no file of the result was written');
  await service.wikiUpdate({method:'discard',id:proposal.id});
  assert.equal((await service.wikiUpdate({method:'status'})).updates.find(update=>update.id===proposal.id).state,'discarded');
  assert.equal(await exists(ready.copy),false);
});

test('a stopped run and a failed run leave the workspace as it was',async t=>{
  const {service,root}=await generated(t);
  await commit(root,'app.txt','changed source\n');
  service.wikiUpdater=writer({block:true});
  const stopped=await service.wikiUpdate({method:'propose'});
  await service.wikiUpdate({method:'run',id:stopped.id,fingerprint:stopped.fingerprint});
  await service.wikiUpdate({method:'cancel',id:stopped.id});
  const cancelled=await settle(service,stopped.id);
  assert.equal(cancelled.state,'cancelled');assert.equal(await exists(cancelled.copy),false);
  service.wikiUpdater=async()=>{throw new Error('model_unavailable');};
  const failing=await service.wikiUpdate({method:'propose'});
  await service.wikiUpdate({method:'run',id:failing.id,fingerprint:failing.fingerprint});
  const failed=await settle(service,failing.id);
  assert.equal(failed.state,'failed');assert.equal(failed.error,'model_unavailable');assert.equal(await exists(failed.copy),false);
  assert.equal(await readFile(path.join(root,'openwiki','home.md'),'utf8'),'# Welcome\n\nWelcome uses app.txt.\n');
  assert.equal((await git(root,['worktree','list'])).trim().split('\n').length,1);
});

test('one update runs at a time and the service exposes the method',async t=>{
  const {service,root}=await generated(t);service.wikiUpdater=writer({block:true});
  await commit(root,'app.txt','changed source\n');
  const first=await service.wikiUpdate({method:'propose'});
  await service.wikiUpdate({method:'run',id:first.id,fingerprint:first.fingerprint});
  const second=await service.wikiUpdate({method:'propose'});
  await assert.rejects(service.wikiUpdate({method:'run',id:second.id,fingerprint:second.fingerprint}),/wiki_update_busy/);
  await service.wikiUpdate({method:'cancel',id:first.id});await settle(service,first.id);
  const listed=await service.invoke('wikiUpdate',{method:'status'});
  assert.equal(listed.status.state,'stale');assert.ok(listed.updates.length>=2);
});

test('the default runner is the OpenWiki update runner, with the model the user logged in to Desktop',async t=>{
  const {service,root}=await generated(t);const calls=[],seen={};
  const requests=[];
  service.providers={status:()=>({connected:true,model:'fixture-model',models:[{id:'fixture-model',contextLength:200000}]}),dispose(){},async complete(messages,tools){calls.push(tools.map(item=>item.function.name));requests.push(messages);return {content:'done',calls:[]};}};
  // A stand-in for the bundled runner: it asks the model once and reports progress, as the real one does.
  const order=[];
  const load=async()=>({NubiOpenWikiModel:(await import('../generated/openwiki.mjs')).NubiOpenWikiModel,async syncBundledSkills(){order.push('skills');},async runNativeRepositoryGeneration(options){
    order.push('run');
    Object.assign(seen,{root:options.root,mode:options.mode,language:options.language,modelId:options.modelId});
    await options.model.invoke('plan the update');
    options.onEvent({type:'repository_progress',stage:'generating',page:'openwiki/home.md',pageIndex:1,pageCount:1});
    options.onEvent({type:'text',text:'page text that must not leave the run'});
    return {skipped:false};
  }});
  const events=[],controller=new AbortController();
  const result=await defaultWikiUpdater(service,{load})({root,language:'ko',signal:controller.signal,onEvent:event=>events.push(event),updateId:'u1'});
  assert.equal(result.skipped,false);
  assert.deepEqual(seen,{root,mode:'update',language:'ko',modelId:'fixture-model'});
  assert.deepEqual(order,['skills','run'],'the bundled skills are installed first, as openwiki --update does');
  assert.equal(calls.length,1,'the model call went through the Desktop transport');
  assert.ok(requests[0].some(message=>message.role==='system'&&message.content===CALL_LIMIT.content),'the request states the limit of 8 tool calls');
  assert.deepEqual(events,[{type:'progress',stage:'generating',page:'openwiki/home.md',index:1,total:1}],'only progress facts, no page text');
  const {readRunMetrics}=await import('../runtime/run-metrics.mjs'),{summary}=readRunMetrics(service.store,{taskId:'wiki-update:u1'});
  assert.equal(summary.byPurpose.wiki_update.calls,1,'model calls are counted under wiki_update');
  service.providers={status:()=>({connected:false}),dispose(){}};
  await assert.rejects(defaultWikiUpdater(service,{load})({root,signal:controller.signal,onEvent(){},updateId:'u2'}),/model_unavailable/);
});

// Measured 2026-09-29 with gpt-5.6-sol: OpenWiki's planner asked for more than 8
// parallel reads, and after submit_plan it returned an empty response. The model
// connection rejects both (response_invalid).
test('a response rejected by the model connection is asked for again, with a request for a short reply',async t=>{
  const {service,root}=await generated(t);let attempts=0;const sent=[];
  service.providers={status:()=>({connected:true,model:'fixture-model',models:[{id:'fixture-model',contextLength:200000}]}),dispose(){},async complete(messages){sent.push(messages);if(++attempts===1)throw new Error('response_invalid');return {content:'done',calls:[]};}};
  const load=async()=>({NubiOpenWikiModel:(await import('../generated/openwiki.mjs')).NubiOpenWikiModel,async runNativeRepositoryGeneration(options){await options.model.invoke('plan the update');return {skipped:false};}});
  const result=await defaultWikiUpdater(service,{load})({root,signal:new AbortController().signal,onEvent(){},updateId:'u3'});
  assert.equal(result.skipped,false);assert.equal(attempts,2);
  assert.notEqual(sent[0].at(-1).content,TEXT_REPLY.content,'the first request is as the runner made it');
  assert.deepEqual(sent[1].at(-1),TEXT_REPLY,'the second asks for a short reply when no tool call is needed');
  // Measured 2026-10-12 (S29 diagnosis): three rejections in a row ended a five-minute generation. The request is
  // asked up to three more times; the fourth rejection ends the run.
  let rejected=0;service.providers.complete=async()=>{rejected++;if(rejected<=3)throw new Error('response_invalid');return {content:'done',calls:[]};};
  assert.equal((await defaultWikiUpdater(service,{load})({root,signal:new AbortController().signal,onEvent(){},updateId:'u4'})).skipped,false,'three rejections are survived');
  assert.equal(rejected,4,'the request and three more');
  rejected=0;service.providers.complete=async()=>{rejected++;throw new Error('response_invalid');};
  await assert.rejects(defaultWikiUpdater(service,{load})({root,signal:new AbortController().signal,onEvent(){},updateId:'u5'}),/response_invalid/,'a fourth rejection ends the run');
  assert.equal(rejected,4,'the request and three more, then the error');
});

// The agent is told when the Wiki is behind its sources, from Git alone, so an
// answer from the Wiki is not presented as current. It cannot run the update.
test('host receipts say when the Wiki is behind its sources',async t=>{
  const {service,root}=await generated(t);let receipts=null;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},async complete(messages){
    const text=messages.findLast(message=>message.role==='user'&&String(message.content).startsWith('Current host receipts'))?.content;
    receipts??=JSON.parse(text.slice(text.indexOf('{')));return {content:'확인했습니다.',calls:[]};
  }};
  const first=await service.createTask({request:'Wiki를 확인해 줘'});await service.startAgent({taskId:first.id});await service.agent.promise;
  assert.equal(receipts.wikiUpdate,undefined,'a current Wiki adds nothing');
  await commit(root,'app.txt','changed source\n');receipts=null;
  const second=await service.createTask({request:'Wiki를 확인해 줘'});await service.startAgent({taskId:second.id});await service.agent.promise;
  assert.equal(receipts.wikiUpdate.state,'stale');assert.equal(receipts.wikiUpdate.changedFiles,1);assert.deepEqual(receipts.wikiUpdate.sample,['app.txt']);
  assert.match(receipts.wikiUpdate.instruction,/project materials panel/);assert.match(receipts.wikiUpdate.instruction,/cannot run the update/);
});


test('overview counts ignored Wiki pages and empty generation is distinct from missing metadata',async t=>{
  const {service,root}=await fixture(t);
  await git(root,['rm','--cached','openwiki/home.md']);
  await writeFile(path.join(root,'.gitignore'),'openwiki/\n');
  await mkdir(path.join(root,'openwiki/guides'));
  await writeFile(path.join(root,'openwiki/guides/start.md'),'# Start\n');
  await mkdir(path.join(root,'openwiki/.claims'));
  await writeFile(path.join(root,'openwiki/.claims/internal.md'),'internal metadata');
  const overview=await service.overview();
  assert(!overview.files.includes('openwiki/home.md'),'Git source inventory excludes ignored Wiki');
  assert.deepEqual(overview.wikiFiles,['openwiki/guides/start.md','openwiki/home.md']);
  assert.equal((await wikiUpdateStatus(root)).reason,'no_generation_record');
  await rm(path.join(root,'openwiki'),{recursive:true});
  assert.deepEqual((await service.overview()).wikiFiles,[]);
  assert.deepEqual(await wikiUpdateStatus(root),{state:'unknown',reason:'no_wiki_pages'});
});

// The runner turns a page worker's failure into a skipped page, so the host saw an empty Wiki and named no cause
// (2026-10-12). The connection's last failure now reaches the host as an event.
test('a model failure during a run is reported to the host as a model_error event before the run fails',async t=>{
  const {service,root}=await generated(t);const events=[];
  service.providers={status:()=>({connected:true,model:'fixture-model',models:[{id:'fixture-model',contextLength:200000}]}),dispose(){},async complete(){throw new Error('unauthorized');}};
  const load=async()=>({NubiOpenWikiModel:(await import('../generated/openwiki.mjs')).NubiOpenWikiModel,async runNativeRepositoryGeneration(options){await options.model.invoke('plan the update');return {skipped:false};}});
  await assert.rejects(defaultWikiUpdater(service,{load})({root,signal:new AbortController().signal,onEvent:event=>events.push(event),updateId:'u6'}),/unauthorized/);
  assert.deepEqual(events.filter(event=>event.type==='model_error'),[{type:'model_error',code:'unauthorized'}]);
});
