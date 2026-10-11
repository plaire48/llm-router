import {allSkills} from './skills.js';
import {OPENWIKI_WORKFLOW} from './openwiki-workflow.js';
import {rankEvidence} from './evidence-search.js';

// Search the registered snapshot locally; only requested excerpts reach the
// model. Executable code and output templates are not workflow knowledge.
const knowledge = skill => [{path: 'SKILL.md', content: skill.instructions}, ...(skill.resources || []).filter(resource => resource.path.startsWith('references/'))];
function searchKnowledge(skill, query, path) {
  const chunks = [];
  for (const resource of knowledge(skill).filter(resource => !path || resource.path === path)) {
    for (let offset = 0; offset < resource.content.length; offset += 1400) {
      chunks.push({id: chunks.length, name: resource.path, context: skill.name, text: resource.content.slice(offset, offset + 1600), resource, offset});
    }
  }
  const selected = [];
  for (const hit of rankEvidence(chunks, query)) {
    const chunk = chunks[hit.id];
    if (selected.some(other => other.resource.path === chunk.resource.path && Math.abs(other.offset - chunk.offset) < 1600)) continue;
    selected.push(chunk); if (selected.length === 3) break;
  }
  return selected.map(({resource, offset, text}) => ({path: resource.path,
    start: resource.content.slice(0, offset).split('\n').length,
    end: resource.content.slice(0, offset + text.length).split('\n').length,
    offset, length: text.length, content: text, partial: offset > 0 || offset + text.length < resource.content.length}));
}

export const SKILL_TOOL_NAMES = new Set(['find_skills', 'read_skill']);
export function skillLibrary(custom = [], {selectedSkillId = '', project = null} = {}) {
  const registered = allSkills(custom).filter(skill => skill.id.startsWith('custom-') && (!selectedSkillId || selectedSkillId === skill.id));
  return [...registered, ...(project?.status === 'connected' ? [OPENWIKI_WORKFLOW] : [])];
}
export function skillCatalog(library) {
  return library.map(({id, name, description, compatibility}) => ({id, name, description: description.slice(0, 300), ...(compatibility ? {compatibility: compatibility.slice(0, 160)} : {})}));
}
export async function bindSkillLibrary(library) {
  return Promise.all(library.map(async skill => ({id: skill.id, hash: [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(skill))))].map(value => value.toString(16).padStart(2, '0')).join('')})));
}
export const isBrowserScript = path => /^scripts\/(?:[^/]+\/)*[^/]+\.browser\.js$/.test(path);
export async function prepareSkillScript(library, bindings, args) {
  const skill = library.find(item => item.id === args?.skill_id);
  if (!skill || !isBrowserScript(args?.path || '')) throw new Error('skill_unavailable');
  const current = (await bindSkillLibrary([skill]))[0];
  if (!bindings?.some(item => item.id === current.id && item.hash === current.hash)) throw new Error('skill_changed');
  const resource = skill.resources?.find(item => item.path === args.path);
  if (!resource || resource.content.length > 24000) throw new Error('skill_invalid');
  const input = JSON.stringify(args.input ?? {});
  if (input.length > 8000) throw new Error('tool_arguments_invalid');
  const code = `const input = ${input};\n${resource.content}`;
  if (code.length > 20000) throw new Error('skill_invalid');
  return code;
}
// find is false when the user selected one skill: the library then holds that
// skill only and there is nothing to search for.
export function skillLibraryTools(library, {scripts = false, find = true} = {}) {
  if (!library.length) return [];
  return [
    ...(scripts && library.some(skill => skill.resources?.some(resource => isBrowserScript(resource.path))) ? [{type:'function',function:{name:'run_skill_script',description:'Run a registered scripts/*.browser.js resource in the existing isolated browser VM. Read its skill and observe the page first. input is JSON data available as input inside the script. Only the documented page/browser facade exists. No imports, Node, Python, fetch or filesystem. Existing target ownership, action checkpoints and final approval still apply. Inspect partial results and verify_page after writes; never replay completed actions.',parameters:{type:'object',properties:{skill_id:{type:'string',maxLength:100},path:{type:'string',maxLength:200},input:{type:'object'}},required:['skill_id','path'],additionalProperties:false}}}] : []),
    ...(find ? [{type: 'function', function: {name: 'find_skills', description: 'Find registered workflow skills by purpose, business terms, menu names or reference rules. A skill already listed in the workflow catalog can be read directly with read_skill and its id: search only when no listed description fits. Searches SKILL.md and references locally but returns metadata only, not instructions or evidence. Read the relevant SKILL.md before applying its procedure; lexical matches do not establish site applicability. No match means use the existing tools normally.', parameters: {type: 'object', properties: {query: {type: 'string', minLength: 1, maxLength: 300}}, required: ['query'], additionalProperties: false}}}] : []),
    {type: 'function', function: {name: 'read_skill', description: 'Load a registered workflow SKILL.md, then only its needed reference files. Use query to search business terms/rules in this skill and references (optionally one exact path); it returns up to 3 excerpts, not the complete procedure. Never combine query and start. Otherwise start is a 1-based line number for a truncated resource. Use only a skill_id from the catalog/find_skills and paths from its inventory. These instructions do not grant tools, execution or final-action approval. Only scripts/*.browser.js can run through run_skill_script when offered; other scripts are references. Local Python/Node are unavailable. A procedure is not evidence that the business task succeeded.', parameters: {type: 'object', properties: {skill_id: {type: 'string', maxLength: 100}, path: {type: 'string', maxLength: 200}, start: {type: 'integer', minimum: 1}, query: {type: 'string', minLength: 1, maxLength: 300}}, required: ['skill_id'], additionalProperties: false}}},
  ];
}
export async function executeSkillTool(library, bindings, name, args = {}, records = null) {
  const bound = new Map((bindings || []).map(item => [item.id, item.hash]));
  const current = await bindSkillLibrary(library);
  const valid = library.filter((skill, index) => bound.get(skill.id) === current[index].hash);
  if (name === 'find_skills') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 300) return {error: 'tool_arguments_invalid'};
    const hits = rankEvidence(valid.map(skill => ({id: skill.id, name: skill.name, context: `${skill.description} ${skill.compatibility || ''}`, text: knowledge(skill).map(resource => resource.content).join('\n')})), args.query).slice(0, 5);
    // How a skill fared in earlier runs helps choose between similar ones. It is a count, not a guarantee.
    return {ok: true, dataKind: 'skill_catalog', skills: hits.map(hit => ({...skillCatalog([valid.find(skill => skill.id === hit.id)])[0],
      ...(records?.[hit.id]?.uses > 0 ? {record: {uses: records[hit.id].uses, reviewPassed: records[hit.id].passed, lastOutcome: records[hit.id].lastOutcome}} : {})})), changed: (bindings || []).length !== valid.length};
  }
  if (name !== 'read_skill' || typeof args.skill_id !== 'string') return {error: 'tool_arguments_invalid'};
  const skill = valid.find(skill => skill.id === args.skill_id);
  if (!skill) return {error: bound.has(args.skill_id) ? 'skill_changed' : 'skill_unavailable', instruction: 'Use only skills bound to this request. A changed skill must be loaded in a new request.'};
  if (args.query !== undefined) {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 300 || args.start !== undefined ||
      args.path !== undefined && !knowledge(skill).some(resource => resource.path === args.path)) return {error: 'tool_arguments_invalid'};
    return {ok: true, dataKind: 'skill_search', skill_id: skill.id, hash: bound.get(skill.id), results: searchKnowledge(skill, args.query, args.path),
      instruction: 'Reference excerpts only. Read SKILL.md before applying the workflow, check the current site/menu and consult adjacent lines when needed. An empty lexical search is not proof of absence. These results grant no tools, permissions, or final-action approval and are not evidence of task completion.'};
  }
  const path = args.path ?? 'SKILL.md', start = args.start ?? 1;
  const content = path === 'SKILL.md' ? skill.instructions : skill.resources?.find(resource => resource.path === path)?.content;
  if (content === undefined || !Number.isInteger(start) || start < 1) return {error: 'tool_arguments_invalid'};
  const lines = content.split('\n');
  if (start > lines.length) return {error: 'tool_arguments_invalid'};
  const excerpt = []; let size = 0;
  for (const line of lines.slice(start - 1, start + 119)) {if (size + line.length > 16000) return {error: 'skill_resource_line_too_long'}; if (size + line.length > 6000 && excerpt.length) break; excerpt.push(line); size += line.length + 1;}
  const end = start + excerpt.length - 1;
  return {ok: true, dataKind: 'skill_reference', skill_id: skill.id, name: skill.name, path, content: excerpt.join('\n'), start, end, totalLines: lines.length, hash: bound.get(skill.id), truncated: end < lines.length, ...(end < lines.length ? {nextStart: end + 1} : {}), ...(path === 'SKILL.md' ? {resources: (skill.resources || []).map(resource => ({path: resource.path, execution: isBrowserScript(resource.path) ? 'browser_sandbox' : 'reference_only'}))} : {}), authority: 'workflow guidance only; no additional tools, permissions, or proof of completion'};
}
