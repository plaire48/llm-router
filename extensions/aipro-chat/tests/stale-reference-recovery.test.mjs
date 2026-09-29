import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
if (!tools.some(tool => tool.function.name === 'capture_page')) tools.push({type: 'function', function: {name: 'capture_page', parameters: {type: 'object', properties: {full_page: {type: 'boolean'}}}}});
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const observation = tag => ({title: 't', url: 'https://example.test/', frames: [{frame: 0, url: 'https://example.test/', elements: [{ref: `c-${tag}-0`, name: '검색', role: 'searchbox', kind: 'field', tag: 'input'}], text: '검색'}]});

async function run(error) {
  const goal = '검색창에 박물관을 검색해 줘.', executed = []; let rounds = 0;
  assert(tools.some(tool => tool.function.name === 'capture_page'));
  await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => ++rounds === 1 ? call('browser_snapshot', {query: '검색'}) : rounds === 2 ? call('click_element', {ref: 'c-a-0'}) : {content: '입력하지 못했습니다.'},
    execute: async name => {
      executed.push(name);
      if (name === 'browser_snapshot') return observation('a');
      if (name === 'click_element') return {ok: false, error, reason: error, actionIssued: false, observation: observation('b')};
      if (name === 'capture_page') return {ok: true, image: {mimeType: 'image/png', data: 'AAAA'}, observation: observation('c')};
      return {requiresUserInput: true};
    },
    reviewGoal: async () => ({status: 'complete', checks: [{requirement: '결과 보고', status: 'met', evidence_ids: [1]}], next_step: ''})}).catch(() => {});
  return executed;
}

test('a stale reference failure keeps the refs of its own fresh observation: no automatic capture', async () => {
  assert.deepEqual((await run('browser_stale')).filter(name => ['click_element', 'capture_page'].includes(name)), ['click_element']);
});

test('a hidden or obscured target still gets one visual observation', async () => {
  assert.deepEqual((await run('script_obscured')).filter(name => ['click_element', 'capture_page'].includes(name)), ['click_element', 'capture_page']);
});
