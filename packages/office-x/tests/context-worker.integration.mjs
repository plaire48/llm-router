import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
const child=spawn(process.execPath,['--require','./tests/context-fetch.fixture.cjs','dist/worker/main.cjs']);
const lines=createInterface({input:child.stdout}),messages=[],waiters=[];let stderr='';child.stderr.on('data',b=>stderr+=b);
lines.on('line',line=>{const m=JSON.parse(line);if(m.type==='vault_write'){send({type:'vault_result',id:m.id,ok:true});return;}messages.push(m);for(const w of [...waiters])if(w.test(m)){waiters.splice(waiters.indexOf(w),1);clearTimeout(w.timer);w.resolve(m);}});
const send=m=>child.stdin.write(JSON.stringify(m)+'\n');
const wait=test=>new Promise((resolve,reject)=>{const prior=messages.find(test);if(prior)return resolve(prior);const w={test,resolve,timer:setTimeout(()=>reject(Error('worker_timeout: '+stderr)),10000)};waiters.push(w);});
const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'fixture',exp:Date.now()/1000+3600})).toString('base64url')+'.fixture';
try{
 await wait(m=>m.type==='ready');send({type:'init',records:[{version:1,provider:'aipro',credential:{token,mode:'browser'},model:'fixture-a'}],selected:'aipro'});
 await wait(m=>m.type==='provider_state'&&!m.state.initializing);send({type:'provider',id:'login',method:'login',input:'aipro'});await wait(m=>m.type==='reply'&&m.id==='login'&&!m.error);
 for(let i=0;i<3;i++){send({type:'start',runId:'r'+i,conversationId:'same',request:'현재 문서를 확인해줘 '+i+' 목적과 조건을 유지해줘 '.repeat(120),context:{app:'excel',documentId:'d',worksheetId:'s'+i,address:'A'+(i+1)}});const done=await wait(m=>m.type==='done'&&m.runId==='r'+i);assert.equal(done.result.cancelled,false);}
 assert.ok(messages.some(m=>m.type==='context_state'&&m.usage.kind==='measured'&&m.usage.used===1200));
 send({type:'context',id:'compact',method:'compact',input:{conversationId:'same'}});const reply=await wait(m=>m.type==='reply'&&m.id==='compact');assert.equal(reply.result.status,'compacted');assert.equal(reply.result.stats.count,1);assert.ok(reply.result.stats.afterTokens<reply.result.stats.beforeTokens);
 await wait(m=>m.type==='context_compacting'&&!m.active);assert.equal(messages.filter(m=>m.type==='tool').length,0,'context operations must never access Office');
 send({type:'start',runId:'follow',conversationId:'same',request:'현재 문서 남은 작업 알려줘',context:{app:'excel',documentId:'d',worksheetId:'different',address:'Z99'}});const done=await wait(m=>m.type==='done'&&m.runId==='follow');assert.equal(done.result.cancelled,false);assert.ok(!done.result.recovery);
 assert.equal(stderr,'');child.stdin.end();await once(child,'exit');console.log('PASS actual worker stdio: user login, measured usage, same-document history across selections, text-only manual compression, summary retained in follow-up, no search/native calls (provider fixtures).');
}finally{child.kill();lines.close();for(const w of waiters)clearTimeout(w.timer);}
