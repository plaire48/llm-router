// Automatic approval (user decision 2026-09-30: three modes and "always allow", as in Codex and Claude Code).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {checkCommand,approvalPolicy} from '../runtime/approval-policy.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
installAgent(ProjectService);

const scripts={test:'node --test',build:'node build.mjs',lint:'eslint .','check:types':'tsc --noEmit',deploy:'node deploy.mjs',start:'node server.mjs'};

test('a check command is a test, build, lint or check script of the manifest and nothing else',()=>{
  for(const script of ['npm test','npm run build','npm run-script lint','pnpm lint','pnpm run build','yarn check:types','yarn run test','npm.cmd test','npm test -- --test-name-pattern=배송'])assert.equal(checkCommand(script,scripts),true,script);
  for(const script of ['npm install','npm run deploy','npm start','npm build','npx eslint .','node --test','npm test; rm -rf ~','npm test && npm publish','npm run test -- --watch','npm test > out.txt','npm run lint2','npm test $(id)','pnpm deploy',''])assert.equal(checkCommand(script,scripts),false,script);
  assert.equal(checkCommand('npm run lint',{}),false,'a script the manifest does not declare');
  // Found by review (2026-09-30): a check name that also ships or rewrites files is not a check.
  const risky={'build:deploy':'x','test-and-publish':'x','check:release':'x','lint:fix':'x','check:format':'x','build:prod':'x','test:unit':'x'};
  for(const script of ['npm run build:deploy','pnpm test-and-publish','yarn check:release','npm run lint:fix','npm run check:format'])assert.equal(checkCommand(script,risky),false,script);
  for(const script of ['npm run build:prod','npm run test:unit'])assert.equal(checkCommand(script,risky),true,script);
});

async function setup(t){
  const {service,root}=await fixture(t),task=await service.createTask({request:'테스트를 돌려 줘.'});
  await writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture',scripts}));
  service.store.set('task:'+task.id,{...service.task(task.id),state:'review'});
  let at=0;const stamp=()=>new Date(Date.UTC(2026,8,30,0,0,at++)).toISOString();
  const action=(script,extra={})=>{const id='a'+at;service.store.set('setup-action:'+id,{id,taskId:task.id,profile:'bash',script,privilege:'user',fingerprint:'f'+id,state:'proposed',createdAt:stamp(),...extra});return id;};
  const proposal=(file,extra={})=>{const id='p'+at;service.store.set('proposal:'+id,{id,taskId:task.id,path:file,state:'proposed',createdAt:stamp(),...extra});return id;};
  return {service,task,action,proposal,auto:()=>service.autoApprovals({taskId:task.id})};
}

test('the mode is kept for the project; always allow never takes an administrator command',async t=>{
  const {service,action}=await setup(t);
  assert.deepEqual(service.approvalPolicy(),{mode:'ask',allowedCommands:[]});
  assert.throws(()=>service.setApprovalMode({mode:'everything'}),/approval_mode_invalid/);
  assert.equal(service.setApprovalMode({mode:'edits'}).mode,'edits');assert.equal(approvalPolicy(service.store).mode,'edits');
  const admin=action('Set-ExecutionPolicy RemoteSigned',{privilege:'administrator',profile:'powershell'});
  assert.throws(()=>service.allowCommand({id:admin}),/approval_administrator/);
  const plain=action('  npm test  ');
  assert.deepEqual(service.allowCommand({id:plain}).allowedCommands.map(item=>[item.profile,item.script]),[['bash','npm test']]);
  service.allowCommand({id:plain});assert.equal(service.approvalPolicy().allowedCommands.length,1,'allowed once');
  assert.deepEqual(service.removeAllowedCommand({profile:'bash',script:'npm test'}).allowedCommands,[]);
});

test('ask waits for everything except a command the user always allowed',async t=>{
  const {service,action,proposal,auto}=await setup(t);
  proposal('src/a.mjs');action('npm test');
  assert.deepEqual(await auto(),{mode:'ask',proposals:[],command:null});
  service.store.set('setting:approvals',{mode:'ask',allowedCommands:[{profile:'bash',script:'npm test'}]});
  const next=await auto();assert.equal(next.command.reason,'allowed');assert.deepEqual(next.proposals,[]);
});

test('edits applies the newest proposal of each file first, and runs no command by mode',async t=>{
  const {service,action,proposal,auto}=await setup(t);service.setApprovalMode({mode:'edits'});
  const older=proposal('src/a.mjs'),newer=proposal('src/a.mjs'),other=proposal('src/b.mjs');action('npm test');
  const next=await auto();assert.deepEqual(next.proposals,[other,newer]);assert.equal(next.command,null);
  for(const id of [older,newer,other])service.store.set('proposal:'+id,{...service.store.get('proposal:'+id),state:'applied'});
  assert.deepEqual(await auto(),{mode:'edits',proposals:[],command:null});
});

test('commands runs the check scripts of the manifest, never another command or an administrator one',async t=>{
  const {service,action,auto}=await setup(t);service.setApprovalMode({mode:'commands'});
  action('npm run deploy');action('Remove-Item -Recurse build',{privilege:'administrator',profile:'powershell'});
  assert.equal((await auto()).command,null);
  const tests=action('npm test');
  assert.deepEqual((await auto()).command,{kind:'setup',id:tests,fingerprint:'f'+tests,script:'npm test',reason:'check'});
});

test('a command that waits for its fix, a running agent or an open question is not approved automatically',async t=>{
  const {service,task,action,proposal,auto}=await setup(t);service.setApprovalMode({mode:'commands'});
  const fix=proposal('src/a.mjs');service.setApprovalMode({mode:'ask'});
  service.store.set('setting:approvals',{mode:'ask',allowedCommands:[{profile:'bash',script:'npm test'}]});
  action('npm test',{afterProposals:[fix]});
  assert.equal((await auto()).command,null,'held until the fix is applied');
  service.store.set('proposal:'+fix,{...service.store.get('proposal:'+fix),state:'applied'});
  assert.equal((await auto()).command.reason,'allowed');
  service.agent={running:true,taskId:task.id};assert.equal((await auto()).command,null);service.agent=null;
  service.store.set('task:'+task.id,{...service.task(task.id),question:{id:'q',text:'어느 쪽?'}});assert.equal((await auto()).command,null);
});
