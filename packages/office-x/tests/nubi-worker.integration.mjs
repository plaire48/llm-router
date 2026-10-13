import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'fixture',exp:Date.now()/1000+3600})).toString('base64url')+'.fixture';
const child=spawn(process.execPath,['--require','./tests/nubi-fetch.fixture.cjs','dist/worker/main.cjs']);
const lines=createInterface({input:child.stdout});let stderr='',started=false,loginRequested=false,done=0,read=0,vault=0;child.stderr.on('data',x=>stderr+=x);
const send=m=>child.stdin.write(JSON.stringify(m)+'\n');
const start=()=>send({type:'start',runId:'run-'+done,conversationId:'same',request:done?'후속 질문':'첫 질문',context:{documentId:'fixture',worksheetId:'sheet',address:'C1:E4'}});
let timeout;
try{
 await Promise.race([new Promise((resolve,reject)=>{
   child.once('error',reject);child.once('exit',()=>reject(Error('worker_exited')));
   lines.on('line',line=>{try{
     const m=JSON.parse(line);
     if(m.type==='vault_write'){vault++;send({type:'vault_result',id:m.id,ok:true});return;}
     assert.ok(!line.includes(token),'credential exposed outside private vault channel');
     if(m.type==='ready'){assert.equal(m.engine,'genoffice');send({type:'init',records:[{version:1,provider:'aipro',credential:{token,mode:'browser'},model:'fixture-a'}],selected:'aipro'});}
     if(m.type==='provider_state'&&!m.state.initializing&&!loginRequested){assert.equal(m.state.connected,false,'startup must not auto-login');assert.equal(m.state.pending,null);loginRequested=true;send({type:'provider',id:'manual-login',method:'login',input:'aipro'});}
     if(m.type==='provider_state'&&!m.state.initializing&&m.state.connected&&!m.state.authBusy&&!started){started=true;start();}
     if(m.type==='tool'&&m.id){read++;send({type:'provider',id:'busy',method:'model',input:'other'});send({type:'tool_result',id:m.id,runId:m.runId,result:{snapshotId:'s',cells:[],address:'C1:E4'}});}
     if(m.type==='reply'&&m.id==='busy')assert.equal(m.error,'worker_busy');
     if(m.type==='error')reject(Error(m.error));
     if(m.type==='done'){assert.equal(m.result.cancelled,false);done++;if(done===1)setTimeout(start,0);else resolve();}
   }catch(e){reject(e);}});
 }),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('timeout')),15000);})]);
 assert.equal(read,1);assert.equal(done,2);assert.ok(vault>0);assert.equal(stderr,'');
 child.stdin.end();await once(child,'exit');
 console.log('PASS no startup login → user-started protected connection restore → Nubi provider → GenOffice tools → follow-up context over stdio; busy model change denied; no UI credential leak (fixtures).');
}finally{clearTimeout(timeout);child.kill();lines.close();}
