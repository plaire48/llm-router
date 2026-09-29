// Isolated evaluation only. Drafts a site document and a skill from a finished
// run through the product's own buttons, then sets which of them the next run
// of the same task can use. Records counts and states, never drafted text.
const WHEN = /(?:때|경우|use when|when )/i;

export function knowledgeProbe({ui, rpc, state, report, save, keepText = async () => {}, timeoutMs = 180000}) {
  report.knowledgeProbe = {};
  // The skill is drafted from the baseline run and set aside while the site
  // document is measured, so that each phase differs in one thing only.
  const parked = new Map();
  const entry = id => report.knowledgeProbe[id] ||= {wiki: {status: 'not_attempted'}, skill: {status: 'not_attempted'}};
  const idle = async started => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const current = await state(), last = current.chat?.messages?.at(-1);
      if (!current.busy && last?.state !== 'pending' && Date.now() - started > 1500) return current;
      if (Date.now() > until) throw Error('probe_draft_timeout');
      await ui.waitForTimeout(500);
    }
  };
  const openActions = async () => {
    const panel = ui.getByRole('group', {name: '추가 기능', exact: true});
    if (!await panel.isVisible()) await ui.getByRole('button', {name: '추가', exact: true}).click();
    await panel.waitFor();
    return panel;
  };
  async function draftWiki(task) {
    const record = entry(task.id).wiki, before = await state();
    const offered = before.chat?.messages?.findLast(message => message.wikiOffer)?.wikiOffer;
    Object.assign(record, {status: 'not_offered', offered: offered?.status === 'offered', route: offered?.summary?.route?.length || 0});
    if (offered?.status !== 'offered') return;
    const started = Date.now();
    await ui.bringToFront();
    await ui.getByRole('button', {name: '초안 만들기', exact: true}).last().click();
    const current = await idle(started), last = current.chat?.messages?.at(-1);
    Object.assign(record, {draftMs: Date.now() - started});
    if (last?.question || current.chat?.task?.status === 'awaiting_user') {record.status = 'draft_asked_user'; return;}
    if (!last?.wikiDraft) {record.status = 'draft_failed'; record.error = String(last?.error || '').slice(0, 80); return;}
    const text = String(last.wikiDraft.markdown || '');
    // Drafted text is kept for local fixture pages only: their content is synthetic.
    if (task.environment === 'local-fixture') await keepText(`${task.id}-wiki.md`, `# ${last.wikiDraft.title}\n\n${text}\n`);
    Object.assign(record, {status: 'drafted', characters: text.length, headings: (text.match(/^#{1,4}\s/gm) || []).length,
      mentionsRoute: /경로|메뉴|이동/.test(text), mentionsCaution: /주의|확인할|다음에/.test(text), placeholders: (text.match(/\{[^{}\n]{1,20}\}/g) || []).length});
    await ui.getByRole('button', {name: '사이트 위키 검토', exact: true}).last().click();
    await ui.getByRole('button', {name: '위키 저장', exact: true}).click();
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const stored = await rpc({type: 'GET_BROWSER_KNOWLEDGE'});
      const entries = stored?.data?.entries || stored?.entries || [];
      if (entries.some(item => item.markdown)) {record.status = 'saved'; record.entries = entries.length; return;}
      await ui.waitForTimeout(300);
    }
    record.status = 'save_unconfirmed';
  }
  async function draftSkill(task) {
    const record = entry(task.id).skill, started = Date.now();
    await ui.bringToFront();
    const panel = await openActions();
    await panel.getByRole('button', {name: '스킬 선택', exact: true}).click();
    const create = ui.getByRole('button', {name: '작업으로 만들기', exact: true});
    if (!await create.isEnabled()) {record.status = 'source_missing'; await ui.keyboard.press('Escape'); return;}
    await create.click();
    const current = await idle(started), last = current.chat?.messages?.at(-1);
    Object.assign(record, {draftMs: Date.now() - started});
    if (last?.question || current.chat?.task?.status === 'awaiting_user') {record.status = 'draft_asked_user'; return;}
    const draft = last?.skillDraft?.skill;
    if (!draft) {record.status = 'draft_failed'; record.error = String(last?.error || '').slice(0, 80); return;}
    const procedure = draft.resources?.find(resource => resource.path === 'references/procedure.md')?.content || '';
    if (task.environment === 'local-fixture') await keepText(`${task.id}-skill.md`, [`# ${draft.name}`, `description: ${draft.description}`, `compatibility: ${draft.compatibility || ''}`, '', draft.instructions,
      ...(draft.resources || []).flatMap(resource => ['', `## ${resource.path}`, resource.content])].join('\n') + '\n');
    Object.assign(record, {status: 'drafted', nameCharacters: draft.name.length, descriptionCharacters: draft.description.length,
      descriptionSaysWhen: WHEN.test(draft.description), hasSite: /^대상 사이트: https?:\/\//.test(draft.compatibility || ''),
      instructionCharacters: draft.instructions.length, procedureCharacters: procedure.length, procedureSteps: (procedure.match(/^\s*(?:\d+[.)]|[-*])\s/gm) || []).length,
      resources: (draft.resources || []).map(resource => resource.path)});
    await ui.getByRole('button', {name: '스킬 초안 검토', exact: true}).last().click();
    await ui.getByRole('button', {name: '저장', exact: true}).click();
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      const saved = (await state()).skills?.filter(skill => skill.id.startsWith('custom-')) || [];
      if (saved.length) {record.status = 'saved'; record.skillId = saved.at(-1).id; parked.set(task.id, saved.at(-1)); return;}
      await ui.waitForTimeout(300);
    }
    record.status = 'save_unconfirmed';
  }
  const knowledge = async change => rpc({type: 'UPDATE_BROWSER_KNOWLEDGE', ...change});
  const reset = async () => {
    for (const skill of (await state()).skills?.filter(item => item.id.startsWith('custom-')) || []) await rpc({type: 'DELETE_SKILL', id: skill.id});
    await rpc({type: 'SELECT_SKILL', id: ''});
    await knowledge({clear: true, enabled: true});
  };
  return {
    // Returns false when the knowledge this phase measures does not exist.
    async prepare(task, phase) {
      const record = entry(task.id);
      if (phase === 'baseline') {await reset(); return true;}
      if (phase === 'wiki') {
        // Only the site document is present: the drafted skill waits outside the library.
        for (const skill of (await state()).skills?.filter(item => item.id.startsWith('custom-')) || []) await rpc({type: 'DELETE_SKILL', id: skill.id});
        await rpc({type: 'SELECT_SKILL', id: ''});
        return record.wiki.status === 'saved';
      }
      if (phase === 'skill-auto') {
        // The site document is switched off so that only the skill differs.
        await knowledge({enabled: false});
        if (record.skill.status !== 'saved' || !parked.has(task.id)) return false;
        await rpc({type: 'SAVE_SKILL', skill: parked.get(task.id)});
        if (!(await state()).skills?.some(skill => skill.id === record.skill.skillId)) {record.skill.status = 'restore_failed'; return false;}
        await rpc({type: 'SELECT_SKILL', id: ''});
        return true;
      }
      if (phase === 'skill-selected') {
        if (record.skill.status !== 'saved') return false;
        await rpc({type: 'SELECT_SKILL', id: record.skill.skillId});
        return true;
      }
      return true;
    },
    async after(task, phase, trial) {
      const tools = (trial.trace || []).map(step => step.tool);
      trial.knowledgeUse = {findSkills: tools.filter(tool => tool === 'find_skills').length, readSkill: tools.filter(tool => tool === 'read_skill').length,
        askWiki: tools.filter(tool => tool === 'ask_openwiki').length, selectTools: tools.filter(tool => tool === 'select_tools').length,
        browserSteps: tools.filter(tool => !['progress_note', 'update_plan', 'review_task', 'recover_model', 'select_tools', 'find_skills', 'read_skill'].includes(tool)).length};
      if (phase === 'baseline' && trial.status === 'answered') {
        await draftWiki(task).catch(error => {entry(task.id).wiki.status = 'draft_error'; entry(task.id).wiki.error = String(error?.message).slice(0, 120);});
        await ui.keyboard.press('Escape').catch(() => {});
        await draftSkill(task).catch(error => {entry(task.id).skill.status = 'draft_error'; entry(task.id).skill.error = String(error?.message).slice(0, 120);});
        await ui.keyboard.press('Escape').catch(() => {});
      }
      if (phase === 'skill-selected') await reset();
      await save();
    },
  };
}
