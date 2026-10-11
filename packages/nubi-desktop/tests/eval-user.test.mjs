import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createUser,applyProposals,commandVerdict} from '../eval/user.mjs';

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

test('a command is allowed only as one plain command the case names',()=>{
  const patterns=['npm(?:\\.cmd)? (?:run )?test(?: .+)?','node --test(?: .+)?'],verdict=script=>commandVerdict(patterns,script,'/work/repo');
  for(const script of ['npm test','npm run test','NPM TEST','node --test test/discount.test.mjs','npm test 2>&1','npm test 2>&1 | tail -n 80','npm test | head -40','cd /work/repo && npm test','cd "/work/repo" && npm test 2>&1','cd . && node --test'])assert.equal(verdict(script),'allowed',script);
  for(const script of ['npm test; rm -rf ~','npm test && npm publish','npm test | sh','npm test > out.txt','npm test $(whoami)','npm test `id`','npm install','node --testx','node -e 1','','npm test\nrm -rf ~'])assert.equal(verdict(script),'not_allowed',script);
  assert.equal(verdict('cd /tmp && npm test'),'outside_workspace');assert.equal(verdict('cd .. && npm test'),'outside_workspace');
});

test('on a Windows PC the same plain command written for PowerShell or CMD is read the same way',()=>{
  const patterns=['npm(?:\\.cmd)? (?:run )?test(?: .+)?','node --test(?: .+)?'],verdict=(script,profile)=>commandVerdict(patterns,script,'/work/repo',profile);
  for(const script of ['node --test test\\discount.test.mjs','npm.cmd test 2>&1 | Select-Object -Last 80','npm test | select -First 40','Set-Location . ; npm test','cd . && npm test'])assert.equal(verdict(script,'powershell'),'allowed',script);
  assert.equal(verdict('cd /d . && node --test test\\order.test.mjs','cmd'),'allowed');
  for(const script of ['npm test; Remove-Item -Recurse ~','npm test $env:USERPROFILE','npm test `n','npm test | Out-File x','npm test (whoami)','& npm test'])assert.equal(verdict(script,'powershell'),'not_allowed',script);
  for(const script of ['npm test %USERPROFILE%','npm test ^& calc'])assert.equal(verdict(script,'cmd'),'not_allowed',script);
  assert.equal(verdict('Set-Location C:\\Windows; npm test','powershell'),'outside_workspace');
  // The shell decides: in Bash a backslash is still an escape.
  assert.equal(verdict('node --test test\\discount.test.mjs','bash'),'not_allowed');
});

test('the oldest open command of the task is approved once; others need a person',async()=>{
  const calls=[],setupActions=[
    {id:'late',taskId:'t',state:'proposed',script:'npm test',fingerprint:'f2',createdAt:'2'},
    {id:'early',taskId:'t',state:'proposed',script:'node --test',fingerprint:'f1',createdAt:'1'},
    {id:'other',taskId:'x',state:'proposed',script:'npm test',fingerprint:'f3',createdAt:'0'},
    {id:'done',taskId:'t',state:'started',script:'npm test',fingerprint:'f4',createdAt:'0'}];
  const service={state:()=>({setupActions,commandRepairs:[]}),decideSetupAction:async({id,fingerprint,decision})=>{calls.push([id,fingerprint,decision]);return {state:'started',resultProcessId:'p-'+id};}};
  const user=createUser({approvals:['command'],commands:['npm test','node --test']});
  assert.deepEqual(await user.approveCommand({service,taskId:'t',root:'/work/repo'}),{processId:'p-early'});
  assert.deepEqual(await user.approveCommand({service,taskId:'t',root:'/work/repo'}),{processId:'p-late'});
  assert.equal(await user.approveCommand({service,taskId:'t',root:'/work/repo'}),null,'each command is tried once');
  assert.deepEqual(calls,[['early','f1','approve'],['late','f2','approve']]);
  assert.deepEqual(user.log.commands.map(item=>item.script),['node --test','npm test']);
  const admin=createUser({approvals:['command'],commands:['npm test']});
  assert.deepEqual(await admin.approveCommand({service:{state:()=>({setupActions:[{id:'a',taskId:'t',state:'proposed',script:'npm test',privilege:'administrator',createdAt:'1'}],commandRepairs:[]})},taskId:'t',root:'/r'}),{refused:'administrator'});
  const unlisted=createUser({approvals:['command'],commands:['npm test']});
  assert.deepEqual(await unlisted.approveCommand({service:{state:()=>({setupActions:[{id:'b',taskId:'t',state:'proposed',script:'npm install',createdAt:'1'}],commandRepairs:[]})},taskId:'t',root:'/r'}),{refused:'not_allowed'});
  assert.deepEqual(unlisted.log.refused,[{kind:'command',script:'npm install',reason:'not_allowed'}]);
});

test('a command repair is approved through its own call and a failed approval is recorded',async()=>{
  const repairs=[{id:'r1',taskId:'t',state:'proposed',script:'npm test',createdAt:'1'}];
  const service={state:()=>({setupActions:[],commandRepairs:repairs}),applyCommandRepair:async({id})=>{if(id==='r1')throw new Error('recovery_changed');}};
  const user=createUser({approvals:['command'],commands:['npm test']});
  assert.deepEqual(await user.approveCommand({service,taskId:'t',root:'/r'}),{skipped:'recovery_changed'});
  assert.deepEqual(user.log.commands,[{kind:'repair',script:'npm test',state:'failed',reason:'recovery_changed'}]);
});
