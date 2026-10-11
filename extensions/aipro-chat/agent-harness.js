import {rankEvidence} from './evidence-search.js';

// Capability selection never adds permissions: this catalog only contains
// tools already granted to this request by the service worker.
const groups = Object.freeze({
  knowledge: ['ask_openwiki', 'search_site_wiki', 'read_site_wiki'],
  documents: ['ask_documents', 'search_documents', 'read_document'],
  workflows: ['find_skills', 'read_skill'],
  integrations: ['list_mcp_tools', 'call_mcp_tool'],
  analysis: ['read_analysis_evidence', 'cancel_analysis', 'read_analysis_handoff'],
  input: ['fill_site_procedure','fill_form', 'verify_form', 'select_option'],
  interaction: ['drag_element', 'click_element', 'hover_element', 'press_key', 'scroll_page', 'wait_page'],
  navigation: ['open_site_procedure','navigate_page', 'list_tabs', 'switch_tab', 'go_back'],
  scripts: ['run_playwright', 'run_skill_script'],
  images: ['find_images', 'inspect_images', 'attach_images', 'capture_page', 'click_at'],
  storage: ['list_page_storage', 'read_page_storage'],
  diagnostics: ['read_browser_diagnostics'],
  files: ['list_upload_files','list_upload_targets','prepare_file_upload','prepare_download','download_status'],
  voc: ['collect_voc','search_voc','read_voc','download_voc_attachment','export_voc'],
  project: ['wiki_query', 'wiki_search', 'wiki_read', 'source_search', 'read_source'],
  agents: ['delegate_to_agent', 'check_delegation'],
});
const purposes = Object.freeze({
  knowledge: '내장/외부 위키에 질문하고 출처 조회. Ask Wiki agents or read site knowledge.',
  documents: '첨부 문서 검색, 구간 읽기와 분할 분석. Search, read or delegate document questions.',
  workflows: '등록된 스킬 검색과 지침 읽기. Discover workflow instructions.',
  integrations: '연결된 외부 도구 목록과 호출. Discover granted integration tools.',
  analysis: '하위 분석의 인용 원문, 인계 조회와 취소. Inspect or cancel existing analysts.',
  input: '입력란 채우기, 선택값 설정과 양식 검증. Fill or verify observed form fields and set options.',
  interaction: '링크 클릭, 메뉴 호버, 토글, 키보드, 스크롤과 드래그. Interact with observed controls.',
  navigation: '페이지 이동, 탭 찾기와 전환, 뒤로 가기. Navigate within owned browser tabs.',
  scripts: '짧은 브라우저 JavaScript 또는 등록된 스킬 스크립트 실행. No Node or Python.',
  images: '이미지 검색, 시각 비교, 다운로드 첨부, 화면 캡처와 좌표 클릭. Inspect visual evidence.',
  storage: '페이지 저장소의 키 목록과 필요한 값 읽기. Inspect only requested browser storage.',
  files: '대화 첨부 파일 업로드, 승인 후 파일 다운로드와 완료 상태 추적. Upload attachments and track downloads.',
  diagnostics: '페이지 오류와 실패한 네트워크 상태 확인. Read console errors and network failures without replaying actions.',
  voc: 'JSM 고객 요청과 VOC 티켓 수집, 검색, 첨부 다운로드와 폴더 보관.',
  project: 'OpenWiki에서 소스코드와 변경 영향 근거 검색. Query connected project evidence.',
  agents: '연결된 누비 Workspace에 소스 검색, 지식 조회, 문서 분석, OpenWiki 질문을 맡기고 결과 확인. Delegate to the paired Nubi Workspace app.',
});
// Optional source/skill schemas are discovered on demand. Keep delegation and
// collection ready without charging every simple task for all source readers.
// report_facts is granted only to a run of a task another Nubi sent.
const core = ['request_approval', 'ask_user', 'read_page', 'inspect_dom', 'browser_snapshot', 'capture_page', 'update_plan', 'verify_page', 'delegate_analysis', 'collect_analysis', 'report_facts', 'delegate_research'];
export const MUTATING_TOOLS = new Set(['open_site_procedure','drag_element', 'apply_approved_action','fill_site_procedure','fill_form', 'select_option', 'click_element', 'press_key', 'navigate_page', 'switch_tab', 'go_back', 'run_playwright', 'run_skill_script', 'click_at']);
const navigationTools = new Set(['navigate_page', 'switch_tab', 'go_back']);
// These host implementations mark issuance before dispatch, including partial
// writes. An explicit false adds no verification debt; it never clears earlier
// debt or proves the page unchanged (focus/hover preparation may have run).
// click_at is deliberately excluded: its catch receipt is not yet a reliable
// pre-dispatch boundary. Keep unclassified/unknown outcomes conservative.
const noDispatchTools = new Set(['open_site_procedure','fill_site_procedure','click_element', 'press_key', 'drag_element', 'fill_form', 'select_option', 'run_playwright', 'run_skill_script']);
export const hasReliableUnissuedReceipt = name => noDispatchTools.has(name);
// Navigation invalidates observations, but a fresh page read is its outcome
// check. A site write still needs an explicit value/control confirmation.
export function requiresVerification(name, result) {
  return MUTATING_TOOLS.has(name) && !navigationTools.has(name) && result?.navigationOnly !== true &&
    !(hasReliableUnissuedReceipt(name) && result?.actionIssued === false);
}
// A fill whose every field read back the value just written, with no other
// observed field changed and no written field reported invalid, is its own
// outcome check. A separate verify_page of the same values cost two model calls
// (a blocked update_plan, then the check) in the simplest measured form task.
export function hostVerifiedFill(name, result) {
  return name === 'fill_form' && result?.ok === true && result.verified === true && result.actionIssued !== false && !result.error &&
    Number.isSafeInteger(result.applied) && result.applied > 0 && result.matched === result.applied &&
    !(result.effect?.fieldsChanged?.count > 0) && !(result.invalidFields > 0) && !(result.otherFields?.changed > 0) && !(result.otherFields?.missing > 0);
}
const viewActions = new Set(['hover', 'scroll', 'scrollIntoViewIfNeeded']);
export function changesObservation(name, result) {
  if (['run_playwright', 'run_skill_script'].includes(name) && result?.actionIssued === false) return result.execution?.commands?.some(command => viewActions.has(command.method)) === true;
  return MUTATING_TOOLS.has(name) || ['hover_element', 'scroll_page'].includes(name);
}

// Moving between pages, clicking and typing were needed in most measured
// tasks, and their schemas are small. Loading them on demand cost one whole
// inference each time and changed the tool list in the middle of a run. They
// are offered from the start unless the model's input window is small. Large
// or rare schemas (scripts, images, files, storage, knowledge) stay on demand.
// Registered skills are offered with them: finding and reading a skill is
// how a request reaches its procedure, and the two schemas are small.
const basics = ['navigation', 'interaction', 'input', 'workflows'];
export const LEAN_INPUT_TOKENS = 32000;
// Only a host-owned receipt issued during this approval continuation can seed
// its own transfer debt. General resumes and unknown prior writes stay pending.
export function ownedApprovedDownload(receipt) {
  return receipt?.name === 'apply_approved_action' && ['passed','not_required'].includes(receipt.priorVerification?.status) &&
    receipt.result?.ok === true && receipt.result.actionIssued === true && !receipt.result.error &&
    receipt.result.transfer?.kind === 'download' && typeof receipt.result.transfer.transfer_id === 'string' &&
    receipt.result.transfer.transfer_id.length > 0 && receipt.result.transfer.transfer_id.length <= 100;
}
export function createHarness(tools, {resumeVerification = false, inputBudget, approvedActionReceipt, resumeUncertainAction = false} = {}) {
  const catalog = Object.fromEntries(Object.entries(groups).map(([group, names]) => [group, names.filter(name => tools.some(tool => tool.function.name === name))]).filter(([, names]) => names.length));
  const lean = Number.isFinite(inputBudget) && inputBudget < LEAN_INPUT_TOKENS;
  const connected = lean ? [] : basics.filter(group => catalog[group]?.length);
  const initial = [...core, ...connected.flatMap(group => catalog[group])];
  const enabled = new Set(initial);
  // Groups that are already connected are named as such. Listing them as
  // selectable made the model ask for tools it already had.
  const overview = Object.fromEntries(Object.entries(catalog).filter(([group]) => !connected.includes(group)).map(([group,names]) => [group,{purpose:purposes[group],tools:names}]));
  const selector = {type: 'function', function: {name: 'select_tools', description: `Find and connect authorized tools for the next step. Supply query (a concrete task, Korean or English, e.g. "입력란 채우기" or "hover menu") or groups, or both. A query selects at most five lexical matches, not a certainty or permission to act; inspect their schemas on the next request. Refine an empty match or choose a group. Set replace:true when changing phase to remove earlier optional schemas from context. ${connected.length ? `Already connected, do not select: ${connected.map(group => `${group} (${catalog[group].join(', ')})`).join('; ')}. ` : ''}Available groups: ${JSON.stringify(overview)}. No software installation, page connection, action execution or permission change occurs.`, parameters: {type: 'object', properties: {query:{type:'string',minLength:1,maxLength:300}, groups: {type: 'array', minItems: 1, maxItems: 6, items: {type: 'string', enum: Object.keys(catalog)}},replace:{type:'boolean'}}, additionalProperties: false}}};
  let revision = 0, verifiedRevision = -1, needsVerification = resumeVerification, corrections = 0, pendingDownload, uncertainAction = resumeUncertainAction;
  const harness = {
    selector,
    advertised: () => [...tools.filter(tool => enabled.has(tool.function.name)), selector],
    select(args) {
      const selectedGroups = args?.groups || [];
      if (!args || !Array.isArray(selectedGroups) || selectedGroups.length > 6 || selectedGroups.some(group => !catalog[group]) ||
          args.query !== undefined && (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 300) ||
          !selectedGroups.length && !args.query || args.replace !== undefined && typeof args.replace !== 'boolean') return {error:'tool_arguments_invalid'};
      const found = args.query ? rankEvidence(tools.map(({function:fn}) => ({id:fn.name,name:fn.name,context:fn.description || '',text:Object.entries(catalog).filter(([,names])=>names.includes(fn.name)).map(([group])=>purposes[group]).join(' ')})),args.query).slice(0,5) : [];
      const selected = new Set([...selectedGroups.flatMap(group=>catalog[group]),...found.map(hit=>hit.id)]);
      // Empty discovery must not silently erase the current working set.
      if (selected.size && args.replace) {enabled.clear();for (const name of initial) enabled.add(name);}
      for (const name of selected) enabled.add(name);
      return {ok: true, tools: tools.filter(tool => enabled.has(tool.function.name)).map(tool => tool.function.name), matches:found.map(hit=>{const fn=tools.find(tool=>tool.function.name===hit.id).function;return {name:fn.name,description:(fn.description || '').slice(0,500),matchedTerms:hit.match.terms};}), instruction:selected.size ? 'Inspect the selected schemas, observe the target, then act and verify. Selection itself performed no work.' : 'No matching tool. Refine the query using task terms or choose a listed group; do not invent a tool.'};
    },
    observe(name, result) {
      // A successful page assertion cannot settle an earlier input whose exact
      // outcome the host still cannot establish. Preserve that independent debt.
      if (result?.unresolvedAction === true) uncertainAction = true;
      if (name === 'verify_page' && result?.ok === true && result?.verified === true && result?.reconciledAction === true && !result?.unresolvedAction) uncertainAction = false;
      // Load only explicitly referenced, already-authorized tools after reading
      // actual request-bound workflow content. A search hit never activates it.
      if (name === 'read_skill' && result?.ok === true && result.dataKind === 'skill_reference') {
        const mentioned = new Set(String(result.content || '').match(/[A-Za-z_][A-Za-z_0-9]*/g) || []);
        if (result.path === 'SKILL.md' && result.resources?.some(resource => resource.execution === 'browser_sandbox')) mentioned.add('run_skill_script');
        for (const tool of tools.filter(tool=>mentioned.has(tool.function.name)).slice(0,6)) enabled.add(tool.function.name);
      }
      // A permitted call recalled from earlier context also selects its group.
      // Worker capability checks and runtime schema validation still apply.
      for (const names of Object.values(catalog)) if (names.includes(name)) for (const tool of names) enabled.add(tool);
      // Correct a failed generated script with already-authorized semantic
      // tools as well. This never grants permissions or replays an action.
      if (['run_playwright', 'run_skill_script'].includes(name) && (result?.error || result?.ok === false) && result?.error !== 'cancelled') {
        for (const group of ['input', 'interaction', 'navigation', 'diagnostics']) for (const tool of catalog[group] || []) enabled.add(tool);
      }
      if ((name === 'verify_page' && !result?.verified || name === 'wait_page' && result?.wait?.timedOut) && result?.error !== 'cancelled') for (const tool of catalog.diagnostics || []) enabled.add(tool);
      if (result?.visualRecovery) for (const tool of catalog.images || []) enabled.add(tool);
      if (requiresVerification(name, result) && !result?.cancelled) {
        const earlierDebt=needsVerification && verifiedRevision!==revision;
        revision++; needsVerification = true;
        pendingDownload=!earlierDebt && name==='apply_approved_action' && result?.ok===true && !result.error &&
          result.transfer?.kind==='download' && typeof result.transfer.transfer_id==='string' && result.transfer.transfer_id.length<=100
          ? {id:result.transfer.transfer_id,revision} : undefined;
      }
      // A page check cannot establish a Chrome download's completion. Only the
      // matching owned receipt resolves this action, and never earlier page debt.
      if(name==='download_status' && pendingDownload?.revision===revision && result?.dataKind==='download_status' &&
          result.transfer_id===pendingDownload.id && result.state==='complete' && result.completionVerified===true && !result.error) {
        verifiedRevision=revision;pendingDownload=undefined;corrections=0;
      }
      if (hostVerifiedFill(name, result)) verifiedRevision = revision;
      if (name === 'verify_page') {
        // Even a read-only task can fail an explicit goal assertion. Keep the
        // runner aligned with the durable host instead of reviewing a false pass.
        if (result?.error !== 'cancelled' && !result?.cancelled) needsVerification = true;
        verifiedRevision = result?.ok === true && result?.verified === true && !pendingDownload && !uncertainAction ? revision : -1;
        // A verified stage starts a new repair window. Reads, new references,
        // further writes and failed checks cannot reset a stalled stage.
        if (verifiedRevision === revision) corrections = 0;
      }
    },
    needsCheck: () => uncertainAction || needsVerification && verifiedRevision !== revision,
    repairMessage() {
      if (++corrections > 2) return null;
      if (uncertainAction) return {role:'user',content:'Host result check: an earlier action remains unresolved even though the latest page assertions passed. The original dispatched target/outcome was not established. Do not report completion, repeat the action, or use another tab as proof. Call ask_user with a focused request to inspect the current page and wait; a fresh observation or model review alone cannot clear this host restriction.',timestamp:Date.now()};
      return {role: 'user', content: 'Harness result check: the browser actions have not yet passed a fresh verify_page check. Do not report completion. Inspect the current result, then call verify_page with concrete checks derived from the original user goal (all required fields and the relevant visible saved/sent/navigation outcome). A click, plan status, script return value or screenshot alone is not proof. If checks fail, correct from the current state without replaying completed writes. If fresh evidence does not establish how to proceed or required information is missing, call ask_user with a focused question and wait. Do not guess, silently stop, or claim success.', timestamp: Date.now()};
    },
  };
  if (!resumeUncertainAction && ownedApprovedDownload(approvedActionReceipt)) {
    needsVerification = false;
    harness.observe('apply_approved_action', approvedActionReceipt.result);
  } else if (approvedActionReceipt?.name === 'apply_approved_action' && approvedActionReceipt.result?.ok === true && !approvedActionReceipt.result.error) {
    // Approval runs in the trusted host before this runner is created. Seed
    // that actual action too: the durable task is already awaiting its check.
    // A model review or a resumed snapshot cannot substitute for that check.
    // Downloads above have their own receipt path and must not be seeded twice.
    harness.observe('apply_approved_action', approvedActionReceipt.result);
  }
  return harness;
}
