import {mkdir, realpath, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {stringify} from 'yaml';
import {qualityLabel} from './quality-status.mjs';
import {git, hash, readSource, scopedFile, fail} from './files.mjs';

const statusText = {pending_creation:'생성 승인 대기',attention:'저장 확인 필요',conflicted:'기존 파일 확인 필요',creating:'저장 확인 중',timed_out:'시간 초과',paused:'복구 대기',proposed:'검토 대기',applied:'반영 확인',superseded:'후속 제안으로 대체',running:'실행 중',stopping:'중지 중',completed:'실행 종료',failed:'실패',cancelled:'중지',interrupted:'결과 미확정',unknown:'미확인',matching:'기준 내용과 일치',changed:'기준 이후 변경',unavailable:'현재 파일 확인 불가'};
const plain = value => String(value).replace(/[\r\n]/g, ' ').replace(/[<>`|]/g, character => `&#${character.charCodeAt(0)};`);

// Read current evidence, not an LLM's declaration of completion. No credentials,
// terminal output, command arguments or absolute workstation paths are exported.
export async function collectKnowledge(service, taskId) {
  const task = service.task(taskId), root = await service.target(taskId);
  const proposals = service.store.list('proposal:').filter(p => p.taskId === taskId).reverse();
  const computerActions=service.store.list('computer-action:').filter(v=>v.taskId===taskId);
  const observed = new Map((task.sources || []).map(source => [source.path, {...source}]));
  for(const row of task.changePlan?.wikiEvidence||[])if(!observed.has(row.path))observed.set(row.path,{path:row.path,hash:row.hash});
  for(const action of computerActions)for(const row of action.wikiEvidence||[]){
    if(!observed.has(row.path))observed.set(row.path,{path:row.path,hash:row.hash});
    for(const ref of row.sourceReferences||[])if(ref.path&&ref.hash&&!observed.has(ref.path))observed.set(ref.path,{path:ref.path,hash:ref.hash});
  }
  for (const proposal of proposals.filter(p => p.state !== 'superseded')) observed.set(proposal.path, {path:proposal.path,hash:proposal.state === 'applied' ? proposal.afterHash : proposal.expectedHash});
  const sources = [];
  for (const source of [...observed.values()].sort((a,b) => a.path.localeCompare(b.path))) {
    try { const file = await readSource(root, source.path); sources.push({...source,currentHash:file.hash,state:file.hash === source.hash ? 'matching' : 'changed'}); }
    catch(error) { sources.push({...source,currentHash:null,state:error.code==='ENOENT'&&source.hash==='absent'?'pending_creation':'unavailable'}); }
  }
  const head = (await git(root, ['rev-parse','--verify','HEAD'])).trim();
  const processes = service.store.list('process:').filter(p => p.taskId === taskId).reverse().map(({id,profile,state,exitCode,startedAt,finishedAt}) => ({id,profile,state,exitCode,startedAt,finishedAt:finishedAt || null}));
  const comparisons = service.store.list('comparison:').filter(c => c.taskId === taskId).reverse().map(({id,createdAt,state,changedPixels,sourceAssociation}) => ({id,createdAt,state,changedPixels,sourceAssociation}));
  const operations=service.store.list('operation:').filter(o=>o.taskId===taskId).slice(0,30).map(({id,tool,state,outcome,receipt})=>({id,tool,state,outcome:outcome||null,error:receipt?.error||null}));
  const computer={actions:computerActions.map(({id,action,state,execution,verification,createdAt,finishedAt,wikiEvidence=[]})=>({id,action,state,execution:execution||'not_started',verification,createdAt,finishedAt:finishedAt||null,wikiEvidence:wikiEvidence.map(({evidenceId,path,hash,start,end,freshness})=>({evidenceId,path,hash,start,end,freshness}))})),checks:service.store.list('computer-check:').filter(v=>v.taskId===taskId).map(({id,observationId,verification,scope,at})=>({id,observationId,verification,scope,at}))};
  const packet = {schema:1,taskId,recovery:task.recovery?{state:task.recovery.state,code:task.recovery.code||null}:null,operations,requirementId:task.requirementId,request:task.request,criteria:task.criteria,changePlan:task.changePlan||null,decisions:task.questionHistory||[],head,workspace:task.workspace ? 'worktree' : 'project',sources,
    proposals:proposals.map(({id,path,kind,state,expectedHash,afterHash,stats,quality}) => ({id,path,kind:kind||'edit',state,expectedHash,afterHash,stats:stats || null,quality:quality?{state:quality.state,scope:quality.scope,engine:quality.engine,errorCount:quality.errorCount,beforeHash:quality.beforeHash,afterHash:quality.afterHash}:null})),processes,comparisons,computer};
  return {root,task,packet,digest:hash(JSON.stringify(packet))};
}

export async function knowledgeStatus({taskId}) {
  const {task,packet,digest,root} = await collectKnowledge(this,taskId), previous = task.knowledgeRecord;
  let document = 'missing';
  if (previous) {
    try { document = hash(await readFile(await scopedFile(root,previous.path))) === previous.hash ? 'matching' : 'edited'; }
    catch { document = 'missing'; }
  }
  return {state:!previous ? 'none' : document === 'edited' ? 'edited' : document === 'missing' ? 'missing' : previous.digest !== digest ? 'outdated' : 'matching',
    record:previous || null,sources:packet.sources,evidenceDigest:digest};
}

function renderRecord(packet, {revision,createdAt,digest,previous}) {
  const metadata = stringify({title:`${packet.requirementId} 작업 근거 (${revision})`,nubiEvidence:{schema:1,taskId:packet.taskId,revision,createdAt,digest,previous:previous || null}});
  return `---\n${metadata}---\n\n# ${packet.requirementId} 작업 근거\n\n` +
    `기록 시점: ${createdAt}\n\n버전: ${revision}\n\n기록 시점의 결과입니다. 현재 동작은 다시 확인해 주세요.\n\n` +
    `## 요청\n\n${packet.request}\n\n## 완료 조건\n\n` +
    (packet.criteria.length ? packet.criteria.map(c => `- ${plain(c.id)}: ${plain(c.text)} — ${statusText[c.state] || plain(c.state)}`).join('\n') : '- 완료 조건 미지정') +
    `\n\n## 변경 계획과 확인한 요구사항\n\n${packet.changePlan ? plain(packet.changePlan.summary)+'\n'+packet.changePlan.checks.map(c=>' - '+plain(c.description)+' — 검증 전').join('\n') : '- 변경 계획 없음'}\n${packet.decisions.map(q=>'- '+plain(q.text)+' → '+plain(q.answer.text)).join('\n')}` +
    '\n\n## 계획에 사용한 Wiki\n\n' +
    (packet.changePlan?.wikiEvidence?.length ? packet.changePlan.wikiEvidence.map(row=>`- ${plain(row.path)}:${row.start}–${row.end}\n  - 연결한 요구사항: ${packet.changePlan.requirements.filter(r=>r.evidenceIds?.includes(row.evidenceId)).map(r=>plain(r.text)).join(', ')}\n  - 관찰 해시: ${row.hash}\n  - 계획 시점: ${row.freshness==='source_matched'?'출처 버전 일치':'최신성 미확인'}`).join('\n') : '- 연결한 Wiki 근거 없음') +
    `\n\n## 소스 근거\n\n기준 커밋: ${packet.head}\n\n` +
    (packet.sources.length ? packet.sources.map(s => `- ${plain(s.path)} — ${statusText[s.state]}\n  - 관찰 해시: ${s.hash}\n  - 현재 해시: ${s.currentHash || '미확인'}`).join('\n') : '- 아직 관찰하거나 변경한 소스가 없습니다.') +
    '\n\n## 변경 제안\n\n' +
    (packet.proposals.length ? packet.proposals.map(p => `- ${plain(p.path)} — ${statusText[p.state] || plain(p.state)}${p.stats?.state === 'counted' ? `, +${p.stats.added} / -${p.stats.removed}줄` : ''} (${p.id})`).join('\n') : '- 변경 제안 없음') +
    '\n\n## 제안 문법 검사\n\n' +
    (packet.proposals.length?packet.proposals.map(p=>`- ${plain(p.path)}: ${qualityLabel(p.quality)}`).join('\n'):'- 검사한 제안 없음') +
    '\n\n문법 검사 결과입니다. 타입 검사와 실행 테스트는 별도로 확인합니다.\n\n## 실제 실행 기록\n\n' +
    (packet.processes.length ? packet.processes.map(p => `- ${p.id}: ${plain(p.profile)}, ${statusText[p.state] || plain(p.state)}, 종료 코드 ${p.exitCode ?? '미확인'}`).join('\n') : '- 실행 기록 없음') +
    '\n\n## 복구 기록\n\n' +
    (packet.operations.length?packet.operations.map(o=>`- ${plain(o.tool)}: ${plain(o.state)}${o.error?': '+plain(o.error):''}${o.outcome==='unknown'?', 결과 미확정':''} (${o.id})`).join('\n'):'- 복구 대상 도구 기록 없음') +
    '\n\n명령 원문과 터미널 출력, 인증값은 제외했습니다. 중단된 명령은 변경이 남아 있을 수 있어 실제 파일을 확인해야 합니다.\n' +
    '\n\n## 화면 비교\n\n' +
    (packet.comparisons.length ? packet.comparisons.map(c => `- ${c.createdAt}: ${c.changedPixels} pixels 차이. 서버와 소스 버전 연결: 미확인. (${c.id})`).join('\n') : '- 화면 비교 기록 없음') +
    '\n\n## Windows 앱 확인\n\n' +
    (packet.computer.actions.length?packet.computer.actions.map(v=>`- ${plain(v.action)}: ${plain(v.state)}, ${plain(v.execution)}, ${plain(v.verification)} (${v.id})`).join('\n'):'- 앱 동작 기록 없음') +
    '\n\n## 앱 동작에 사용한 Wiki\n\n' +
    (packet.computer.actions.some(v=>v.wikiEvidence.length)?packet.computer.actions.flatMap(v=>v.wikiEvidence.map(row=>`- ${plain(row.path)}:${row.start} (${v.id})\n  - 관찰 해시: ${plain(row.hash)}\n  - 제안 시점: ${row.freshness==='source_matched'?'출처 버전 일치':'검증되지 않은 참고 정보'}`)).join('\n'):'- 연결한 Wiki 근거 없음') +
    '\n\n' + (packet.computer.checks.length?packet.computer.checks.map(v=>`- ${v.at}: ${v.verification==='value_matched'?'화면 값 일치':'화면 값 불일치'} (${v.id})`).join('\n'):'- 화면 값 대조 없음') +
    '\n\n요청한 시점의 동작과 개별 값 대조 기록입니다. 저장, 제출과 업무 완료를 증명하지 않습니다. 앱 경로, 창 제목, 입력값과 화면 이미지는 이 항목에 포함하지 않았습니다.\n' +
    '\n\n완료 조건은 별도 검증이 필요합니다. Office 전달과 저장은 확인하지 않았습니다.\n';
}

export async function recordKnowledge({taskId}) {
  if (this.recordingKnowledge) fail('knowledge_busy');
  this.recordingKnowledge = true;
  try {
    const {task,packet,digest,root} = await collectKnowledge(this,taskId);
    const previous = task.knowledgeRecord;
    if (previous?.digest === digest) {
      try { if (hash(await readFile(await scopedFile(root,previous.path))) === previous.hash) return {...previous,noChange:true}; }
      catch { /* A missing/edited record is preserved; a new revision is created. */ }
    }
    const directory = `openwiki/nubi-evidence/${task.id}`;
    let parent = root;
    for (const segment of directory.split('/')) {
      parent = path.join(parent,segment);
      try { if (await realpath(parent) !== parent) fail('path_scope'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(parent); }
    }
    // Every revision is a new file. Even an editor buffer that has not yet been
    // saved can only save to the old revision, never collide with this write.
    let revision = (previous?.revision || 0) + 1;
    for (let attempt = 0; attempt < 10; attempt++, revision++) {
      const rel = `${directory}/revision-${revision}-${digest.slice(7,19)}.md`,createdAt = new Date().toISOString();
      const content = renderRecord(packet,{revision,createdAt,digest,previous:previous?.path});
      try { await writeFile(await scopedFile(root,rel,{newFile:true}),content,{flag:'wx'}); }
      catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      const actual = await readSource(root,rel); if (actual.hash !== hash(content)) fail('write_unconfirmed');
      const record = {path:rel,hash:actual.hash,digest,revision,createdAt};
      // Read the latest task so a finishing model cannot be overwritten here.
      const current = this.task(taskId); current.knowledgeRecord = record;
      this.store.set('task:'+taskId,current); this.store.event('knowledge_recorded',{taskId,...record});
      return {...record,noChange:false};
    }
    fail('knowledge_collision');
  } finally { this.recordingKnowledge = false; }
}
