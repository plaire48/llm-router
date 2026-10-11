import {hostVerifiedFill} from './agent-harness.js';
import {formContract} from './site-procedures.js';
// Replay of a verified run without the model, as Nanobrowser and browser-use
// rerun a saved history: each recorded action is matched to the page as it is
// now and issued again. Their matcher compares XPath and attribute hashes and,
// by default, skips a step it cannot match. Here a target is matched by what the
// observation says about it (role, name, the rows and dialogs around it, its
// column, id) and a step that does not match exactly one control stops the
// replay: a skipped click in a form leaves the rest of the run acting on a page
// it did not expect.
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const contextKey = context => JSON.stringify((Array.isArray(context) ? context : []).map(item => [item?.role || '', clean(item?.name)]));
const identity = element => JSON.stringify([element?.role || '', clean(element?.name), contextKey(element?.context)]);
// Ids a framework generates change on every load ("react-select-3-input",
// ":r1:", "ext-gen12", a long hash); they identify nothing across visits.
const GENERATED_ID = /^(?:react-select|react-aria|mui-|radix-|headlessui-|downshift-|rc_select_|rc-tabs-|el-id-|ember\d|ext-gen|yui_|gwt-uid|j_id|uid-|:r)|(^|[-_:])(?:[0-9a-f]{8,}|\d{3,})(?=$|[-_:])/i;
const stableId = value => typeof value === 'string' && value && value.length <= 80 && !GENERATED_ID.test(value) ? value : '';
const frameAddress = frame => {
  try {const url = new URL(frame?.url); return `${url.origin}${url.pathname}`;} catch {return '';}
};

// What a replay needs to find a control again. Refs belong to one observation
// only, so they are never kept.
export function recordTarget(element, observation) {
  if (!element || typeof element !== 'object') return null;
  const frames = Array.isArray(observation?.frames) ? observation.frames : [];
  const frame = frames.find(item => Array.isArray(item?.elements) && item.elements.some(other => other?.ref === element.ref));
  const same = frame ? frame.elements.filter(other => other && identity(other) === identity(element)) : [];
  return {
    role: element.role || '', name: clean(element.name).slice(0, 200), kind: element.kind || '', tag: element.tag || '',
    ...(element.type ? {type: element.type} : {}),
    ...(Array.isArray(element.context) && element.context.length ? {context: element.context.map(item => ({role: item?.role || '', ...(item?.name ? {name: clean(item.name).slice(0, 200)} : {})}))} : {}),
    ...(element.column ? {column: clean(element.column).slice(0, 120)} : {}),
    ...(stableId(element.id) ? {id: element.id} : {}),
    ...(element.testId ? {testId: clean(element.testId).slice(0, 120)} : {}),
    ...(element.destination ? {destination: element.destination} : {}),
    ...(frame && frame.frame !== 0 ? {frame: frameAddress(frame) || 'child'} : {}),
    // The n-th of several controls that look the same (a list of "삭제" buttons
    // in one unnamed table) is found again only when the page has as many.
    ...(same.length > 1 ? {ordinal: same.findIndex(other => other.ref === element.ref), alike: same.length} : {}),
  };
}

function score(target, element) {
  if ((element.role || '') !== target.role || clean(element.name) !== target.name) return -1;
  if (target.tag && element.tag && element.tag !== target.tag) return -1;
  let points = 0;
  // A stable id or test id that was there must still be there: another value, or
  // none, is another control that only looks the same.
  if (target.id) {if (element.id !== target.id) return -1; points += 4;}
  if (target.testId) {if (clean(element.testId) !== target.testId) return -1; points += 4;}
  if (contextKey(element.context) === contextKey(target.context)) points += 3;
  else if (target.context?.length) {
    const names = new Set((element.context || []).map(item => clean(item?.name)).filter(Boolean));
    if (!target.context.some(item => item.name && names.has(item.name))) return -1;
    points += 1;
  }
  if (target.column) {if (clean(element.column) === target.column) points += 2; else return -1;}
  if (target.type && element.type === target.type) points += 1;
  if (target.destination && element.destination === target.destination) points += 1;
  return points;
}

// Finds the one control of the fresh observation that the recorded target was.
// Returns {element} or {error, candidates}: missing (nothing alike), ambiguous
// (several equally alike), covered (the control is under a dialog or overlay).
export function matchTarget(target, observation) {
  if (!target?.role && !target?.name) return {error: 'missing', candidates: 0};
  const frames = (Array.isArray(observation?.frames) ? observation.frames : []).filter(frame => Array.isArray(frame?.elements));
  const inFrame = frame => target.frame ? frame.frame !== 0 && (target.frame === 'child' || frameAddress(frame) === target.frame) : frame.frame === 0;
  const pool = frames.filter(inFrame).flatMap(frame => frame.elements).filter(element => element && typeof element === 'object' && element.ref);
  const scored = pool.map(element => ({element, points: score(target, element)})).filter(item => item.points >= 0);
  if (!scored.length) return {error: 'missing', candidates: 0};
  const best = Math.max(...scored.map(item => item.points)), top = scored.filter(item => item.points === best);
  let chosen = top.length === 1 ? top[0].element : null;
  // Controls that look the same are told apart by their place among them, only
  // when the page shows as many as the recorded run saw.
  if (!chosen && Number.isInteger(target.ordinal) && top.length === target.alike) chosen = top[target.ordinal]?.element || null;
  if (!chosen) return {error: 'ambiguous', candidates: top.length};
  if (chosen.coveredBy) return {error: 'covered', candidates: 1, coveredBy: chosen.coveredBy};
  return {element: chosen};
}

// Tools a replay issues again. A click at coordinates is repeated on the control
// it pressed, a tab switch on the tab with the same page, a script with its refs
// found again, a file transfer through the same approval. A run that changed the
// page in another way (an external tool's action) is not replayed.
const REPLAYED = new Set(['navigate_page', 'go_back', 'scroll_page', 'click_element', 'hover_element', 'press_key', 'select_option', 'fill_form',
  'wait_page', 'verify_page', 'request_approval', 'apply_approved_action', 'click_at', 'drag_element', 'switch_tab', 'run_playwright', 'run_skill_script',
  'prepare_download', 'prepare_file_upload']);
// Steps whose content lives only in memory (a script's code with its typed text,
// the attachments to upload): after a browser restart they cannot run again.
const MEMORY_STEPS = new Set(['run_playwright', 'run_skill_script', 'prepare_file_upload']);
const SCRIPT_REF = /browser\.ref\((['"])([^'"\\]{1,120})\1\)/g;
const CHANGES_PAGE = new Set(['drag_element', 'apply_approved_action', 'fill_form', 'select_option', 'click_element', 'press_key', 'navigate_page', 'switch_tab', 'go_back',
  'run_playwright', 'run_skill_script', 'click_at', 'prepare_file_upload', 'prepare_download', 'apply_approved_mcp']);
const TARGET_CHECKS = new Set(['field_value', 'field_contains', 'field_unchanged', 'field_valid', 'control_state']);
const pageOf = value => {try {const url = new URL(value); return /^https?:$/.test(url.protocol) ? `${url.origin}${url.pathname}` : '';} catch {return '';}};
const elementOf = (observation, ref) => (Array.isArray(observation?.frames) ? observation.frames : []).flatMap(frame => Array.isArray(frame?.elements) ? frame.elements : []).find(element => element?.ref === ref);

// One step of a run as a replay keeps it: what it acted on and how, never a ref.
// Typed and chosen values go to `values` under a slot name; the caller keeps
// them in memory only (chrome.storage.session), as field values are never saved.
// Returns {step, values}, {unreplayable} for a page change a replay cannot
// repeat, or null for a step that changed nothing (a read, a failed attempt).
export function recordStep(tool, args = {}, observation, result = {}, slot = (() => {let n = 0; return () => `v${n++}`;})(), {uploadTargets = {}} = {}) {
  // Upload targets are listed apart from the observation; the list is kept to name them.
  if (tool === 'list_upload_targets') return !result?.error && Array.isArray(result?.targets) ? {uploadTargets: Object.fromEntries(result.targets.filter(item => typeof item?.ref === 'string')
    .map(item => [item.ref, {label: clean(item.label).slice(0, 100), page: pageOf(item.url)}]))} : null;
  if (!REPLAYED.has(tool)) return CHANGES_PAGE.has(tool) && !(result?.error && result.actionIssued === false) ? {unreplayable: tool} : null;
  if (result?.error && !result.requiresUserInput) return result.actionIssued === true ? {unreplayable: 'uncertain'} : null;
  if (tool === 'verify_page' && result?.verified !== true) return null;
  const target = ref => {const element = elementOf(observation, ref); return element ? recordTarget(element, observation) : null;};
  const values = {};
  const keep = value => {const name = slot(); values[name] = value; return name;};
  // A click at a point, or an approval asked at one, is kept on the control it pressed.
  if (tool === 'click_at' || tool === 'request_approval' && !args.ref) {
    const found = result?.pointedRef ? target(result.pointedRef) : null;
    if (!found) return {unreplayable: 'point'};
    return {step: tool === 'click_at' ? {tool: 'click_element', target: found, args: {}, via: 'click_at'} : {tool, target: found, via: 'click_at'}, values};
  }
  if (tool === 'drag_element') {
    const [source, destination] = [target(args.source_ref), target(args.target_ref)];
    return source && destination ? {step: {tool, source, target: destination}, values} : {unreplayable: 'target'};
  }
  // Tab ids change from run to run; the tab is found again by its page and title.
  if (tool === 'switch_tab') {
    const page = pageOf(result?.observation?.url);
    return page ? {step: {tool, page, title: clean(result.observation.title).slice(0, 180)}, values} : {unreplayable: 'tab'};
  }
  // A script's code holds the text it types, so it stays in memory; its refs are found again.
  if (tool === 'run_playwright') {
    if (typeof args.code !== 'string' || !args.code) return {unreplayable: 'script'};
    const refs = [];
    for (const [, , ref] of args.code.matchAll(SCRIPT_REF)) {
      if (refs.some(item => item.ref === ref)) continue;
      const found = target(ref);
      if (!found) return {unreplayable: 'target'};
      refs.push({ref, target: found});
    }
    return {step: {tool, refs: refs.map(({ref, target: found}) => ({key: ref, target: found})), slot: keep(args.code)}, values};
  }
  if (tool === 'run_skill_script') return {step: {tool, slot: keep(args)}, values};
  if (tool === 'prepare_file_upload') {
    const place = uploadTargets[args.ref];
    return place ? {step: {tool, upload: place, slot: keep(args.file_ids)}, values} : {unreplayable: 'upload_target'};
  }
  if (['click_element', 'hover_element', 'press_key', 'select_option', 'request_approval', 'prepare_download'].includes(tool) || tool === 'scroll_page' && args.ref) {
    const found = target(args.ref);
    if (!found) return {unreplayable: 'target'};
    const step = {tool, target: found};
    if (tool === 'click_element') {
      step.args = {...(args.button === 'right' ? {button: 'right'} : {}), ...(args.double === 'yes' ? {double: 'yes'} : {})};
      // Host-observed navigation only. This is historical metadata, not a
      // reusable ref, authorization or proof that a later link is read-only.
      if (found.role === 'link' && result.actionIssued === true && !result.requiresUserInput &&
          found.destination === result.observation?.url && observation?.url && observation?.title) {
        step.navigation = {from: observation.url, title: clean(observation.title), to: result.observation.url};
      }
    }
    if (tool === 'press_key') step.args = {key: args.key};
    if (tool === 'scroll_page') step.args = {direction: args.direction};
    if (tool === 'select_option') step.slot = keep(args.values);
    return {step, values};
  }
  if (tool === 'fill_form') {
    const fields = [];
    for (const field of Array.isArray(args.fields) ? args.fields : []) {
      const found = target(field?.field_id);
      if (!found) return {unreplayable: 'target'};
      fields.push({target: found, slot: keep(field.value), ...(['start', 'end'].includes(field.position) ? {position: field.position} : {}),
        ...(field.replace_existing === true ? {replace_existing: true} : {}), ...(field.format === 'html' ? {format: 'html'} : {})});
    }
    return fields.length ? {step: {tool, fields, ...(typeof observation?.title==='string' ? {formTitle:observation.title.slice(0,180)} : {}), ...(hostVerifiedFill(tool,result) ? {verifiedFill:true} : {}), ...(formContract(observation) ? {formContract:formContract(observation)} : {})}, values} : null;
  }
  if (tool === 'verify_page') {
    const checks = [];
    for (const check of Array.isArray(args.checks) ? args.checks : []) {
      const {ref, expected, terms, ...rest} = check || {};
      const entry = {...rest};
      if (ref !== undefined) {const found = target(ref); if (!found) return {unreplayable: 'target'}; entry.target = found;}
      if (Array.isArray(terms)) {
        entry.terms = [];
        for (const term of terms) {const found = target(term?.ref); if (!found) return {unreplayable: 'target'}; entry.terms.push({target: found, ...(term.multiplier !== undefined ? {multiplier: term.multiplier} : {})});}
      }
      if (expected !== undefined) entry.slot = keep(expected);
      checks.push(entry);
    }
    return checks.length ? {step: {tool, checks}, values} : null;
  }
  if (tool === 'navigate_page') return {step: {tool, page: pageOf(args.url), slot: keep(args.url), ...(args.new_tab === 'yes' ? {args: {new_tab: 'yes'}} : {})}, values};
  if (tool === 'scroll_page') return {step: {tool, args: {direction: args.direction}}, values};
  if (tool === 'wait_page') {
    const {expected, ...condition} = args.condition || {};
    return {step: {tool, args: {...(args.condition ? {condition} : {}), ...(args.timeout_ms !== undefined ? {timeout_ms: args.timeout_ms} : {})}, ...(expected !== undefined ? {slot: keep(expected)} : {})}, values};
  }
  return {step: {tool}, values};
}

// The inputs a person gives again before a replay: the typed and chosen values,
// named by their field. A check that verified a typed value follows that value.
export function replayInputs(steps) {
  const inputs = [], fieldSlots = new Map();
  for (const step of steps) {
    for (const field of step.tool === 'fill_form' ? step.fields : []) {
      const place = [field.target.name, field.target.column, ...(field.target.context || []).map(item => item.name)].filter(Boolean);
      inputs.push({slot: field.slot, label: [...new Set(place)].join(' · ').slice(0, 120) || '입력값', kind: 'text'});
      fieldSlots.set(JSON.stringify([field.target.role, field.target.name, contextKey(field.target.context), field.target.column || '']), field.slot);
    }
    if (step.tool === 'select_option') inputs.push({slot: step.slot, label: step.target.name || '선택값', kind: 'choice'});
  }
  const linked = {};
  for (const step of steps) for (const check of step.tool === 'verify_page' ? step.checks : []) {
    if (!check.slot || !check.target || !['field_value', 'field_contains'].includes(check.kind)) continue;
    const slot = fieldSlots.get(JSON.stringify([check.target.role, check.target.name, contextKey(check.target.context), check.target.column || '']));
    if (slot) linked[check.slot] = slot;
  }
  return {inputs, linked};
}

// The saved record of a verified run: steps without values and the inputs to ask for.
export function replayRecord(log, {id, goal = '', createdAt = Date.now(), goalReviewed = false} = {}) {
  const steps = Array.isArray(log?.steps) ? log.steps : [];
  if (log?.unreplayable || !steps.some(step => CHANGES_PAGE.has(step.tool)) || !steps.some(step => step.tool === 'verify_page' || step.tool==='fill_form' && step.verifiedFill===true)) return null;
  const {inputs, linked} = replayInputs(steps);
  const memory = steps.filter(step => MEMORY_STEPS.has(step.tool)).map(step => step.slot);
  return {id, version: 1, ...(goalReviewed ? {goalReviewed:true} : {}), goal: clean(goal).slice(0, 400), ...(log.startPage ? {startPage: log.startPage} : {}), createdAt, steps, inputs, linked, ...(memory.length ? {memory} : {})};
}

// The arguments of one step for the page as it is now: the matched refs and the values.
function bind(step, refs, values, linked = {}) {
  const value = slot => values[linked[slot] || slot];
  switch (step.tool) {
    case 'fill_form': return {fields: step.fields.map((field, index) => ({field_id: refs.fields[index], value: value(field.slot) ?? '',
      ...(field.position ? {position: field.position} : {}), ...(field.replace_existing ? {replace_existing: true} : {}), ...(field.format ? {format: field.format} : {})}))};
    case 'verify_page': return {checks: step.checks.flatMap((check, index) => {
      const {target, terms, slot, ...rest} = check;
      if (slot && value(slot) === undefined) return [];
      return [{...rest, ...(target ? {ref: refs.checks[index]} : {}), ...(terms ? {terms: terms.map((term, at) => ({ref: refs.terms[index][at], ...(term.multiplier !== undefined ? {multiplier: term.multiplier} : {})}))} : {}),
        ...(slot ? {expected: value(slot)} : {})}];
    })};
    case 'navigate_page': return {url: value(step.slot) || step.page, ...(step.args || {})};
    case 'select_option': return {ref: refs.target, values: value(step.slot)};
    case 'wait_page': return {...step.args, ...(step.slot && value(step.slot) !== undefined ? {condition: {...step.args.condition, expected: value(step.slot)}} : {})};
    case 'drag_element': return {source_ref: refs.source, target_ref: refs.target};
    case 'switch_tab': return {tab_id: refs.tab};
    case 'run_playwright': return {code: String(value(step.slot)).replace(SCRIPT_REF, (whole, quote, ref) => {const at = step.refs.findIndex(item => item.key === ref); return at >= 0 ? `browser.ref(${JSON.stringify(refs.scripts[at])})` : whole;})};
    case 'run_skill_script': return value(step.slot);
    case 'prepare_file_upload': return {ref: refs.upload, file_ids: value(step.slot)};
    default: return {...(refs.target ? {ref: refs.target} : {}), ...(step.args || {})};
  }
}
const complete = observation => (Array.isArray(observation?.frames) ? observation.frames : []).every(frame => !frame?.omittedControls && !frame?.truncated && !frame?.textFiltered);
const nameOf = target => target?.name || target?.role || '대상';
// Where a replay stops, in words for the person reading the chat.
function stopText(index, step, problem) {
  const at = `${index + 1}번째 단계`;
  if (problem.error === 'missing') return `${at}의 대상 "${nameOf(problem.target)}"을(를) 지금 페이지에서 찾지 못했습니다.`;
  if (problem.error === 'ambiguous') return `${at}의 대상 "${nameOf(problem.target)}"과(와) 같은 것이 ${problem.candidates}개 있어 어느 것인지 정할 수 없습니다.`;
  if (problem.error === 'covered') return `${at}의 대상 "${nameOf(problem.target)}"이(가) ${String(problem.coveredBy).replace(/^dialog/, '대화상자').replace(/^overlay$/, '덮개').replace(/^element/, '다른 요소')}에 가려져 있습니다.`;
  if (problem.error === 'input_missing') return `${at}에 넣을 값이 없습니다.`;
  if (problem.error === 'start_page') return '기록한 실행이 시작한 페이지를 열지 못했습니다.';
  if (problem.error === 'memory') return `${at}은 스크립트나 첨부 파일처럼 메모리에만 둔 내용이 필요한데, 브라우저를 다시 켜서 그 내용이 없습니다.`;
  if (problem.error === 'tab_missing') return `${at}에서 전환할 탭(${problem.page})을 찾지 못했습니다.`;
  if (problem.error === 'tab_ambiguous') return `${at}에서 같은 페이지의 탭이 ${problem.candidates}개라 어느 탭인지 정할 수 없습니다.`;
  if (step.tool === 'verify_page') return `${at}의 확인이 통과하지 못했습니다. 페이지가 기록한 실행 때와 다릅니다.`;
  return `${at}(${step.tool})이 실패했습니다${problem.reason ? ` (${problem.reason})` : ''}.`;
}

// Runs the recorded steps again without the model. Each target is found in the
// observation the previous step returned; when that observation left controls
// out, a focused observation by the target's name is tried before stopping.
// Returns {completed} with counts, {awaitingApproval} at an approval step (the
// host has shown its card), or {stopped} with the reason in words.
export async function runReplay({steps, values = {}, linked = {}, startAt = 0, approved = false, startPage = '', startURL = ''}, {executeTool, progress = () => {}, signal} = {}) {
  let observation = null, filled = 0, checked = 0;
  const observe = async query => {
    const result = await executeTool('browser_snapshot', query ? {query} : {});
    if (result?.error) throw Object.assign(new Error('replay_observation'), {reason: result.error});
    return result.observation || result;
  };
  const find = async target => {
    let match = matchTarget(target, observation);
    if (match.error && match.error !== 'covered' && !complete(observation) && target.name) {
      observation = await observe(target.name);
      match = matchTarget(target, observation);
    }
    return match.error ? {...match, target} : match.element.ref;
  };
  for (let index = startAt; index < steps.length; index++) {
    if (signal?.aborted) throw new Error('cancelled');
    const step = steps[index], id = `replay-${index}`;
    const label = step.target ? nameOf(step.target) : step.tool === 'fill_form' ? step.fields.map(field => nameOf(field.target)).join(', ') : ['navigate_page', 'switch_tab'].includes(step.tool) ? step.page :
      step.tool === 'prepare_file_upload' ? step.upload.label : '';
    progress({index: id, tool: step.tool, status: 'running', ...(label ? {label: label.slice(0, 100)} : {})});
    const stop = problem => {progress({index: id, tool: step.tool, status: 'error', ...(label ? {label: label.slice(0, 100)} : {})}); return {stopped: {index, tool: step.tool, text: stopText(index, step, problem)}};};
    // A navigation before any observation is not issued (the agent must look at
    // the connected page first), so the page is observed before the first step.
    if (!observation && !(approved && step.tool === 'apply_approved_action' && index === startAt)) {
      observation = await observe();
      // The recorded run began on another page: it is opened first.
      if (index === 0 && step.tool !== 'navigate_page' && startPage && pageOf(observation?.url) !== startPage) {
        const opened = await executeTool('navigate_page', {url: startURL || startPage});
        if (opened?.error || opened?.yielded || pageOf(opened?.observation?.url) !== startPage) return stop({error: 'start_page'});
        observation = opened.observation;
      }
    }
    const refs = {};
    if (MEMORY_STEPS.has(step.tool) && values[step.slot] === undefined) return stop({error: 'memory'});
    if (step.source) {const ref = await find(step.source); if (typeof ref !== 'string') return stop(ref); refs.source = ref;}
    if (step.target) {const ref = await find(step.target); if (typeof ref !== 'string') return stop(ref); refs.target = ref;}
    if (step.tool === 'run_playwright') {
      refs.scripts = [];
      for (const item of step.refs) {const ref = await find(item.target); if (typeof ref !== 'string') return stop(ref); refs.scripts.push(ref);}
    }
    if (step.tool === 'switch_tab') {
      const listed = await executeTool('list_tabs', {});
      const same = (Array.isArray(listed?.tabs) ? listed.tabs : []).filter(tab => pageOf(tab.url) === step.page);
      const named = same.length > 1 ? same.filter(tab => clean(tab.title) === step.title) : same;
      if (named.length !== 1) return stop({error: named.length ? 'tab_ambiguous' : 'tab_missing', page: step.page, candidates: named.length});
      refs.tab = named[0].tab_id;
    }
    if (step.tool === 'prepare_file_upload') {
      const listed = await executeTool('list_upload_targets', {});
      const same = (Array.isArray(listed?.targets) ? listed.targets : []).filter(item => clean(item.label).slice(0, 100) === step.upload.label && (!step.upload.page || pageOf(item.url) === step.upload.page));
      if (same.length !== 1) return stop({error: same.length ? 'ambiguous' : 'missing', target: {name: step.upload.label}, candidates: same.length});
      refs.upload = same[0].ref;
    }
    if (step.tool === 'fill_form') {
      refs.fields = [];
      for (const field of step.fields) {
        if (values[field.slot] === undefined) return stop({error: 'input_missing'});
        const ref = await find(field.target); if (typeof ref !== 'string') return stop(ref); refs.fields.push(ref);
      }
    }
    if (step.tool === 'verify_page') {
      refs.checks = []; refs.terms = [];
      for (const check of step.checks) {
        if (check.target) {const ref = await find(check.target); if (typeof ref !== 'string') return stop(ref); refs.checks.push(ref);} else refs.checks.push(undefined);
        const terms = [];
        for (const term of check.terms || []) {const ref = await find(term.target); if (typeof ref !== 'string') return stop(ref); terms.push(ref);}
        refs.terms.push(terms);
      }
    }
    if (step.tool === 'apply_approved_action' && !(approved && index === startAt)) return stop({error: 'approval'});
    const args = bind(step, refs, values, linked);
    if (step.tool === 'verify_page' && !args.checks.length) {progress({index: id, tool: step.tool, status: 'done'}); continue;}
    const result = await executeTool(step.tool, args, {replayIndex: index});
    if (signal?.aborted) throw new Error('cancelled');
    if (result?.requiresUserInput) {progress({index: id, tool: step.tool, status: 'waiting', ...(label ? {label: label.slice(0, 100)} : {})}); return {awaitingApproval: {index}};}
    if (result?.error || result?.ok === false || result?.yielded || step.tool === 'verify_page' && result?.verified !== true) return stop({reason: result?.error || result?.reason || ''});
    if (step.tool === 'fill_form') filled += step.fields.length;
    if (step.tool === 'verify_page') checked += args.checks.length;
    observation = result?.observation?.frames ? result.observation : result?.frames ? result : null;
    progress({index: id, tool: step.tool, status: 'done', ...(label ? {label: label.slice(0, 100)} : {})});
  }
  return {completed: {steps: steps.length - startAt, filled, checked}};
}
// The answer a replay leaves in the chat.
export function replayAnswer(outcome) {
  if (outcome?.completed) {
    const {steps, filled, checked} = outcome.completed;
    return `기록한 절차 ${steps}단계를 모델 없이 다시 실행했습니다.${filled ? ` 입력 ${filled}칸을 채웠고` : ''} 확인 ${checked}개가 통과했습니다.`;
  }
  if (outcome?.stopped) return `${outcome.stopped.text} 여기서 멈췄습니다. 이미 실행한 단계는 되돌리지 않았습니다. "작업 이어가기"를 누르면 모델이 지금 페이지에서 이어서 진행합니다.`;
  return '';
}
