import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {importSkill, importSkillFolder, exportSkill, normalizeSkill, automaticSkillTools, taskSkillId, browserTools} from '../skills.js';
import {skillLibrary, skillCatalog, bindSkillLibrary, executeSkillTool, skillLibraryTools} from '../skill-library.js';
import {promptPreamble} from '../chat-contract.js';
import {createHarness} from '../agent-harness.js';

const main = '---\nname: checkout-review\ndescription: >\n  Checkout 안내를 작성하고\n  입력 결과를 확인합니다.\nallowed-tools: Bash(*)\n---\nRead references/check.md when checking the draft.';
const file = (path, content) => ({name: path.split('/').at(-1), webkitRelativePath: `checkout-review/${path}`, size: Buffer.byteLength(content), text: async () => content});
test('the generic internal-workflow template is portable without invented FP policy', async () => {
  const root = new URL('../examples/skills/business-workflow-template/', import.meta.url);
  const paths = ['SKILL.md', ...(await readdir(new URL('references/', root))).map(name => 'references/' + name)];
  const folder = await importSkillFolder(await Promise.all(paths.map(async path => file(path, await readFile(new URL(path, root), 'utf8')))));
  const shared = importSkill(await readFile(new URL('../examples/skills/business-workflow-template.skill.json', import.meta.url), 'utf8'));
  assert.equal(shared.instructions, folder.instructions); assert.deepEqual(shared.resources, folder.resources);
  assert(shared.instructions.includes('작성 필요')); assert.equal(shared.toolMode, 'automatic');
  assert(shared.resources.every(resource => resource.path.startsWith('references/')));
  assert.equal(shared.resources.length, 4);
});
test('automatic workflows share the normal copilot catalog and retain their identity after pause and export', () => {
  const skill = normalizeSkill({id: 'custom-workflow', name: 'Draft', instructions: 'Prepare a draft, verify and ask before sending.', toolMode: 'automatic', allowFill: false, allowStorage: false, allowAutomation: false});
  assert.equal(skill.needsPage, false);
  assert(automaticSkillTools(skill));
  const tools = browserTools(null, skill, '', {autoConnect: automaticSkillTools(skill)}).map(tool => tool.function.name);
  for (const name of ['read_page', 'fill_form', 'run_playwright', 'read_page_storage', 'verify_page', 'request_approval']) assert(tools.includes(name));
  assert.equal(taskSkillId({skillId: skill.id, autoConnect: true}, 'unrelated'), skill.id);
  assert.equal(taskSkillId({skillId: 'browser-agent', autoConnect: true}), '');
  const exported = JSON.parse(exportSkill(skill));
  assert.equal(exported.toolMode, 'automatic'); assert(!('capabilities' in exported));
  assert.equal(importSkill(JSON.stringify(exported)).toolMode, 'automatic');
  const legacy = normalizeSkill({name: 'Read only', instructions: 'Read only', needsPage: true});
  assert.equal(automaticSkillTools(legacy), false); assert.equal(legacy.allowAutomation, false);
});
test('folder skills preserve YAML purpose and resources across portable sharing without executable permissions', async () => {
  const skill = await importSkillFolder([file('SKILL.md', main), file('references/check.md', 'Check the current draft.'), file('scripts/example.py', 'print("reference only")')]);
  assert.match(skill.description, /Checkout 안내.*입력 결과/s);
  assert.equal(skill.allowAutomation, false); assert.equal(skill.needsPage, false);
  const shared = importSkill(exportSkill({...skill, token: 'private-runtime'}));
  assert.deepEqual(shared.resources, skill.resources);
  assert.equal(shared.description, skill.description);
  assert(!exportSkill({...skill, token: 'private-runtime'}).includes('private-runtime'));
});
test('invalid YAML, aliases, ambiguous roots, traversal and oversized resources are rejected', async () => {
  for (const front of ['name: [unfinished', 'name: a\nname: b', 'name: &x hello\ndescription: *x']) assert.throws(() => importSkill(`---\n${front}\n---\nwork`), /skill_invalid/);
  for (const path of ['references/../bad.md', 'references/.env.txt', 'scripts/secrets.json', '/scripts/run.js', 'scripts/run.exe']) await assert.rejects(importSkillFolder([file('SKILL.md', main), file(path, 'x')]), /skill_invalid/);
  await assert.rejects(importSkillFolder([file('SKILL.md', main), file('nested/SKILL.md', main)]), /skill_invalid/);
  await assert.rejects(importSkillFolder([file('SKILL.md', main), file('references/large.md', 'x'.repeat(48001))]), /skill_invalid/);
});
test('discovery exposes metadata only and reads only request-bound resources with line provenance', async () => {
  const skill = normalizeSkill({id: 'custom-checkout', name: 'Checkout', description: 'Checkout draft verification', instructions: 'PRIVATE-BODY read references/check.md', resources: [{path: 'references/check.md', content: Array.from({length: 150}, (_, i) => `check ${i}`).join('\n')}, {path: 'scripts/example.py', content: 'PRIVATE-SCRIPT'}]});
  const library = skillLibrary([skill]), bindings = await bindSkillLibrary(library);
  const context = promptPreamble('qwen', undefined, {skillCatalog: skillCatalog(library)});
  assert(!JSON.stringify(context).includes('PRIVATE-')); assert.match(JSON.stringify(context), /Checkout draft verification/);
  const found = await executeSkillTool(library, bindings, 'find_skills', {query: 'Checkout'});
  assert.equal(found.skills[0].id, skill.id); assert(!JSON.stringify(found).includes('PRIVATE-'));
  const read = await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id});
  assert.match(read.content, /PRIVATE-BODY/); assert(!JSON.stringify(read).includes('PRIVATE-SCRIPT'));
  const ref = await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id, path: 'references/check.md'});
  assert.equal(ref.start, 1); assert.equal(ref.end, 120); assert.equal(ref.nextStart, 121);
  assert.equal((await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id, path: 'references/check.md', start: 121})).truncated, false);
  assert.equal((await executeSkillTool(library, bindings, 'read_skill', {skill_id: 'unregistered'})).error, 'skill_unavailable');
  assert.equal((await executeSkillTool([{...skill, instructions: 'changed'}], bindings, 'read_skill', {skill_id: skill.id})).error, 'skill_changed');
  // Registered skills are reachable without a selection step; a small input window keeps them on demand.
  const harness = createHarness(skillLibraryTools(library));
  assert(['find_skills', 'read_skill'].every(name => harness.advertised().some(tool => tool.function.name === name)));
  const lean = createHarness(skillLibraryTools(library), {inputBudget: 16000});
  assert(!lean.advertised().some(tool => tool.function.name === 'read_skill'));
  assert.equal(lean.select({groups: ['workflows']}).ok, true);
  assert(lean.advertised().some(tool => tool.function.name === 'read_skill'));
  harness.observe('read_skill', read); assert.equal(harness.needsCheck(), false);
});
test('OpenWiki workflow is available only for a connected project and explicit selection limits other skills', () => {
  const one = normalizeSkill({id: 'custom-one', name: 'One', instructions: 'one'}), two = normalizeSkill({id: 'custom-two', name: 'Two', instructions: 'two'});
  assert.equal(skillLibrary([one, two], {selectedSkillId: one.id}).length, 1);
  assert.equal(skillLibrary([], {project: {status: 'expired'}}).length, 0);
  assert.equal(skillLibrary([], {project: {status: 'connected'}})[0].id, 'openwiki-page-workflow');
});

test('business terms discover a shared skill without leaking its reference body into the catalog', async () => {
  const skill = importSkill(exportSkill(normalizeSkill({name: 'Work log', description: 'Prepare a work record.', instructions: 'Read references/terms.md before filling the draft.',
    resources: [{path: 'references/terms.md', content: 'PRIVATE_REFERENCE MH 업무시간은 화면 단위가 분일 때 480분으로 기록한다.'}, {path: 'scripts/helper.browser.js', content: 'SCRIPT_ONLY_KEYWORD'}]})));
  const library = skillLibrary([skill]), bindings = await bindSkillLibrary(library);
  const found = await executeSkillTool(library, bindings, 'find_skills', {query: 'MH'});
  assert.equal(found.skills[0].id, skill.id);
  assert(!JSON.stringify(found).includes('PRIVATE_REFERENCE'));
  assert.deepEqual((await executeSkillTool(library, bindings, 'find_skills', {query: 'SCRIPT_ONLY_KEYWORD'})).skills, []);
});

test('focused skill retrieval finds a late rule with exact source offsets and bounded context', async () => {
  const content = '일반 안내입니다.\n'.repeat(1800) + 'MH 단위: 분이면 480, 시간이면 8.\n개인 업무 내용은 사용자에게 확인합니다.\n';
  const skill = normalizeSkill({id: 'custom-knowledge', name: 'Work log', instructions: 'Read references/terms.md.', resources: [{path: 'references/terms.md', content}]});
  const library = [skill], bindings = await bindSkillLibrary(library);
  const result = await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id, query: 'MH'});
  assert.equal(result.dataKind, 'skill_search'); assert(result.results.length > 0);
  assert(result.results.some(item => item.content.includes('480')));
  assert(result.results.reduce((sum, item) => sum + item.content.length, 0) <= 4800);
  for (const item of result.results) {
    assert.equal(item.content, content.slice(item.offset, item.offset + item.length));
    assert.equal(item.start, content.slice(0, item.offset).split('\n').length);
    assert.equal(item.end, content.slice(0, item.offset + item.length).split('\n').length);
  }
  const all = await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id, query: 'MH', path: 'references/terms.md'});
  assert.deepEqual(all.results, result.results);
  for (const args of [{query: '',}, {query: 'MH', start: 1}, {query: 'MH', path: '../private.md'}, {query: 'x'.repeat(301)}]) {
    assert.equal((await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id, ...args})).error, 'tool_arguments_invalid');
  }
  assert.deepEqual((await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id, query: 'NOT_FOUND'})).results, []);
  const changed = [{...skill, resources: [{path: 'references/terms.md', content: 'Different rule'}]}];
  assert.equal((await executeSkillTool(changed, bindings, 'read_skill', {skill_id: skill.id, query: 'MH'})).error, 'skill_changed');
});

test('search excerpts cannot activate tools or stand in for execution evidence', async () => {
  const skill = normalizeSkill({id: 'custom-search', name: 'Work log', toolMode: 'automatic', instructions: 'Use fill_form.', resources: [{path: 'references/terms.md', content: 'run_playwright click_element fill_form'}]});
  const library = [skill], bindings = await bindSkillLibrary(library);
  // A small input window keeps every optional schema on demand, so activation is observable.
  const harness = createHarness([...browserTools(null, {...skill, toolMode: 'automatic'}, '', {autoConnect: true}), ...skillLibraryTools(library)], {inputBudget: 16000});
  harness.observe('read_skill', await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id, query: 'fill_form'}));
  assert(!harness.advertised().some(tool => tool.function.name === 'fill_form'));
  assert.equal(harness.needsCheck(), false);
  harness.observe('read_skill', await executeSkillTool(library, bindings, 'read_skill', {skill_id: skill.id}));
  assert(harness.advertised().some(tool => tool.function.name === 'fill_form'));
});

test('only named browser scripts are executable and edits invalidate a run-bound skill', async () => {
  const {prepareSkillScript} = await import('../skill-library.js');
  const {executeScript} = await import('../script-sandbox.js');
  const skill=normalizeSkill({id:'custom-script',name:'Fill draft',instructions:'Read page first, then fill_form and verify_page.',toolMode:'automatic',resources:[{path:'scripts/fill.browser.js',content:'return {value:input.value,fetch:typeof fetch,process:typeof process};'},{path:'scripts/host.js',content:'process.exit()'}]});
  const library=skillLibrary([skill]),bindings=await bindSkillLibrary(library);
  assert(skillLibraryTools(library,{scripts:true}).some(tool => tool.function.name === 'run_skill_script'));
  assert(!skillLibraryTools(library).some(tool => tool.function.name === 'run_skill_script'));
  const harness=createHarness([...browserTools(null,skill,'',{autoConnect:true}),...skillLibraryTools(library,{scripts:true})],{inputBudget:16000});
  assert(!harness.advertised().some(tool=>tool.function.name==='fill_form'));
  const found=await executeSkillTool(library,bindings,'find_skills',{query:'Fill draft'});
  harness.observe('find_skills',found);
  assert(!harness.advertised().some(tool=>tool.function.name==='run_skill_script'));
  harness.observe('read_skill',await executeSkillTool(library,bindings,'read_skill',{skill_id:skill.id}));
  for (const name of ['fill_form','run_skill_script']) assert(harness.advertised().some(tool=>tool.function.name===name));
  assert(!harness.advertised().some(tool=>tool.function.name==='run_playwright'));
  assert.equal(harness.needsCheck(),false);
  const code=await prepareSkillScript(library,bindings,{skill_id:skill.id,path:'scripts/fill.browser.js',input:{value:'`); malicious(); //'}});
  const result=await executeScript(code,async () => {throw new Error('Unexpected host call');});
  assert.equal(result.value.value,'`); malicious(); //');assert.equal(result.value.fetch,'undefined');assert.equal(result.value.process,'undefined');
  await assert.rejects(prepareSkillScript(library,bindings,{skill_id:skill.id,path:'scripts/host.js'}),/skill_unavailable/);
  await assert.rejects(prepareSkillScript([{...skill,instructions:'Changed'}],bindings,{skill_id:skill.id,path:'scripts/fill.browser.js'}),/skill_changed/);
});
