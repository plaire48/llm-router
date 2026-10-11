// Host dispatch history, not model narration or a claim about server state.
import {publicSourceURL} from './browser-public-url.js';
import {LOCATOR_ACTIONS, LOCATOR_READS, PAGE_METHODS, BROWSER_METHODS} from './browser-script-api.js';
import {SCRIPT_FAILURES} from './script-feedback.js';
import {normalizeScriptInputReceipt} from './browser-script-receipt.js';
const commandMethods = new Set([...LOCATOR_ACTIONS, ...LOCATOR_READS, ...PAGE_METHODS, ...BROWSER_METHODS, 'unsupported']);
const commandStates = new Set(['started', 'returned', 'failed']);
// Shared by saved evaluator diagnostics and review dispatch history. The
// caller must supply host execution metadata, never a generated script return.
export function normalizeScriptCommandEvidence(execution) {
  const commands = Array.isArray(execution?.commands) ? execution.commands : [];
  const extraOmitted = Math.max(0, commands.length - 32);
  const omissionKnown = Number.isSafeInteger(execution?.omitted) && execution.omitted >= 0 &&
    Number.isSafeInteger(execution.omitted + extraOmitted);
  let valid = Array.isArray(execution?.commands) && omissionKnown;
  const retained = commands.slice(-32).map(command => {
    const method = commandMethods.has(command?.method) ? command.method : 'unsupported';
    const state = commandStates.has(command?.state) ? command.state : 'unknown';
    const actionIssued = typeof command?.actionIssued === 'boolean' ? command.actionIssued : null;
    const reasonKnown = command?.reason === undefined || Object.hasOwn(SCRIPT_FAILURES, command.reason);
    valid &&= commandMethods.has(command?.method) && state !== 'unknown' && actionIssued !== null && reasonKnown;
    const inputReceipt = normalizeScriptInputReceipt(command?.inputReceipt,{method,state,actionIssued});
    return {method, state, actionIssued, ...(command?.reason && reasonKnown ? {reason: command.reason} : {}),
      ...(inputReceipt ? {inputReceipt} : {})};
  });
  return {status: valid ? 'observed' : 'unknown', commands: retained, omitted: omissionKnown ? execution.omitted + extraOmitted : null,
    ...(!valid ? {reason: 'script_command_receipt_invalid'} : {})};
}
function scriptReceipt(dispatchId, result) {
  return {dispatchId, tool: 'run_playwright', outcome: !result || result.error ? 'error' : 'returned',
    actionIssued: typeof result?.actionIssued === 'boolean' ? result.actionIssued : null,
    ...normalizeScriptCommandEvidence(result?.execution)};
}
// A procedure row is the host's read-only preparation RPC. Its runner
// expansion is separately recorded as fill_form/click_element, including lost receipts.
const readOnly = new Set(['open_site_procedure','fill_site_procedure','ask_user','select_tools','update_plan','read_page','inspect_dom','browser_snapshot','verify_page','verify_form','list_tabs','read_browser_diagnostics','list_page_storage','read_page_storage','find_images','inspect_images','attach_images','capture_page','find_skills','read_skill','search_site_wiki','read_site_wiki','search_documents','read_document','ask_documents','ask_openwiki','wiki_query','wiki_search','wiki_read','source_search','read_source','delegate_analysis','collect_analysis','read_analysis_evidence','cancel_analysis','list_upload_files','list_upload_targets','download_status']);
// Navigation can have server/account effects. It proves no page interaction
// dispatch only, never read-only execution or unchanged external state.
// Dedicated researchers can navigate reference tabs, so they are not pure
// observation. Their host cannot dispatch click, input, script or approval.
const noPageInteraction = new Set([...readOnly, 'navigate_page', 'delegate_research']);
// Uniform attribution across semantic input and clicks. This establishes what
// was targeted, never whether the operation was permitted or succeeded.
function interactionTargetCoverage(ledger) {
  const calls = ledger.calls || [];
  const interactions = calls.filter(call => !noPageInteraction.has(call.tool));
  if (ledger.taskStartObserved !== true || !interactions.length) return 'not_established';
  for (const {tool,count} of interactions) {
    if (!Number.isSafeInteger(count) || count <= 0) return 'not_established';
    if (tool === 'click_element' || tool === 'select_option') {
      const rows = (tool === 'click_element' ? ledger.clickTargetReceipts : ledger.selectionTargetReceipts) || [];
      const omitted = tool === 'click_element' ? ledger.clickTargetReceiptsOmitted : ledger.selectionTargetReceiptsOmitted;
      if (omitted !== 0 || rows.length !== count ||
          rows.some(row => row.status !== 'observed' || row.outcome !== 'returned' || row.actionIssued !== true || !row.target)) return 'not_established';
    } else if (tool === 'fill_form' || tool === 'press_key') {
      const rows = (ledger.semanticInputReceipts || []).filter(row => row.tool === tool);
      if (ledger.semanticInputReceiptsOmitted !== 0 || rows.length !== count || rows.some(row =>
          row.status !== 'observed' || row.outcome !== 'returned' || row.omitted !== 0 || !row.commands?.length ||
          row.commands.some(command => command.state !== 'returned' || command.actionIssued !== true ||
            command.method !== (tool === 'fill_form' ? 'fill' : 'press') || command.inputReceipt?.targetStatus !== 'observed'))) return 'not_established';
    } else return 'not_established';
  }
  return 'complete';
}
// Model-facing projection only. The original dispatch ledger and diagnostic
// snapshot stay unchanged; tool categories never decide user-policy compliance.
export function projectReviewExecution(ledger) {
  if(ledger?.dataKind!=='host_tool_dispatch')return ledger;
  if(ledger.reviewView==='dispatch_facts_v1')return structuredClone(ledger);
  const {onlyReadOnlyToolsInvoked,noPageInteractionToolsInvoked,allPageInteractionTargetsObserved,searchAndReadOnly,scopeNote,...facts}=ledger;
  const absenceCertificates=[];
  if(ledger.taskStartObserved===true && ledger.calls?.length) {
    if(onlyReadOnlyToolsInvoked===true)absenceCertificates.push('only_observation_or_coordination_tools_dispatched');
    if(noPageInteractionToolsInvoked===true)absenceCertificates.push('no_click_input_or_script_tool_dispatched');
    if(searchAndReadOnly===true)absenceCertificates.push('only_search_input_and_link_navigation_dispatched');
  }
  return {...structuredClone(facts),reviewView:'dispatch_facts_v1',absenceCertificates,
    interactionTargetCoverage:interactionTargetCoverage(ledger),
    semanticClickTargetCoverage:allPageInteractionTargetsObserved===true && ledger.taskStartObserved===true ? 'complete' : 'not_established',
    scopeNote:'Observed dispatch facts, not an allowed/forbidden verdict. only_search_input_and_link_navigation_dispatched means every issued input went to an observed search field and every issued click to an observed link or search button; nothing else was dispatched. An empty absenceCertificates array only means no narrow absence proof is available; it never proves a violation. Certificates apply only to this fully observed run, not prior activity or unchanged account/server state. interactionTargetCoverage covers the full set of recorded semantic fill/Enter/click/select targets only when complete. Compare each actual target and the requested operation; complete attribution is not permission or unchanged-state proof. semanticClickTargetCoverage is the narrower click-only field and cannot negate known input targets. Calls and individual receipts retain actual issuance, targets, readbacks, missing and omitted evidence. Compare them with the original request: requested search and information navigation are not business writes by tool name alone. Preserve explicit no-click/no-input restrictions. Unknown targets or outcomes stay unknown. No automatic permission, task success or current-state claim is made.'};
}
export function createReviewExecution({taskStartObserved}) {
  const counts = new Map(), clicks = new Map(), selections = new Map(), scripts = new Map(), inputs = new Map(), bindable = new Set(), reviewValues = new Map();
  let sequence = 0, omitted = 0, selectionOmitted = 0, scriptOmitted = 0, inputOmitted = 0, reviewValueCharacters = 0, reviewValuesOmitted = 0;
  return {
    record(name) {
      counts.set(name,(counts.get(name)||0)+1);
      const dispatchId = ++sequence;
      if (name === 'click_element') {
        if (clicks.size < 64) clicks.set(dispatchId, {dispatchId, tool: name, outcome: 'pending', status: 'unknown', actionIssued: null, reason: 'result_missing'});
        else omitted++;
      }
      if (name === 'select_option') {
        if (selections.size < 64) selections.set(dispatchId,{dispatchId,tool:name,outcome:'pending',status:'unknown',actionIssued:null,reason:'result_missing'});
        else selectionOmitted++;
      }
      if (name === 'run_playwright') {
        if (scripts.size < 64) scripts.set(dispatchId, {dispatchId, tool: name, outcome: 'pending', status: 'unknown',
          actionIssued: null, commands: [], omitted: null, reason: 'result_missing'});
        else scriptOmitted++;
      }
      if (name === 'fill_form' || name === 'press_key') {
        if (inputs.size < 64) inputs.set(dispatchId,{dispatchId,tool:name,outcome:'pending',status:'unknown',actionIssued:null,commands:[],omitted:null});
        else inputOmitted++;
      }
      return dispatchId;
    },
    complete(dispatchId, result) {
      const input = inputs.get(dispatchId);
      if (input) {
        if (input.outcome !== 'pending') return false;
        const retained = {dispatchId,tool:input.tool,outcome:!result || result.error || result.cancelled ? 'error' : 'returned',
          actionIssued:typeof result?.actionIssued === 'boolean' ? result.actionIssued : null,
          ...normalizeScriptCommandEvidence(result?.inputExecution)};
        inputs.set(dispatchId,retained);
        // Eligibility is all-or-nothing for a form. Partial, failed, cancelled,
        // unsupported and changed-target writes must not retain argument text.
        if (input.tool === 'fill_form' && result?.ok === true && result.verified === true && result.actionIssued === true &&
            !result.error && !result.cancelled && !result.unresolvedAction && result.recovery?.execution !== 'unknown' &&
            retained.status === 'observed' && retained.omitted === 0 && retained.commands.length > 0 &&
            result.applied === retained.commands.length && result.matched === result.applied &&
            retained.commands.every(command => command.method === 'fill' && command.state === 'returned' && command.actionIssued === true &&
              command.inputReceipt?.targetStatus === 'observed' && command.inputReceipt.readback?.status === 'observed' &&
              command.inputReceipt.readback.matchesExpected === true)) bindable.add(dispatchId);
        return true;
      }
      const script = scripts.get(dispatchId);
      if (script) {
        if (script.outcome !== 'pending') return false;
        // Historical host invocation metadata only. Never copy the generated
        // script, its own return value, arguments or page body. Only the
        // separately validated host input-target certificate may survive.
        scripts.set(dispatchId, scriptReceipt(dispatchId, result));
        return true;
      }
      const selection = selections.has(dispatchId), records = selection ? selections : clicks;
      const pending = records.get(dispatchId);
      if (!pending || pending.outcome !== 'pending') return false;
      const receipt = selection ? result?.selectionTargetReceipt : result?.actionTargetReceipt, target = receipt?.target;
      const actionIssued = typeof result?.actionIssued === 'boolean' ? result.actionIssued : null;
      const item = {dispatchId, tool: pending.tool, outcome: !result || result.error || result.cancelled || result.unresolvedAction ? 'error' : 'returned',
        status: 'unknown', actionIssued, reason: 'target_receipt_missing_or_invalid'};
      const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
      if (receipt?.dataKind === (selection ? 'selection_target_dispatch' : 'click_target_dispatch') && receipt.version === 1 && receipt.actionIssued === actionIssued && actionIssued !== null) {
        if (receipt.status === 'unknown') item.reason = /^[a-z_]{1,64}$/.test(receipt.reason || '') ? receipt.reason : 'target_unknown';
        if (receipt.status === 'observed' && actionIssued === true && target && Number.isSafeInteger(target.tabId) && target.tabId >= 0 &&
            Number.isSafeInteger(target.frameId) && target.frameId >= 0 && bounded(target.documentId, 128) && bounded(target.topDocumentId, 128) &&
            typeof target.name === 'string' && target.name.length < 180 && typeof target.role === 'string' && target.role.length <= 80 &&
            /^[a-z][a-z0-9-]{0,63}$/.test(target.tag || '') && (!selection || target.tag === 'select')) {
          const href = target.href && publicSourceURL(target.href);
          item.status = 'observed'; delete item.reason;
          item.target = {tabId: target.tabId, frameId: target.frameId, documentId: target.documentId,
            topDocumentId: target.topDocumentId, role: target.role, name: target.name, tag: target.tag,
            ...(href ? {href} : {}), ...(target.hrefOmitted || target.href && !href ? {hrefOmitted: true} : {})};
        }
      }
      records.set(dispatchId, item);
      return true;
    },
    async bindInputArguments(dispatchId, args) {
      if (!bindable.delete(dispatchId)) return false;
      const receipt = inputs.get(dispatchId), fields = args?.fields;
      if (!Array.isArray(fields) || fields.length !== receipt.commands.length ||
          fields.some(field => typeof field?.value !== 'string' || field.value.length > 512)) return false;
      // Copy before the first await; these are already supplied tool arguments,
      // not new DOM reads. Only the review-only view may contain these values.
      const values = fields.map(field => field.value), retained = [];
      for (let index = 0; index < values.length; index++) {
        const value = values[index];
        const expectedDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
        if (expectedDigest !== receipt.commands[index].inputReceipt.readback.expectedDigest) return false;
        retained.push({dispatchId,inputIndex:index,expectedDigest,value});
      }
      const characters = values.reduce((total,value)=>total+value.length,0);
      if (reviewValueCharacters + characters > 8192) {reviewValuesOmitted += retained.length;return false;}
      reviewValueCharacters += characters;
      reviewValues.set(dispatchId,retained);
      return true;
    },
    reviewSnapshot() {
      return {...this.snapshot(),historicalInputValues:structuredClone([...reviewValues.values()].flat()),historicalInputValuesOmitted:reviewValuesOmitted};
    },
    snapshot() {
      const calls=[...counts].map(([tool,count])=>({tool,count}));
      const interactions = calls.filter(call => !noPageInteraction.has(call.tool));
      const clickCount = counts.get('click_element') || 0;
      // Searching and following links is how information is looked up. The host
      // can state that nothing else was dispatched: every issued input went to
      // an observed search field, every issued click to an observed link or a
      // search button, and the remaining tools only scrolled, hovered or waited.
      const searchField = target => target?.tag === 'input' && (target.type === 'search' || target.role === 'searchbox' || /검색|search/i.test(target.name || ''));
      const lookupClick = target => target?.tag === 'a' && target.role === 'link' ||
        target?.role === 'button' && /^(?:(?:AI|통합|전체|웹)\s*)?(?:검색|찾기|search|find)$/i.test(target.name || '');
      const searchAndReadOnly = taskStartObserved === true && interactions.length > 0 && inputs.size + clicks.size > 0 &&
        interactions.every(call => ['fill_form', 'press_key', 'click_element', 'scroll_page', 'hover_element', 'wait_page'].includes(call.tool)) &&
        inputOmitted === 0 && omitted === 0 && inputs.size === (counts.get('fill_form') || 0) + (counts.get('press_key') || 0) && clicks.size === clickCount &&
        [...inputs.values()].every(row => row.actionIssued === false || row.status === 'observed' && row.omitted === 0 && row.commands.length > 0 &&
          row.commands.every(command => command.actionIssued === false || ['fill', 'press'].includes(command.method) &&
            command.inputReceipt?.targetStatus === 'observed' && searchField(command.inputReceipt.target))) &&
        [...clicks.values()].every(item => item.actionIssued === false || item.status === 'observed' && lookupClick(item.target));
      return {ok:true,dataKind:'host_tool_dispatch',scope:'current_run',taskStartObserved:taskStartObserved===true,searchAndReadOnly,
        calls, semanticInputReceipts: structuredClone([...inputs.values()]), semanticInputReceiptsOmitted:inputOmitted, clickTargetReceipts: structuredClone([...clicks.values()]), clickTargetReceiptsOmitted: omitted,
        selectionTargetReceipts:structuredClone([...selections.values()]),selectionTargetReceiptsOmitted:selectionOmitted,
        scriptCommandReceipts: structuredClone([...scripts.values()]), scriptCommandReceiptsOmitted: scriptOmitted,
        allPageInteractionTargetsObserved: taskStartObserved === true && clickCount > 0 &&
          interactions.every(call => call.tool === 'click_element') && omitted === 0 && clicks.size === clickCount &&
          [...clicks.values()].every(item => item.status === 'observed' && item.actionIssued === true),
        onlyReadOnlyToolsInvoked:calls.length>0 && calls.every(call=>readOnly.has(call.tool)),
        noPageInteractionToolsInvoked:taskStartObserved===true && calls.length>0 && calls.every(call=>noPageInteraction.has(call.tool)),
        scopeNote:'Records admitted leader tool dispatch only. Historical scriptCommandReceipts retain only bounded host command methods, states and issuance. Optional script_input_dispatch receipts attribute only bounded fill/Enter operations to an observed historical control. Fill readback proves only retained executed-argument equality at that time. The diagnostic snapshot retains no raw value. Review-only historicalInputValues, when present, bind already supplied arguments by digest and dispatch/inputIndex to a fully verified semantic fill. Compare those actual arguments to the original request; a digest alone does not prove the requested text. They are historical, not live values. Neither these nor command methods certify task success, permission, read-only compliance or current DOM/server state. Missing, pending, invalid and omitted commands remain unknown. Read-only analysts cannot issue browser actions. noPageInteractionToolsInvoked proves only no page click, input or script tool was invoked in this fully observed run. clickTargetReceipts identify only the observed semantic click target immediately before dispatch, never success or permission. allPageInteractionTargetsObserved proves only full target-attribution coverage for a nonempty set of semantic clicks in this fresh run, not compliance with any prohibition. Pending, unknown and omitted receipts leave target attribution unknown. semanticInputReceipts attribute bounded fill/Enter targets without changing these click-only coverage flags. Other action tools have no target coverage here. Review original prohibitions against these targets; no automatic allowed/forbidden classification is made. False tool-invocation flags are not a finding that a user prohibition was violated. Read-only research can permit observed information navigation, menus and requested search input; judge the actual targets and outcomes against the original request. Navigation may cause account or server effects. Does not prove unchanged account/server state, source facts, or activity before this run.'};
    },
  };
}
