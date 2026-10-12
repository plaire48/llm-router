import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

// Real child process + real GenOffice provider parser; fake model and fake Office.
// No enterprise service, credentials, file or installed Office is involved.
let turn=0;
const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);assert.equal(request.model,'fixture-model');
  const tools=[['read_selection',{}],['set_formula',{snapshotId:'snapshot',operations:[{address:'E2',formula:'=C2*D2'}]}],['calculate_and_read',{}]];
  const tool=tools[turn++];
  res.writeHead(200,{'content-type':'text/event-stream'});
  const delta=tool?{tool_calls:[{index:0,id:`call-${turn}`,type:'function',function:{name:tool[0],arguments:JSON.stringify(tool[1])}}]}:{content:'수식과 계산값을 확인했습니다. 저장하지 않았습니다.'};
  res.end(`data: ${JSON.stringify({choices:[{delta}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:tool?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const child=spawn(process.execPath,['dist/worker/main.cjs'],{stdio:['pipe','pipe','pipe']});
let stderr='';child.stderr.on('data',data=>stderr+=data);const names=[];
const lines=createInterface({input:child.stdout});
const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
const runId='fixture-run';
const completed=new Promise((resolve,reject)=>{
  child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(`worker exited ${code}`));});
  lines.on('line',line=>{
    try {
      const msg=JSON.parse(line);
      if(msg.type==='ready') {
        assert.equal(msg.engine,'genoffice');
        send({type:'start',runId,request:'금액 열에 수식을 입력해줘',context:{documentId:'fixture'},
          config:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture-model',apiKey:''}});
      } else if(msg.type==='tool'&&msg.id) {
        assert.equal(msg.runId,runId);names.push(msg.name);
        const result=msg.name==='set_formula'?{status:'verified',mutated:true,saved:false,cells:[{address:'E2',formula:'=C2*D2',actualValue:3000,status:'verified'}]}:
          {snapshotId:'snapshot',documentId:'fixture',worksheetId:'sheet',address:'C1:E2',cells:[]};
        send({type:'tool_result',id:msg.id,runId,result});
      } else if(msg.type==='done') resolve(msg.result);
      else if(msg.type==='error') reject(new Error(msg.error));
    } catch(e){reject(e);}
  });
});
let timer;
try {
  const result=await Promise.race([completed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('worker timeout')),15000);})]);
  assert.equal(result.cancelled,false);assert.equal(result.turnLimit,false);
  assert.deepEqual(names,['read_selection','set_formula','calculate_and_read']);assert.equal(turn,4);assert.equal(stderr,'');
  child.stdin.end();await once(child,'exit');
  console.log('PASS stdio + GenOffice SSE tool loop: read → write receipt → readback → final response (mock provider/Office).');
}finally{clearTimeout(timer);child.kill();lines.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
