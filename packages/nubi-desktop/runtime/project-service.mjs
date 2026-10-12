import {searchConversations} from '../ui/conversation-search.mjs';
import {listWikiPages} from './wiki-snapshot.mjs';
import {installDesktopFeatures} from './desktop-features.mjs';
import {appliedFileSummary} from './applied-file-summary.mjs';
import {installProjectBrowser} from './project-browser.mjs';
import {agentInput} from './agent-input.mjs';
import {validateMailReferences} from './mail-evidence.mjs';
import {mail} from './mail.mjs';
const collaborationRows=()=>[],peerRows=()=>[],peerLinks=()=>[];
import {analysisHistory,restoreAnalysisHistory} from './analysis-history.mjs';
import {interruptDocumentResearch} from './workspace-documents.mjs';
import {importSkill,removeSkill,skillTrash} from './skill-import.mjs';
import {skillMarketplace,connectSkillMarketplace,disconnectSkillMarketplace} from './skill-marketplace.mjs';
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
import {git, gitOpenFailure, hash, fail, readSource, listFiles, scopedFile, relativeFile, snapshot} from './files.mjs';
import {READ_LINES} from './read-room.mjs';
import {modelTransport} from './recovery.mjs';
import {wikiUpdate} from './wiki-update.mjs';
import {inspectWorkspaceChanges} from './workspace-changes.mjs';

const exec = promisify(execFile);
const id = () => randomUUID();
const limited = (value, max = 16000) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail('input_invalid');
export class ProjectService {
  constructor({storageRoot = path.join(os.homedir(), '.nubi-desktop'), recoveryOptions = {}} = {}) { this.storageRoot = storageRoot; this.recoveryOptions=recoveryOptions; }
  get agent(){return [...(this.agentRuns?.values()||[])].find(run=>run.running)||this.lastAgent||null;}
  set agent(run){this.agentRuns ||= new Map();if(!run){this.agentRuns.clear();this.lastAgent=null;return;}if(run.taskId)this.agentRuns.set(run.taskId,run);this.lastAgent=run;}
  agentForTask(taskId){return this.agentRuns?.get(taskId)||(this.lastAgent&&!this.lastAgent.taskId?this.lastAgent:null);}
  async open(root, {kind='project',initializeWiki=true,exactRoot=false}={}) {
    // Each reason a folder cannot be opened has its own code for the "프로젝트 열기" message.
    const resolved = await realpath(limited(root, 2000)).catch(error => fail(['EACCES', 'EPERM'].includes(error?.code) ? 'project_path_denied' : 'project_path_missing'));
    // A folder without Git, or outside a repository, opens as it is (user decision 2026-10-04); the setup flow of 2026-09-30 is gone (2026-10-07).
    const top = await git(resolved, ['rev-parse', '--show-toplevel']).then(output => realpath(output.trim()), async error => {const code = gitOpenFailure(error); if (['git_unavailable', 'not_git_repository'].includes(code)) return resolved; fail(code);});
    if(exactRoot&&top!==resolved)fail('clone_root_mismatch');
    if (this.root === top && this.store?.db.isOpen) {if(initializeWiki){this.wikiInitEnabled=true;await this.initializeWiki();}return this.overview();}
    if (this.skillImportBusy || this.vocBusy || this.computerBusy || this.newFileBusy || this.setupBusy || this.processes?.active.size || this.processes?.pending.size || this.unsettledOperations?.size || this.reconciling || this.agent?.running || this.recordingKnowledge || this.databaseBusy || this.collaborationBusy) fail('project_busy');
    const projectId = hash(top).slice(7, 31), store = new Store(path.join(this.storageRoot, projectId));
    await this.collaborationServer?.close();this.collaborationServer=null;this.knowledge?.server.close(); this.knowledge=null; this.store?.close(); this.root = top; this.projectId = projectId; this.agentRuns?.clear();this.lastAgent=null;
    this.wikiInitController?.abort();this.wikiUpdateRun?.controller.abort();this.store = store;this.workspaceKind=kind==='conversation'?'conversation':'project';this.wikiInitEnabled=initializeWiki!==false;
    interruptDocumentResearch(this.store);
    restoreAnalysisHistory(this.store);
    this.localPerception?.dispose();delete this.localPerception;this.computerPointer?.dispose();this.computerPointer=null;this.computerFallback=null;this.computerAdapter?.dispose?.();this.computerAdapter=null;this.computerLauncher?.dispose?.();this.computerLauncher=null;this.computerApps=new Map();this.databaseConnections=new Map();this.computerBinding=null;this.computerObservation=null;
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
    for (const task of this.store.list('task:').filter(t => t.state === 'running'||t.responseTiming?.state==='running')) this.store.set('task:' + task.id, {...task, state: 'interrupted',...(task.responseTiming?{responseTiming:{...task.responseTiming,state:'interrupted',durationMs:null}}:{})});
    for(const operation of this.store.list('operation:').filter(o=>o.state==='started'))this.store.set('operation:'+operation.id,{...operation,state:'interrupted'});
    for(const repair of this.store.list('command-repair:').filter(r=>r.state==='starting'))this.store.set('command-repair:'+repair.id,{...repair,state:'attention',error:'execution_unknown'});
    for(const action of this.store.list('setup-action:').filter(v=>v.state==='starting'))this.store.set('setup-action:'+action.id,{...action,state:'attention',error:'setup_execution_unconfirmed'});
    for(const proposal of this.store.list('proposal:').filter(p=>p.state==='creating'))this.store.set('proposal:'+proposal.id,{...proposal,state:'attention'});
    await this.initializeWiki();
    return this.overview();
  }
  ready() { if (!this.store) fail('project_missing'); }
  projectPath({projectId,taskId}={}) {
    this.ready();
    if(projectId!==this.projectId)fail('project_changed');
    if(taskId)this.task(taskId);
    return {projectId:this.projectId,path:this.root};
  }
  shellPreference() { this.ready(); return this.store.get('setting:shell')?.profile; }
  async setShellPreference({profile}) {
    this.ready();
    if(this.agent?.running||this.setupBusy)fail('agent_busy');
    const profiles=await shellProfiles();
    if(typeof profile!=='string'||!profiles.some(item=>item.id===profile))fail('shell_unavailable');
    this.store.set('setting:shell',{profile});
    return {profile};
  }
  async overview({taskId}={}) {
    this.ready();
    const owner=this.store,projectId=this.projectId;
    const [files, branch, status, profiles, wikiPages] = await Promise.all([listFiles(this.root), git(this.root, ['branch', '--show-current']).catch(()=> 'Git 없음'), git(this.root, ['status', '--short']).catch(()=> ''), shellProfiles(),listWikiPages(this.root)]);
    if(this.store!==owner||this.projectId!==projectId)fail('project_changed');
    return {projectId: this.projectId, root: this.root, kind:this.workspaceKind||'project', name:this.workspaceKind==='conversation'?'개인 대화':path.basename(this.root), branch: branch.trim() || 'detached', dirty: !!status,
      files: files.paths, truncated: files.truncated, wikiInitialization:this.workspaceKind==='conversation'?null:this.store.get('wiki-init'), wikiFiles: wikiPages,
      computer:computerState(this),setupActions:this.store.list('setup-action:').slice(0,50), collaborations:collaborationRows(this),peerTasks:peerRows(this),peerLinks:peerLinks(this), tasks: this.displayTasks(taskId), proposals: this.store.list('proposal:').slice(0, 50), processes: this.store.list('process:').slice(0, 20), comparisons: this.store.list('comparison:').slice(0, 20), commandRepairs:this.store.list('command-repair:').slice(0,30), profiles,defaultShell:preferredShell(profiles,process.platform,this.shellPreference())};
  }
  async workspaceChanges(args={}) {return inspectWorkspaceChanges(this,args);}
  async appliedFileSummary(args={}) {return appliedFileSummary(this,args);}
  state({taskId}={}) { this.ready(); return {computer:computerState(this),setupActions:this.store.list('setup-action:').slice(0,50), collaborations:collaborationRows(this),peerTasks:peerRows(this),peerLinks:peerLinks(this), tasks: this.displayTasks(taskId), proposals: this.store.list('proposal:').slice(0,50), processes: this.store.list('process:').slice(0,20), comparisons: this.store.list('comparison:').slice(0,20),commandRepairs:this.store.list('command-repair:').slice(0,30)}; }
  displayTasks(taskId){const tasks=this.store.list('task:').slice(0,50);if(taskId&&!tasks.some(task=>task.id===taskId)){const selected=this.store.get('task:'+taskId);if(selected)tasks.push(selected);}return tasks.map(task=>this.displayTask(task));}
  conversationHistory(args={}) {this.ready();if(args.taskId){if(typeof args.taskId!=='string')fail('task_missing');return this.displayTask(this.task(args.taskId));}return searchConversations(this.store.list('task:'),args);}
  displayTask(task){const run=this.agentForTask(task.id);return run?.running&&run.timing?{...task,streamingAnswer:run.streamingAnswer||'',responseTiming:{...run.timing.snapshot(),runId:run.runId}}:task;}
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
    end ??= start + READ_LINES - 1;
    if (!Number.isInteger(start) || start < 1 || start > file.lines || !Number.isInteger(end) || end < start) throw Object.assign(new Error('range_invalid'),{details:{lines:file.lines}});
    // A request beyond a limit is served from its start. A refusal costs a
    // model call and says nothing that the result cannot say.
    let limited = null;
    if (end - start >= READ_LINES) { end = start + READ_LINES - 1; limited = 'lines'; }
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

  async skillMarketplace(args) {return skillMarketplace.call(this,args);}
  connectSkillMarketplace(args) {return connectSkillMarketplace.call(this,args);}
  disconnectSkillMarketplace() {return disconnectSkillMarketplace.call(this);}
  async importSkill(args) {return importSkill.call(this,args);}
  async removeSkill(args) {return removeSkill.call(this,args);}
  async skillTrash(args) {return skillTrash.call(this,args);}
  async listSkills({taskId}={}) {
    this.ready();if(taskId)this.task(taskId);const root=this.root,catalog=await skillCatalog(root),prefix='nubi-registered-skill:'+hash(root)+':';
    const skills=catalog.skills.map(skill=>{
      const record=this.store.get(prefix+skill.name),company=this.store.get('nubi-marketplace-skill:'+hash(root)+':'+skill.name),entry=skill.path===`.nubi/skill/${skill.name}/SKILL.md`;
      return {...skill,origin:entry&&company&&company.state!=='removed'?'workspace':'custom',...(entry&&company&&company.state!=='removed'?{title:company.title||skill.name}:{}),...(entry&&record?.state==='registered'?{managed:true,title:record.title||skill.name,packageHash:record.hash}:{})};
    });
    // A malformed edited instruction stays manageable without being activated by the agent.
    const unavailable=this.store.list(prefix).filter(record=>record.state==='registered'&&!skills.some(skill=>skill.path===`.nubi/skill/${record.name}/SKILL.md`)).map(record=>({name:record.name,title:record.title||record.name,description:record.description||'',path:`.nubi/skill/${record.name}/SKILL.md`,origin:'custom',managed:true,state:'unavailable',packageHash:record.hash}));
    return {...catalog,skills,unavailable};
  }

  async importVoc(args) {return importVoc.call(this,args);}
  async queryVoc(args) {return queryVoc.call(this,args);}
  async readVoc(args) {return readVoc.call(this,args);}

  async computer(args) {return computer.call(this,args);}
  async wikiUpdate(args) {return wikiUpdate.call(this,args);}
  async decideSetupAction(args) {return decideSetupAction.call(this,args);}

  async collaboration() {fail('a2a_disabled');}

  async createTask({request, criteria = [],mailReferences=[]}) {
    this.ready(); request = limited(request);
    if (!Array.isArray(criteria) || criteria.length > 30) fail('criteria_invalid');
    const references=await validateMailReferences(this,mailReferences);
    const key = id(), task = {id: key, request, mailReferences:references,requestMailReferences:references,criteria: criteria.map((text, i) => ({id: 'AC-' + (i + 1), text: limited(text, 1000), state: 'unknown'})), state: 'draft', createdAt: new Date().toISOString(), messages: [], trace: [], requirementId: 'REQ-' + key.slice(0, 8)};
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
  // A conversation the user deletes with the trash icon (user decision 2026-09-30): the task, every record made for it
  // and its own worktree go. Files already applied to the project stay. A running task or process is refused.
  async deleteTask({taskId}) {
    this.ready(); const task = this.task(taskId);
    if (['running', 'stopping'].includes(task.state) || this.agentForTask(taskId)?.running) fail('agent_busy');
    if (this.store.list('process:').some(item => item.taskId === taskId && ['running', 'stopping'].includes(item.state))) fail('process_running');
    if (task.workspace) await git(this.root, ['worktree', 'remove', '--force', task.workspace]).catch(() => fail('worktree_remove_failed'));
    if (this.computerBinding?.taskId === taskId) { this.computerBinding = null; this.computerObservation = null; this.computerFallback = null; await this.computerPointer?.hide(); }
    // Records carry the task in their value, or in their key: context, reconciliation and analysis history.
    const owned = key => [`context:${taskId}`, `reconciliation:${taskId}`].includes(key) || key === `analysis-history:${taskId}` || [`analysis-history:${taskId}:`, `result-review:${taskId}:`, `result-review-recovery:${taskId}:`].some(prefix => key.startsWith(prefix));
    const entries = this.store.entries(''), actions = new Set(entries.filter(({key, value}) => key.startsWith('computer-action:') && value?.taskId === taskId).map(({value}) => value.id));
    const keys = entries.filter(({key, value}) => key === 'task:' + taskId || value?.taskId === taskId || owned(key) || (key.startsWith('computer-image:') && actions.has(key.slice(15)))).map(({key}) => key);
    for (const key of keys) this.store.delete(key);
    this.agentRuns?.delete(taskId);if(this.lastAgent?.taskId===taskId)this.lastAgent=null;
    this.store.event('task_deleted', {id: taskId, records: keys.length});
    return {deleted: taskId};
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
    // The run that proposed it: a command proposed later in the same run waits for it (setup-actions.mjs).
    const runId=this.agent?.running&&this.agent.taskId===taskId?this.agent.runId:undefined;
    const proposal = {id: key, taskId, path: rel, rulesFingerprint:rules.fingerprint, expectedHash, afterHash: hash(content), before, after, content, quality, stats: summarizeDiff(current.content, content), reason: String(reason).slice(0, 2000), state: 'proposed', createdAt: new Date().toISOString(),...(runId?{runId}:{})};
    this.store.set('proposal:' + key, proposal);
    // Only the newest proposal of a file can be applied: an older open one of the task is superseded.
    for(const older of this.store.list('proposal:').filter(p=>p.id!==key&&p.taskId===taskId&&p.path===rel&&p.state==='proposed'))this.store.set('proposal:'+older.id,{...older,state:'superseded'});
    return proposal;
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
  agentInput(args) { return agentInput.call(this,args); }
  analysisHistory(args) { return analysisHistory.call(this,args); }

  async exportReport({taskId}) {
    const task = this.task(taskId), reports = path.join(this.store.directory, 'reports'); await mkdir(reports, {recursive: true});
    const comparisons = this.store.list('comparison:').filter(c => c.taskId === taskId);
    const content = `# ${task.requirementId} 검증 보고서\n\n## 요청\n\n${task.request}\n\n## 기준\n\n${task.baseline || '기준 미지정'}\n\n## 완료 조건\n\n` + task.criteria.map(c => `- ${c.id}: ${c.text} — ${c.state}`).join('\n') + '\n\n## 화면 비교\n\n' + comparisons.map(c => `- ${c.createdAt}: 시각 차이 ${c.changedPixels} pixels. 기능 검증 판정은 별도입니다.`).join('\n') + '\n\nOffice 연결 및 최종 문서 저장은 아직 수행하지 않았습니다.\n';
    const file = path.join(reports, task.id + '.md'); await writeFile(file, content); return {uri: pathToFileURL(file).href, hash: hash(content), content};
  }
  async mail(args) {return mail.call(this,args);}
  prepareAppUpdate(){
    const mail=this.personalMail;
    if(this.skillImportBusy||this.marketplaceBusy||this.vocBusy||this.computerBusy||this.newFileBusy||this.setupBusy||this.processes?.active.size||this.processes?.pending.size||this.unsettledOperations?.size||this.reconciling||this.agent?.running||[...this.agentRuns?.values()||[]].some(run=>run.running)||this.recordingKnowledge||this.databaseBusy||this.collaborationBusy||this.wikiInitController&&!this.wikiInitController.signal.aborted&&this.store?.get('wiki-init')?.state==='running'||this.wikiUpdateRun||mail?.checking||mail?.connecting||mail?.synthesis||mail?.attachmentRead)fail('update_work_active');
    this.appUpdateLocked=true;clearInterval(mail?.processingTimer);mail?.disconnect();return {ready:true};
  }
  async invoke(method, args = {}) {
    if(this.appUpdateLocked)fail('update_installing');
    if(method==='prepareAppUpdate')return this.prepareAppUpdate();
    const allowed = new Set(['previewFile','browseDirectory','terminalCommand','projectPath','proposalText','artifactText','initializeWiki','wikiInitialization','saveSource','commitHistory','mailDocument','mail','wikiUpdate','analysisHistory','listSkills','removeSkill','skillMarketplace','connectSkillMarketplace','disconnectSkillMarketplace','importSkill','importVoc','queryVoc','readVoc','computer','applyNewFile','decideSetupAction','collaboration','codeOutline','recoverySnapshot','resumeAgent','diagnoseProcess','applyCommandRepair','knowledgeMap','knowledgeQuery','initializeKnowledgeCatalog','exportKnowledgeMap','databaseConnection','open','knowledgeStatus','recordKnowledge','comparison','connectKnowledge','overview','state','setShellPreference','read','search','wikiQuery','createTask','exportRequirement','createWorktree','propose','prepareProposal','proposalArtifacts','confirmProposal','mergeProposal','diff','run','exportReport','compare','provider','fabrix','agentInput','startAgent','answerAgent','saveQuestionDraft','stopAgent','deleteTask','approvalPolicy','setApprovalMode','allowCommand','removeAllowedCommand','autoApprovals']);
    allowed.add('gitAvailability');allowed.add('conversationHistory');allowed.add('usage');allowed.add('editorSource');allowed.add('regenerateAnswer');allowed.add('skillTrash');
    if (method === 'poll') { this.ready(); return this.processes.poll(args.id); }
    if (method === 'stop') { this.ready(); return this.processes.stop(args.id); }
    if (method === 'events') { this.ready(); return this.store.events(args.after); }
    if ((!allowed.has(method)&&!['workspaceChanges','appliedFileSummary'].includes(method)) || typeof this[method] !== 'function') fail('method_invalid');
    return method==='open'?this.open(args.root,{kind:args.kind,initializeWiki:args.initializeWiki,exactRoot:args.exactRoot}):this[method](args);
  }
  dispose() { this.usageLedger?.close(); this.wikiInitController?.abort(); this.wikiUpdateRun?.controller.abort(); this.localPerception?.dispose();this.marketplaceController?.abort();this.marketplaceToken=null;this.marketplaceConnected=false;this.marketplaceCatalog=null;this.personalMail?.dispose();this.computerPointer?.dispose();this.computerLauncher?.dispose?.();this.computerAdapter?.dispose?.();void this.collaborationServer?.close();this.disposed=true;this.recoveryQueue?.clear();this.databaseWorker?.terminate(); this.databaseConnections?.clear(); this.knowledge?.server.close(); for(const run of this.agentRuns?.values()||[])run.controller?.abort();this.lastAgent?.controller?.abort(); this.providers?.dispose(); for(const entry of this.fabrixTests?.values()||[])entry.provider.dispose();this.fabrixTests?.clear(); this.processes?.dispose(); }
}

installDesktopFeatures(ProjectService);
installProjectBrowser(ProjectService);
