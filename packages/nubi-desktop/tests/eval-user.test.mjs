import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUser,applyProposals} from '../eval/user.mjs';

const question={id:'q1',text:'어느 등급의 할인율을 바꿀까요?',kind:'choice',options:[{id:'option-1',label:'골드'},{id:'option-2',label:'VIP'}]};

test('a defined answer is given once, as an option when the label matches',()=>{
  const user=createUser({dialogue:[{match:'등급',answer:'골드'}]});
  assert.deepEqual(user.answer(question),{choice:{questionId:'q1',optionId:'option-1'}});
  assert.equal(user.answer(question),null,'the same defined answer is not reused');
  assert.deepEqual(user.log.questions,[question.text,question.text]);assert.deepEqual(user.log.answers,['골드']);
});

test('free text is used when no option matches, and for plain text questions',()=>{
  assert.deepEqual(createUser({dialogue:[{match:'등급',answer:'실버 등급을 5퍼센트로'}]}).answer(question),{choice:{questionId:'q1',text:'실버 등급을 5퍼센트로'}});
  assert.deepEqual(createUser({dialogue:[{match:'범위',answer:'현재 화면'}]}).answer('범위는 어디까지인가요?'),{answer:'현재 화면'});
});

test('no match or more than one match needs a person',()=>{
  assert.equal(createUser({}).answer(question),null);
  assert.equal(createUser({dialogue:[{match:'배송',answer:'제주'}]}).answer(question),null);
  assert.equal(createUser({dialogue:[{match:'등급',answer:'골드'},{match:'할인율',answer:'VIP'}]}).answer(question),null);
});

test('only the approval kinds of the case are allowed',()=>{
  const user=createUser({approvals:['patch']});
  assert.equal(user.allows('patch'),true);assert.equal(user.allows('new_file'),false);
  for(const kind of ['command','setup','elevation','computer','repair'])assert.equal(user.allows(kind),false);
  assert.equal(createUser({}).allows('patch'),false);
});

test('only the newest open proposal of this task is applied per path',async()=>{
  const calls=[],proposals=[
    {id:'old',taskId:'t',path:'src/a.mjs',state:'proposed',createdAt:'2026-01-01T00:00:00.000Z'},
    {id:'new',taskId:'t',path:'src/a.mjs',state:'proposed',createdAt:'2026-01-01T00:00:05.000Z'},
    {id:'file',taskId:'t',path:'src/b.mjs',kind:'create',state:'proposed',createdAt:'2026-01-01T00:00:02.000Z'},
    {id:'done',taskId:'t',path:'src/c.mjs',state:'applied',createdAt:'2026-01-01T00:00:03.000Z'},
    {id:'other',taskId:'other-task',path:'src/d.mjs',state:'proposed',createdAt:'2026-01-01T00:00:04.000Z'},
  ];
  const service={state:()=>({proposals}),
    prepareProposal:async({proposalId})=>{calls.push('prepare:'+proposalId);return {alreadyApplied:true};},
    confirmProposal:async({proposalId})=>{calls.push('confirm:'+proposalId);},
    applyNewFile:async({proposalId})=>{calls.push('create:'+proposalId);}};
  const user=createUser({approvals:['patch','new_file']});
  await applyProposals({service,taskId:'t',user,root:'/unused'});
  assert.deepEqual(calls,['prepare:new','create:file']);
  assert.deepEqual(user.log.applied,[{path:'src/a.mjs',kind:'patch'},{path:'src/b.mjs',kind:'new_file'}]);
});

test('a refused or failed apply is recorded and does not stop the others',async()=>{
  const proposals=[{id:'a',taskId:'t',path:'src/a.mjs',state:'proposed',createdAt:'2'},{id:'b',taskId:'t',path:'src/b.mjs',kind:'create',state:'proposed',createdAt:'1'}];
  const service={state:()=>({proposals}),prepareProposal:async()=>{throw new Error('source_stale');},confirmProposal:async()=>{},applyNewFile:async()=>{throw new Error('Raw failure at /Users/someone/secret');}};
  const patchOnly=createUser({approvals:['patch']});await applyProposals({service,taskId:'t',user:patchOnly,root:'/unused'});
  assert.deepEqual(patchOnly.log.refused,[{path:'src/a.mjs',kind:'patch',reason:'source_stale'},{path:'src/b.mjs',kind:'new_file',reason:'not_allowed'}]);
  const both=createUser({approvals:['patch','new_file']});await applyProposals({service,taskId:'t',user:both,root:'/unused'});
  assert.deepEqual(both.log.refused.map(item=>item.reason),['source_stale','apply_failed']);assert.deepEqual(both.log.applied,[]);
});
