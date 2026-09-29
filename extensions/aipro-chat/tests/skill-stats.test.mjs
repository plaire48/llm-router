import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {skillStats, recordSkillUse, forgetSkill, skillRecord, skillRecordText} from '../skill-stats.js';
import {normalizeSkill} from '../skills.js';
import {skillLibrary, bindSkillLibrary, executeSkillTool} from '../skill-library.js';

const now = Date.parse('2026-09-01T00:00:00Z');

test('a finished run counts once for each skill it used, and only counts are kept', () => {
  let stats = recordSkillUse(undefined, ['custom-a', 'custom-a', 'browser-agent', 'custom-b', 42, 'custom-' + 'x'.repeat(90)], 'passed', now);
  assert.deepEqual(stats, {'custom-a': {uses: 1, passed: 1, failed: 0, lastUsedAt: now, lastOutcome: 'passed'}, 'custom-b': {uses: 1, passed: 1, failed: 0, lastUsedAt: now, lastOutcome: 'passed'}});
  stats = recordSkillUse(stats, ['custom-a'], 'failed', now + 1000);
  assert.deepEqual(skillRecord(stats, 'custom-a'), {uses: 2, passed: 1, failed: 1, lastUsedAt: now + 1000, lastOutcome: 'failed'});
  assert.equal(skillRecordText(skillRecord(stats, 'custom-a')), '사용 2회 · 검토 통과 1회 · 최근 사용은 검토를 통과하지 못함');
  assert.equal(skillRecordText(skillRecord(stats, 'custom-b')), '사용 1회 · 검토 통과 1회');
  assert.equal(skillRecordText(null), ''); assert.equal(skillRecord(stats, 'custom-none'), null);
  assert.deepEqual(recordSkillUse(stats, ['custom-a'], 'cancelled', now + 2000), stats);
  assert.deepEqual(Object.keys(forgetSkill(stats, 'custom-a')), ['custom-b']);
});

test('stored records are checked again and bounded', () => {
  const forged = {'custom-a': {uses: 2, passed: 5, failed: 0, lastUsedAt: now, lastOutcome: 'passed'}, 'custom-b': {uses: -1}, 'custom-c': {uses: 1, passed: 1, failed: 0, lastUsedAt: now + 99999, lastOutcome: 'PRIVATE', note: 'PRIVATE'},
    'other': {uses: 1, passed: 1, failed: 0, lastUsedAt: now, lastOutcome: 'passed'}, 'custom-d': 'PRIVATE'};
  assert.deepEqual(skillStats(forged, now), {'custom-c': {uses: 1, passed: 1, failed: 0, lastUsedAt: 0, lastOutcome: 'failed'}});
  assert(!JSON.stringify(skillStats(forged, now)).includes('PRIVATE'));
  let many;
  for (let index = 0; index < 60; index++) many = recordSkillUse(many, [`custom-${index}`], 'passed', now + index);
  assert.equal(Object.keys(many).length, 40); assert(many['custom-59']); assert.equal(many['custom-0'], undefined);
  for (const value of [null, [], 'x', 3]) assert.deepEqual(skillStats(value, now), {});
});

test('find_skills shows how a skill fared and the host records use at the end of a run', async () => {
  const skill = normalizeSkill({id: 'custom-a', name: '승인 대기 조회', description: '승인 대기 건을 조회한다. 승인 대기 현황을 물을 때 사용한다.', instructions: '목록을 연다'});
  const fresh = normalizeSkill({id: 'custom-b', name: '승인 대기 알림', description: '승인 대기 알림을 정리한다.', instructions: '알림을 연다'});
  const library = skillLibrary([skill, fresh]), bindings = await bindSkillLibrary(library);
  const stats = recordSkillUse(recordSkillUse(undefined, ['custom-a'], 'passed', now), ['custom-a'], 'failed', now + 1);
  const found = await executeSkillTool(library, bindings, 'find_skills', {query: '승인 대기'}, stats);
  assert.deepEqual(found.skills.find(item => item.id === 'custom-a').record, {uses: 2, reviewPassed: 1, lastOutcome: 'failed'});
  assert.equal(found.skills.find(item => item.id === 'custom-b').record, undefined);
  assert.equal((await executeSkillTool(library, bindings, 'find_skills', {query: '승인 대기'})).skills[0].record, undefined);
  const background = await readFile(new URL('../public/background.js', import.meta.url), 'utf8');
  assert.match(background, /recordSkillUse\(\(await chrome\.storage\.local\.get\('skillStats'\)\)\.skillStats, skillsUsed, !error && chat\.task\.goalReview\?\.status === 'complete' \? 'passed' : 'failed'\)/);
  // A login, quota or stopped run says nothing about the skill; a paused run carries what it used.
  assert.match(background, /!awaitingUser && \(!error \|\| \['verification_required', 'goal_review_failed'\]\.includes\(error\)\)/);
  assert.match(background, /resumeTask\?\.used \? \{used: resumeTask\.used\}/); assert.match(background, /skillsRead: \(Array\.isArray\(resumeTask\.used\.skills\)/);
  assert.match(background, /skillStats: forgetSkill\(records, message\.id\)/);
});
