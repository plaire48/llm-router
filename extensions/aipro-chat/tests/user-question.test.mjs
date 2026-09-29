import test from 'node:test';
import assert from 'node:assert/strict';
import {questionArgs, textQuestionArgs, makeQuestion, questionAnswer, questionContext, QUESTION_TEXT_LIMIT} from '../user-question.js';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

test('short answer cues survive planner normalization and persistence without becoming answers', () => {
  const wire = {question: '어느 팀의 안내문인가요?', input_placeholder: '팀 이름만 적어주세요.'};
  assert.deepEqual(textQuestionArgs(wire), wire);
  const args = questionArgs(wire), question = makeQuestion(args.question, [], [], args);
  assert.equal(question.inputPlaceholder, wire.input_placeholder);
  assert.equal(question.answer, undefined);
  assert.equal(question.draft, undefined);
  assert.throws(() => questionAnswer(question, {questionId: question.id, text: ''}), /question_changed/);
  assert.equal(questionAnswer(question, {questionId: question.id, text: '디자인팀'}), '디자인팀');
  for (const input_placeholder of ['', '  ', 12, 'x'.repeat(101), '첫 항목\n두 번째 항목']) {
    assert.throws(() => textQuestionArgs({...wire, input_placeholder}), /tool_arguments_invalid/);
  }
});

test('image choices require distinct observed refs and real saved page attachments', () => {
  for (const image_refs of [['https://fake.test/icon'], ['img-a'], ['img-a', 'img-a']]) assert.throws(() => questionArgs({question: '어느 이미지인가요?', image_refs}));
  assert.deepEqual(questionArgs({question: '위치를 알려주세요.'}).refs, []);
  assert.throws(() => makeQuestion('어느 이미지인가요?', [{id: 'a', availableInChat: true}], []));
  assert.throws(() => makeQuestion('어느 이미지인가요?', [{id: 'a', availableInChat: false}], [{id: 'a', source: 'page-image'}]));
  const question = makeQuestion('어느 이미지인가요?', ['a','b'].map(id => ({id, availableInChat: true})), ['a','b'].map(id => ({id, source: 'page-image', label: '가방'})));
  const answer = questionAnswer(question, {questionId: question.id, optionId: 'b'});
  assert.match(answer, /2번 이미지/);
  assert.throws(() => questionAnswer(question, {questionId: 'old', optionId: 'b'}));
  assert.throws(() => questionAnswer({...question, answer: {text: answer}}, {questionId: question.id, optionId: 'b'}));
  assert.match(questionContext({question}), /2\. 가방/);
});

test('a saved question stops the agent without more model calls, actions or completion review', async () => {
  let calls = 0; const executed = [];
  const result = await runAgent({messages: [{role: 'user', content: '가방 아이콘을 찾아줘'}],
    tools: browserTools({}, BUILTIN_SKILLS[0]), harness: true, signal: new AbortController().signal,
    complete: async () => {calls++; return {content: '', usage: {total_tokens: 12}, calls: [
      {id: 'premature-action', type: 'function', function: {name: 'fill_form', arguments: JSON.stringify({fields: [{field_id: 'unconfirmed', value: 'guessed'}]})}},
      {id: 'question', type: 'function', function: {name: 'ask_user', arguments: JSON.stringify({question: '어디에 있는 아이콘인가요?'})}},
      {id: 'unsafe-followup', type: 'function', function: {name: 'click_element', arguments: JSON.stringify({ref: 'stale'})}},
    ]};},
    execute: async name => {executed.push(name); return {requiresUserInput: true, questionId: 'saved'};},
    reviewGoal: async () => {throw new Error('Must not review a clarification as completed work');},
  });
  assert.equal(calls, 1); assert.deepEqual(executed, ['ask_user']);
  assert.equal(result.awaitingUser, true); assert.equal(result.content, ''); assert.equal(result.usage.total_tokens, 12);
});

test('every selected skill can ask without granting page or image capabilities', async () => {
  const custom = {id: 'custom-writing', name: '글쓰기', instructions: 'Write clearly.'};
  for (const skill of [...BUILTIN_SKILLS, custom]) {
    let calls = 0, asked = false;
    const tools = browserTools(null, skill);
    assert.deepEqual(tools.map(tool => tool.function.name), ['ask_user']);
    const result = await runAgent({messages: [{role: 'user', content: '정리해줘'}], tools, signal: new AbortController().signal,
      complete: async () => {calls++; return {content: '', calls: [{id: 'q', type: 'function', function: {name: 'ask_user', arguments: JSON.stringify({question: '어떤 내용을 정리할까요?'})}}]};},
      execute: async name => {assert.equal(name, 'ask_user'); asked = true; return {requiresUserInput: true};},
    });
    assert(asked); assert.equal(calls, 1); assert.equal(result.awaitingUser, true);
  }
});

test('a failed question continues recovery and cannot bypass the harness', async () => {
  let calls = 0;
  const result = await runAgent({messages: [{role: 'user', content: '가방'}], tools: browserTools({}, BUILTIN_SKILLS[0]), signal: new AbortController().signal,
    complete: async () => ++calls === 1 ? {content: '', calls: [{id: 'q', type: 'function', function: {name: 'ask_user', arguments: JSON.stringify({question: '어느 이미지인가요?'})}}]} : {content: '후보를 저장하지 못했습니다.', calls: null},
    execute: async () => ({error: 'capture_storage_full'}),
  });
  assert.equal(calls, 2); assert.equal(result.awaitingUser, undefined);
});

test('visual comparison is available only for an image-capable provider and model', () => {
  const names = (model, vision) => browserTools({}, BUILTIN_SKILLS[0], model, {vision}).map(t => t.function.name);
  assert(names('QWEN3.8-27B-FP8-256K', true).includes('inspect_images'));
  assert(!names('QWEN3.8-27B-FP8-256K', false).includes('inspect_images'));
  assert(!names('GLM-5.2-NVFP4', true).includes('inspect_images'));
  assert(names('GLM-5.2-NVFP4', true).includes('ask_user'));
});

test('text choices and narrative questions retain explicit answers without inventing image evidence', () => {
  const args = questionArgs({question: '어떤 형태로 작성할까요?', choices: [{label: '요약', description: '핵심 내용만 정리'}, {label: '보고서'}], input_mode: 'long_text'});
  const question = makeQuestion(args.question, [], [], args);
  assert.equal(question.inputMode, 'long_text');
  assert.equal(questionAnswer(question, {questionId: question.id, optionId: 'option-2'}), '보고서');
  assert.equal(questionAnswer(question, {questionId: question.id, text: '직접 작성한\n상세 요구사항'}), '직접 작성한\n상세 요구사항');
  assert.match(questionContext({question}), /핵심 내용만 정리/);
  assert.doesNotMatch(questionContext({question}), /이미지|다운로드/);
  for (const text of ['', '  ', 'x'.repeat(QUESTION_TEXT_LIMIT + 1), 42]) assert.throws(() => questionAnswer(question, {questionId: question.id, text}));
  assert.throws(() => questionAnswer(question, {questionId: question.id, text: '승인', optionId: 'option-1'}));
  assert.throws(() => questionAnswer({...question, kind: 'approval'}, {questionId: question.id, text: '승인'}));
  assert.throws(() => questionAnswer(question, {questionId: 'stale', text: '답변'}));
  for (const extra of [{choices: [{label: '혼자'}]}, {choices: [{label: '중복'}, {label: ' 중복 '}]}, {choices: [{label: ' '}, {label: '다른 값'}]}, {choices: [{label: 'a'}, {label: 'b'}], image_refs: ['img-a','img-b']}, {input_mode: 'password'}]) assert.throws(() => questionArgs({question: '질문', ...extra}));
});

test('submitted answers retain their question as user context and repeated forms return the answer', async () => {
  const {repeatedQuestionAnswer} = await import('../user-question.js');
  const args = questionArgs({question: '마감일은 언제인가요?'});
  const question = {...makeQuestion(args.question, [], [], args), answer: {text: '목요일\n오후 3시'}};
  const clarification = {questionId: question.id, question: question.text, answer: question.answer.text};
  const wire = questionContext({role: 'user', content: question.answer.text, clarification});
  assert(wire.includes(JSON.stringify(clarification)));
  assert.equal(repeatedQuestionAnswer(question, args).answer, question.answer.text);
  assert.equal(repeatedQuestionAnswer({...question, kind: 'approval'}, args), null);
  assert.equal(repeatedQuestionAnswer({...question, kind: 'image'}, args), null);
  assert.equal(repeatedQuestionAnswer(undefined, args), null);
  assert.equal(repeatedQuestionAnswer(question, {...args, question: '어느 시간대인가요?'}), null);
  assert.equal(repeatedQuestionAnswer(question, {...args, choices: [{label:'오전'},{label:'오후'}]}), null);
});

test('a repeated question returns to reasoning instead of reopening a form or terminating', async () => {
  let calls = 0, questions = 0;
  const result = await runAgent({messages:[{role:'user',content:'목요일 오후 3시'}], tools:browserTools({},BUILTIN_SKILLS[0]), signal:new AbortController().signal,
    harness:true, assessCompletion:async()=>({decision:'reply'}), reviewGoal:async()=>{throw new Error('A question is not browser evidence');},
    complete:async () => ++calls === 1 ? {content:'',calls:[{id:'q',type:'function',function:{name:'ask_user',arguments:JSON.stringify({question:'마감일은 언제인가요?'})}}]} : {content:'목요일 오후 3시로 정리하겠습니다.',calls:null},
    execute:async () => {questions++;return {error:'question_already_answered',answer:'목요일 오후 3시'};}});
  assert.equal(calls,2);assert.equal(questions,1);assert.equal(result.awaitingUser,undefined);
});
