import {analysisHistory,restoreAnalysisHistory} from './analysis-history.mjs';
import {interruptDocumentResearch} from './workspace-documents.mjs';
import {importSkill} from './skill-import.mjs';
import {skillCatalog} from './agent-capabilities.mjs';
import {importVoc,queryVoc,readVoc} from './voc.mjs';
import {computer,computerState} from './computer-use.mjs';
import {projectRules,validateProjectRules} from './project-rules.mjs';
import {inspectNewPath,proposeNewFile,prepareNewFile,applyNewFile} from './new-files.mjs';
import {decideSetupAction} from './setup-actions.mjs';
import {mkdir, realpath, readFile, writeFile, mkdtemp, copyFile, stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {searchSource} from './source-search.mjs';
import {checkCodeQuality,requireCodeQuality,codeOutline} from './code-quality.mjs';
import {queryWiki} from './wiki-evidence.mjs';
import {connectKnowledge} from './knowledge.mjs';
import {Store} from './store.mjs';
import {summarizeDiff} from './source-edits.mjs';
import {knowledgeStatus, recordKnowledge} from './knowledge-records.mjs';
import {knowledgeMap,knowledgeQuery,initializeKnowledgeCatalog,exportKnowledgeMap} from './knowledge-map.mjs';
import {databaseConnection} from './database-connections.mjs';
import {Processes, shellProfiles} from './processes.mjs';
import {preferredShell} from './environment-inspection.mjs';
import {git, hash, fail, readSource, listFiles, scopedFile, relativeFile, snapshot} from './files.mjs';
import {wikiUpdate} from './wiki-update.mjs';

const exec = promisify(execFile);
const id = () => randomUUID();
const limited = (value, max = 16000) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail('input_invalid');
export class ProjectService {
  constructor({storageRoot = path.join(os.homedir(), '.nubi-desktop'), recoveryOptions = {}} = {}) { this.storageRoot = storageRoot; this.recoveryOptions=recoveryOptions; }
  async open(root) {
    const resolved = await realpath(limited(root, 2000));
    const top = await realpath((await git(resolved, ['rev-parse', '--show-toplevel'])).trim());
    if (this.root === top && this.store?.db.isOpen) return this.overview();
    if (this.skillImportBusy || this.vocBusy || this.computerBusy || this.newFileBusy || this.setupBusy || this.processes?.active.size || this.processes?.pending.size || this.unsettledOperations?.size || this.reconciling || this.agent?.running || this.recordingKnowledge || this.databaseBusy || this.collaborationBusy) fail('project_busy');
    const projectId = hash(top).slice(7, 31), store = new Store(path.join(this.storageRoot, projectId));
    await this.collaborationServer?.close();this.collaborationServer=null;this.knowledge?.server.close(); this.knowledge=null; this.store?.close(); this.root = top; this.projectId = projectId;
    this.store = store;
    interruptDocumentResearch(this.store);
    restoreAnalysisHistory(this.store);
    this.computerPointer?.dispose();this.computerPointer=null;this.computerFallback=null;this.computerAdapter?.dispose?.();this.computerAdapter=null;this.computerLauncher?.dispose?.();this.computerLauncher=null;this.computerApps=new Map();this.databaseConnections=new Map();this.computerBinding=null;this.computerObservation=null;
    for(const action of this.store.list('computer-action:').filter(v=>v.state==='starting'))this.store.set('computer-action:'+action.id,{...action,state:'attention',execution:'unknown',error:'computer_outcome_unknown'});
    for(const action of this.store.list('computer-action:').filter(v=>v.review?.state==='running'))this.store.set('computer-action:'+action.id,{...action,review:{...action.review,state:'interrupted'}});
    this.disposed=false;this.recoveryQueue=new Set();
    this.processes = new Processes(this.store,{onFinished:record=>this.processFinished?.(record)});
    // A restarted host cannot establish the outcome of an earlier process.
    for (const p of this.store.list('process:').filter(p => ['running','stopping','checking'].includes(p.state))) this.store.set('process:' + p.id, {...p, state: 'interrupted',execution:'unknown',recoveryState:'attention'});
    for(const task of this.store.list('task:').filter(t=>['pending','connected'].includes(t.computerConnectionRequest?.state))){
      const {bindingId,connectedAt,...request}=task.computerConnectionRequest;
      this.store.set('task:'+task.id,{...task,state:task.state==='cancelled'?'cancelled':'waiting_input',computerConnectionRequest:{...request,state:task.state==='cancelled'?'cancelled':'pending'}});
    }
    for (const task of this.store.list('task:').filter(t => t.state === 'running')) this.store.set('task:' + task.id, {...task, state: 'interrupted'});
    for(const operation of this.store.list('operation:').filter(o=>o.state==='started'))this.store.set('operation:'+operation.id,{...operation,state:'interrupted'});
    for(const repair of this.store.list('command-repair:').filter(r=>r.state==='starting'))this.store.set('command-repair:'+repair.id,{...repair,state:'attention',error:'execution_unknown'});
    for(const action of this.store.list('setup-action:').filter(v=>v.state==='starting'))this.store.set('setup-action:'+action.id,{...action,state:'attention',error:'setup_execution_unconfirmed'});
    for(const proposal of this.store.list('proposal:').filter(p=>p.state==='creating'))this.store.set('proposal:'+proposal.id,{...proposal,state:'attention'});
    return this.overview();
  }
  ready() { if (!this.store) fail('project_missing'); }
  shellPreference() { this.ready(); return this.store.get('setting:shell')?.profile; }
  async setShellPreference({profile}) {
    this.ready();
    if(this.agent?.running||this.setupBusy)fail('agent_busy');
    const profiles=await shellProfiles();
    if(typeof profile!=='string'||!profiles.some(item=>item.id===profile))fail('shell_unavailable');
    this.store.set('setting:shell',{profile});
    return {profile};
  }
  async overview() {
    this.ready();
    const [files, branch, status, profiles] = await Promise.all([listFiles(this.root), git(this.root, ['branch', '--show-current']), git(this.root, ['status', '--short']), shellProfiles()]);
    return {projectId: this.projectId, root: this.root, name: path.basename(this.root), branch: branch.trim() || 'detached', dirty: !!status,
      files: files.paths, truncated: files.truncated, wikiFiles: files.paths.filter(p => p.startsWith('openwiki/') && p.endsWith('.md')),
      computer:computerState(this),setupActions:this.store.list('setup-action:').slice(0,50), collaborations:[], tasks: this.store.list('task:').slice(0, 50), proposals: this.store.list('proposal:').slice(0, 50), processes: this.store.list('process:').slice(0, 20), comparisons: this.store.list('comparison:').slice(0, 20), commandRepairs:this.store.list('command-repair:').slice(0,30), profiles,defaultShell:preferredShell(profiles,process.platform,this.shellPreference())};
  }
  state() { this.ready(); return {computer:computerState(this),setupActions:this.store.list('setup-action:').slice(0,50), collaborations:[], tasks: this.store.list('task:').slice(0,50), proposals: this.store.list('proposal:').slice(0,50), processes: this.store.list('process:').slice(0,20), comparisons: this.store.list('comparison:').slice(0,20),commandRepairs:this.store.list('command-repair:').slice(0,30)}; }
  task(taskId) { const task = this.store.get('task:' + taskId); if (!task) fail('task_missing'); return task; }
  async target(taskId) {
    if (!taskId) return this.root;
    const task = this.task(taskId); const root = task.workspace || this.root;
    if (root !== this.root) {
      const list = await git(this.root, ['worktree', 'list', '--porcelain']);
      if (!list.split('\n').includes('worktree ' + root)) fail('workspace_missing');
      if (await realpath(root) !== root) fail('workspace_changed');
    }
    return root;
  }
  async read({path: rel, taskId, start = 1, end, full = false, room, measure = text => text.length}) {
    this.ready(); const root = await this.target(taskId), file = {...await readSource(root, rel),projectRules:await projectRules(root,rel)};
    if (full) return {...file, uri: pathToFileURL(path.join(root, rel)).href};
    const requestedEnd = end;
    end ??= start + 199;
    if (!Number.isInteger(start) || start < 1 || start > file.lines || !Number.isInteger(end) || end < start) throw Object.assign(new Error('range_invalid'),{details:{lines:file.lines}});
    // A request beyond a limit is served from its start. A refusal costs a
    // model call and says nothing that the result cannot say.
    let limited = null;
    if (end - start >= 200) { end = start + 199; limited = 'lines'; }
    end = Math.min(end, file.lines);
    const lines = file.content.split('\n').slice(start - 1, end);
    if (Number.isFinite(room)) {
      // The caller says how much the next request of the model can hold. The first line is always returned.
      let size = 0, count = 0;
      for (const text of lines) { size += measure(text); if (count && size > room) break; count++; }
      if (count < lines.length) { lines.length = count; end = start + count - 1; limited = 'size'; }
    }
    return {...file, content: lines.join('\n'), start, end, truncated: start !== 1 || end < file.lines, nextStart: end < file.lines ? end + 1 : null, ...(limited ? {limited: {by: limited, ...(requestedEnd === undefined ? {} : {requestedEnd})}} : {}), uri: pathToFileURL(path.join(root, rel)).href};
  }
  async inspectPath({taskId,path}) {return inspectNewPath(await this.target(taskId),path);}
  async proposeNewFile(args) {return proposeNewFile.call(this,args);}
  async applyNewFile(args) {return applyNewFile.call(this,args);}
  async search(args) { return searchSource.call(this,args); }
  async codeOutline(args) { this.ready();return codeOutline.call(this,args); }
  async wikiQuery(args) { this.ready();return queryWiki.call(this,args); }
  async knowledgeMap(args) { return knowledgeMap.call(this,args); }
  async knowledgeQuery(args) { return knowledgeQuery.call(this,args); }
  async initializeKnowledgeCatalog(args) { return initializeKnowledgeCatalog.call(this,args); }
  async exportKnowledgeMap(args) { return exportKnowledgeMap.call(this,args); }
  async databaseConnection(args) { return databaseConnection.call(this,args); }
  async knowledgeStatus(args) { return knowledgeStatus.call(this,args); }
  async recordKnowledge(args) { return recordKnowledge.call(this,args); }
  async connectKnowledge() { return connectKnowledge.call(this); }

  async importSkill(args) {return importSkill.call(this,args);}
  async listSkills({taskId}={}) {this.ready();return skillCatalog(await this.target(taskId));}

  async importVoc(args) {return importVoc.call(this,args);}
  async queryVoc(args) {return queryVoc.call(this,args);}
  async readVoc(args) {return readVoc.call(this,args);}

  async computer(args) {return computer.call(this,args);}
  async wikiUpdate(args) {return wikiUpdate.call(this,args);}
  async decideSetupAction(args) {return decideSetupAction.call(this,args);}

  async collaboration() {fail('a2a_not_enabled');}

  async createTask({request, criteria = []}) {
    this.ready(); request = limited(request);
    if (!Array.isArray(criteria) || criteria.length > 30) fail('criteria_invalid');
    const key = id(), task = {id: key, request, criteria: criteria.map((text, i) => ({id: 'AC-' + (i + 1), text: limited(text, 1000), state: 'unknown'})), state: 'draft', createdAt: new Date().toISOString(), messages: [], trace: [], requirementId: 'REQ-' + key.slice(0, 8)};
    this.store.set('task:' + key, task); this.store.event('task_created', {id: key}); return task;
  }
  async exportRequirement({taskId}) {
    const task = this.task(taskId), slug = 'nubi-' + task.id.slice(0, 8), base = 'openspec/changes/' + slug;
    if (task.specPath) return {path: task.specPath, task};
    let folder = this.root;
    for (const part of (base + '/specs/requirement').split('/')) {
      folder = path.join(folder, part);
      try { if (await realpath(folder) !== folder) fail('path_scope'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(folder); }
    }
    // New UUID-scoped files only: never overwrite an existing project document.
    const proposal = `## Why\n\n${task.request}\n\n## What Changes\n\n- ${task.requirementId}\n\n## Capabilities\n\n### New Capabilities\n\n- requirement: ${task.requirementId}\n\n### Modified Capabilities\n\nNone.\n\n## Impact\n\nSource impact requires analysis.\n`;
    const content = `## Purpose\n\nThis change records the user's requested behavior and retains acceptance criteria for source changes and independent verification.\n\n## ADDED Requirements\n\n### Requirement: ${task.requirementId}\n\nThe system MUST satisfy the following user request:\n\n${task.request}\n\n` + (task.criteria.length ? task.criteria : [{id: 'AC-pending', text: '완료 조건을 확인한다.'}]).map(c => `#### Scenario: ${c.id}\n\n- **WHEN** the requested workflow is executed\n- **THEN** ${c.text}\n`).join('\n');
    for (const [rel, text] of [[base + '/proposal.md', proposal], [base + '/specs/requirement/spec.md', content]]) {
      const target = await scopedFile(this.root, rel, {newFile: true}); await writeFile(target, text, {flag: 'wx'});
    }
    task.specPath = base + '/specs/requirement/spec.md'; this.store.set('task:' + task.id, task); return {path: task.specPath, task};
  }
  async createWorktree({taskId}) {
    const task = this.task(taskId); if (task.workspace) return task;
    if (this.skillImportBusy || this.vocBusy || this.computerBusy || this.newFileBusy || this.setupBusy || this.agent?.running || this.processes?.active.size || this.processes?.pending.size || this.unsettledOperations?.size) fail('project_busy');
    // P0 makes the selected HEAD baseline explicit; existing dirty changes stay in the original checkout.
    const head = (await git(this.root, ['rev-parse', '--verify', 'HEAD'])).trim();
    const parent = path.join(this.store.directory, 'worktrees'); await mkdir(parent, {recursive: true});
    const workspace = path.join(parent, task.id);
    await git(this.root, ['worktree', 'add', '--detach', workspace, head]);
    Object.assign(task, {workspace: await realpath(workspace), baseline: head, baselineKind: 'HEAD', state: 'ready'});
    this.store.set('task:' + task.id, task); this.store.event('worktree_created', {taskId, baseline: head}); return task;
  }
  async propose({taskId, path: rel, expectedHash, content, reason = '',signal,rulesFingerprint}) {
    this.ready(); if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 1024 * 1024) fail('content_limit');
    const root = await this.target(taskId), current = await readSource(root, rel);
    const rules=await projectRules(root,rel);await validateProjectRules(root,rel,rulesFingerprint);
    if (current.hash !== expectedHash) fail('source_stale');
    const quality=await checkCodeQuality(rel,current.content,content,{signal});requireCodeQuality(quality);
    if(signal?.aborted)fail('cancelled');
    await validateProjectRules(root,rel,rules.fingerprint);
    if((await readSource(root,rel)).hash!==expectedHash)fail('source_stale');
    const previous=this.store.list('proposal:').find(p=>p.taskId===taskId&&p.path===rel&&p.expectedHash===expectedHash&&p.rulesFingerprint===rules.fingerprint&&p.afterHash===hash(content)&&p.state==='proposed');if(previous){previous.quality=quality;this.store.set('proposal:'+previous.id,previous);return {...previous,reused:true};}
    const key = id(), folder = path.join(this.store.directory, 'proposals', key); await mkdir(folder, {recursive: true});
    const before = path.join(folder, 'before' + path.extname(rel)), after = path.join(folder, 'after' + path.extname(rel));
    await writeFile(before, current.content); await writeFile(after, content);
    const proposal = {id: key, taskId, path: rel, rulesFingerprint:rules.fingerprint, expectedHash, afterHash: hash(content), before, after, content, quality, stats: summarizeDiff(current.content, content), reason: String(reason).slice(0, 2000), state: 'proposed', createdAt: new Date().toISOString()};
    this.store.set('proposal:' + key, proposal); return proposal;
  }
  async proposalArtifacts({proposalId}) { const proposal=this.store.get('proposal:'+proposalId);if(!proposal)fail('proposal_missing');return {...proposal,beforeUri:pathToFileURL(proposal.before).href,afterUri:pathToFileURL(proposal.after).href}; }
  async prepareProposal({proposalId}) {
    const proposal = this.store.get('proposal:' + proposalId); if (!proposal) fail('proposal_missing');
    if(proposal.kind==='create')return prepareNewFile.call(this,proposal);
    const root = await this.target(proposal.taskId), current = await readSource(root, proposal.path);
    if(proposal.state!=='applied')await validateProjectRules(root,proposal.path,proposal.rulesFingerprint);
    if (proposal.state === 'applied' && current.hash !== proposal.afterHash) fail('applied_changed');
    if(current.hash===proposal.afterHash)return {...await this.confirmProposal({proposalId}),alreadyApplied:true,uri:pathToFileURL(path.join(root,proposal.path)).href};
    if (proposal.state !== 'applied' && current.hash !== proposal.expectedHash) fail('source_stale');
    if(proposal.state!=='applied'){proposal.quality=await checkCodeQuality(proposal.path,current.content,proposal.content);this.store.set('proposal:'+proposalId,proposal);requireCodeQuality(proposal.quality);}
    return {...proposal, alreadyApplied: proposal.state === 'applied', uri: pathToFileURL(path.join(root, proposal.path)).href, beforeUri: pathToFileURL(proposal.before).href, afterUri: pathToFileURL(proposal.after).href};
  }
  async confirmProposal({proposalId}) {
    const proposal = this.store.get('proposal:' + proposalId); if (!proposal) fail('proposal_missing');
    if(proposal.kind==='create'&&proposal.state!=='applied')fail('write_unconfirmed');
    const actual = await readSource(await this.target(proposal.taskId), proposal.path);
    if (actual.hash !== proposal.afterHash) fail('write_unconfirmed');
    proposal.state = 'applied'; this.store.set('proposal:' + proposalId, proposal); this.store.event('proposal_applied', {proposalId, hash: actual.hash}); return proposal;
  }
  async mergeProposal({proposalId}) {
    const proposal = this.store.get('proposal:' + proposalId); if (!proposal || proposal.kind==='create' || proposal.state !== 'proposed') fail('proposal_missing');
    const current = await readSource(await this.target(proposal.taskId), proposal.path);
    const ours = path.join(path.dirname(proposal.before), 'current' + path.extname(proposal.path)); await writeFile(ours, current.content);
    let merged, conflicted = false;
    try { merged = (await exec('git', ['merge-file', '-p', '-L', '현재 문서', '-L', '생성 기준', '-L', '누비 제안', ours, proposal.before, proposal.after], {maxBuffer: 2e6})).stdout; }
    catch (error) { if (typeof error.code !== 'number' || error.code < 1 || error.code > 127) throw error; merged = error.stdout; conflicted = true; }
    if (conflicted) return {conflicted: true, content: merged, currentHash: current.hash};
    const next=await this.propose({taskId: proposal.taskId, path: proposal.path, expectedHash: current.hash, content: merged, reason: proposal.reason}); proposal.state='superseded'; this.store.set('proposal:'+proposalId,proposal); return {conflicted:false,proposal:next};
  }
  async comparison({id}) { this.ready(); const value=this.store.get('comparison:'+id); if(!value)fail('comparison_missing'); const [before,after,difference]=await Promise.all(['before','after','difference'].map(name=>readFile(path.join(value.directory,name+'.png')))); return {...value,beforeImage:'data:image/png;base64,'+before.toString('base64'),afterImage:'data:image/png;base64,'+after.toString('base64'),diffImage:'data:image/png;base64,'+difference.toString('base64')}; }
  async diff({taskId}) { const root = await this.target(taskId); return {diff: await git(root, ['diff', '--no-ext-diff', '--', '.']), status: await git(root, ['status', '--short']), root}; }
  async run({taskId, script, profile, timeoutMs,autoDiagnose=true,repairOf}) { if(this.computerBusy||this.newFileBusy||this.setupBusy)fail('project_busy');if(this.unsettledOperations?.size)fail('tool_unsettled');if(this.task(taskId).question)fail('question_pending');const cwd = await this.target(taskId); return this.processes.start({cwd, taskId, script, profile:profile||preferredShell(await shellProfiles(),process.platform,this.shellPreference()), timeoutMs,autoDiagnose,repairOf}); }
  analysisHistory(args) { return analysisHistory.call(this,args); }

  async exportReport({taskId}) {
    const task = this.task(taskId), reports = path.join(this.store.directory, 'reports'); await mkdir(reports, {recursive: true});
    const comparisons = this.store.list('comparison:').filter(c => c.taskId === taskId);
    const content = `# ${task.requirementId} 검증 보고서\n\n## 요청\n\n${task.request}\n\n## 기준\n\n${task.baseline || '기준 미지정'}\n\n## 완료 조건\n\n` + task.criteria.map(c => `- ${c.id}: ${c.text} — ${c.state}`).join('\n') + '\n\n## 화면 비교\n\n' + comparisons.map(c => `- ${c.createdAt}: 시각 차이 ${c.changedPixels} pixels. 기능 검증 판정은 별도입니다.`).join('\n') + '\n\nOffice 연결 및 최종 문서 저장은 아직 수행하지 않았습니다.\n';
    const file = path.join(reports, task.id + '.md'); await writeFile(file, content); return {uri: pathToFileURL(file).href, hash: hash(content), content};
  }
  async invoke(method, args = {}) {
    const allowed = new Set(['wikiUpdate','analysisHistory','listSkills','importSkill','importVoc','queryVoc','readVoc','computer','applyNewFile','decideSetupAction','collaboration','codeOutline','recoverySnapshot','resumeAgent','diagnoseProcess','applyCommandRepair','knowledgeMap','knowledgeQuery','initializeKnowledgeCatalog','exportKnowledgeMap','databaseConnection','open','knowledgeStatus','recordKnowledge','comparison','connectKnowledge','overview','state','setShellPreference','read','search','wikiQuery','createTask','exportRequirement','createWorktree','propose','prepareProposal','proposalArtifacts','confirmProposal','mergeProposal','diff','run','exportReport','compare','provider','fabrix','startAgent','answerAgent','saveQuestionDraft','stopAgent']);
    if (method === 'poll') { this.ready(); return this.processes.poll(args.id); }
    if (method === 'stop') { this.ready(); return this.processes.stop(args.id); }
    if (method === 'events') { this.ready(); return this.store.events(args.after); }
    if (!allowed.has(method) || typeof this[method] !== 'function') fail('method_invalid');
    return this[method](method === 'open' ? args.root : args);
  }
  dispose() { this.computerPointer?.dispose();this.computerLauncher?.dispose?.();this.computerAdapter?.dispose?.();void this.collaborationServer?.close();this.disposed=true;this.recoveryQueue?.clear();this.databaseWorker?.terminate(); this.databaseConnections?.clear(); this.knowledge?.server.close(); this.agent?.controller.abort(); this.providers?.dispose(); for(const entry of this.fabrixTests?.values()||[])entry.provider.dispose();this.fabrixTests?.clear(); this.processes?.dispose(); }
}
