import test from 'node:test';
import assert from 'node:assert/strict';
import {skillCreationSource, skillCreationMessages, parseSkillDraft} from '../skill-creator.js';
import {selectedSkillText, promptPreamble} from '../chat-contract.js';
import {normalizeSkill} from '../skills.js';
import {skillLibrary, skillCatalog, bindSkillLibrary, executeSkillTool} from '../skill-library.js';

const draft = extra => JSON.stringify({name: '변경 요청 승인 대기 조회', description: 'JSM 변경 요청 목록에서 승인 대기 건을 조회해 표로 정리한다. 승인 대기 현황을 물을 때 사용한다.',
  instructions: '대상: 변경 요청 목록', terms: '승인 대기: 결재 전 상태', inputs: '기간', procedure: '1. 목록을 연다\n2. 상태를 승인 대기로 고른다', checks: '표에 승인 대기만 보인다', ...extra});
const chat = ({verification = 'passed', review = 'complete', pageRoute} = {}) => ({sessionId: 's', provider: 'chatgpt',
  task: {requestId: 'r1', status: 'done', goal: '승인 대기 건을 https://jsm.example.test/servicedesk/list?menu=change 에서 조회해줘. 상세는 https://jsm.example.test/ticket/view?id=123456 참고.',
    page: {url: 'https://jsm.example.test/servicedesk/list?menu=change'}, verification: {status: verification}, goalReview: {status: review}, plan: []},
  messages: [{id: 'u1', role: 'user', content: '승인 대기 건을 조회해줘'},
    {id: 'a1', requestId: 'r1', role: 'assistant', state: 'done', content: '3건입니다.', ...(pageRoute ? {pageRoute} : {}),
      trace: [{id: 't1', tool: 'navigate_page', status: 'done', label: '목록 열기'}, {id: 't2', tool: 'click_element', status: 'error', label: '필터 열기', reason: 'browser_stale'}, {id: 't3', tool: 'verify_page', status: 'done', label: '결과 확인'}]}]});

test('a draft source says whether the run was verified and keeps safe menu addresses and the route', () => {
  const route = [{url: 'https://jsm.example.test/home', title: '홈'}, {url: 'https://jsm.example.test/login', title: '로그인'}, {url: 'https://jsm.example.test/servicedesk/list?menu=change', title: '변경 요청 목록'}];
  const source = skillCreationSource(chat({pageRoute: route}));
  assert.equal(source.verified, true); assert.equal(source.review, 'complete');
  assert.deepEqual(source.route.map(step => step.title), ['홈', '변경 요청 목록']);
  // The menu address stays; the record address is reduced to its site.
  assert.match(source.goal, /https:\/\/jsm\.example\.test\/servicedesk\/list\?menu=change 에서/);
  assert.match(source.goal, /상세는 https:\/\/jsm\.example\.test 참고\./); assert(!source.goal.includes('123456'));
  assert.equal(source.site, 'https://jsm.example.test/servicedesk/list?menu=change');
  // An address that is not the page or the route of this run can name a person: only its site stays.
  const other = chat(); other.task.goal = '담당자 화면 https://jsm.example.test/employees/kim.minsu/profile 와 https://jsm.example.test/browse/PROJ-123 참고';
  assert.equal(skillCreationSource(other).goal, '담당자 화면 https://jsm.example.test 와 https://jsm.example.test 참고');
  assert.deepEqual(source.steps.find(step => step.status === 'error'), {tool: 'click_element', status: 'error', label: '필터 열기', reason: 'browser_stale'});
  for (const options of [{verification: 'failed'}, {review: 'revise'}, {verification: 'not_run', review: 'limited'}]) assert.equal(skillCreationSource(chat(options)).verified, false);
  assert.equal(skillCreationSource(chat()).route, undefined);
});

test('the drafting prompt asks for what the skill does and when to use it, and for honesty about an unverified run', () => {
  const prompt = skillCreationMessages(skillCreationSource(chat()), [])[0].content;
  assert.match(prompt, /write first what the workflow does, then when to use it/);
  assert.match(prompt, /in the third person/); assert.match(prompt, /Never a vague phrase such as 내 스킬/);
  assert.match(prompt, /source\.verified is false/); assert.match(prompt, /검증되지 않은 절차/); assert.match(prompt, /source\.route/);
});

test('a draft records its target site and says when its source run was not verified', () => {
  const verified = parseSkillDraft(draft(), skillCreationSource(chat()));
  assert.equal(verified.compatibility, '대상 사이트: https://jsm.example.test');
  assert.match(verified.instructions, /^# 사용 전 확인\n검토가 필요한 초안입니다\./);
  const unverified = parseSkillDraft(draft(), skillCreationSource(chat({review: 'revise'})));
  assert.match(unverified.instructions, /^# 사용 전 확인\n검증을 통과하지 못한 작업에서 만든 초안입니다\./);
  // Without a source the earlier behaviour is unchanged.
  const plain = parseSkillDraft(draft());
  assert.equal(plain.compatibility, ''); assert.match(plain.instructions, /검토가 필요한 초안입니다/);
  assert.deepEqual(plain.resources.map(resource => resource.path).sort(), ['references/checks.md', 'references/inputs.md', 'references/procedure.md', 'references/terms.md']);
  assert.throws(() => parseSkillDraft(draft({extra: 'x'}), skillCreationSource(chat())), /skill_draft_invalid/);
  const routed = parseSkillDraft(draft({procedure: '1. https://jsm.example.test/servicedesk/list?menu=change 를 연다\n2. https://jsm.example.test/employees/kim.minsu/profile 은 열지 않는다'}), skillCreationSource(chat()));
  assert.equal(routed.resources.find(resource => resource.path === 'references/procedure.md').content, '1. https://jsm.example.test/servicedesk/list?menu=change 를 연다\n2. https://jsm.example.test 은 열지 않는다');
});

test('a selected skill carries its procedure and checks when the input window allows it', () => {
  const skill = parseSkillDraft(draft(), skillCreationSource(chat()));
  const full = selectedSkillText(skill, {inlineReferences: true});
  assert.match(full, /^User-selected skill: 변경 요청 승인 대기 조회 \(selected and loaded: references\/procedure\.md, references\/checks\.md follow below, so do not call find_skills or read_skill for them\)\n# 사용 전 확인/);
  assert.match(full, /\[references\/procedure\.md\]\n1\. 목록을 연다\n2\. 상태를 승인 대기로 고른다/);
  assert.match(full, /\[references\/checks\.md\]\n표에 승인 대기만 보인다/);
  assert(full.indexOf('[references/procedure.md]') < full.indexOf('[references/checks.md]'), 'the procedure comes before its checks');
  assert.match(full, /Other references of this skill, read with read_skill when needed: references\/inputs\.md, references\/terms\.md$/);
  assert(!full.includes('승인 대기: 결재 전 상태'), 'terms stay a reference');
  assert.equal(selectedSkillText(skill), `User-selected skill: ${skill.name}\n${skill.instructions}`);
  // A procedure that does not fit stays a reference and is named.
  const long = normalizeSkill({...skill, resources: skill.resources.map(resource => resource.path === 'references/procedure.md' ? {...resource, content: '단계 '.repeat(3000)} : resource)});
  const bounded = selectedSkillText(long, {inlineReferences: true});
  assert(!bounded.includes('단계 단계')); assert.match(bounded, /\[references\/checks\.md\]/); assert.match(bounded, /read_skill when needed: .*references\/procedure\.md/);
  const system = context => promptPreamble('gpt', new Date(0), context)[0].content;
  assert.match(system({skill, inlineSkillReferences: true}), /\[references\/procedure\.md\]/);
  assert(!system({skill}).includes('[references/procedure.md]'));
  assert(!system({skill: {id: 'browser-agent', name: 'Browser', instructions: 'x'}, autoConnect: true, inlineSkillReferences: true}).includes('User-selected skill'));
});

test('a skill is found by the site it was made for and the catalog shows that site', async () => {
  const jsm = parseSkillDraft(draft(), skillCreationSource(chat()));
  const other = normalizeSkill({name: '휴가 신청', description: '휴가 신청서를 작성한다. 휴가를 신청할 때 사용한다.', instructions: '휴가 신청 절차', compatibility: '대상 사이트: https://hr.example.test'});
  const library = skillLibrary([jsm, other]), bindings = await bindSkillLibrary(library);
  assert.deepEqual(skillCatalog(library).map(item => item.compatibility), ['대상 사이트: https://jsm.example.test', '대상 사이트: https://hr.example.test']);
  const found = await executeSkillTool(library, bindings, 'find_skills', {query: 'hr.example.test'});
  assert.equal(found.skills[0].name, '휴가 신청');
  assert.equal((await executeSkillTool(library, bindings, 'find_skills', {query: 'jsm 승인 대기'})).skills[0].name, '변경 요청 승인 대기 조회');
});

test('a selected skill offers no search, and the catalog says that a listed skill can be read directly', async () => {
  const {skillLibraryTools} = await import('../skill-library.js');
  const skill = parseSkillDraft(draft(), skillCreationSource(chat()));
  const names = tools => tools.map(tool => tool.function.name);
  assert.deepEqual(names(skillLibraryTools(skillLibrary([skill]))), ['find_skills', 'read_skill']);
  assert.deepEqual(names(skillLibraryTools(skillLibrary([skill], {selectedSkillId: skill.id}), {find: false})), ['read_skill']);
  assert.match(skillLibraryTools(skillLibrary([skill]))[0].function.description, /can be read directly with read_skill and its id/);
  assert.deepEqual(skillLibraryTools([], {find: false}), []);
});
