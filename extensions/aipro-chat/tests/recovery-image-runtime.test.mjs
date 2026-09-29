import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';

const tools=[{type:'function',function:{name:'capture_page',parameters:{type:'object',properties:{}}}}];
const done={content:'관찰 완료',calls:null};
async function scenario(changing) {
  let executions=0;
  const diagnostics=[];
  const promise=runAgent({messages:[{role:'user',content:'화면을 확인해줘'}],tools,harness:false,
    signal:new AbortController().signal,onDiagnostic:event=>diagnostics.push(event),
    complete:async()=>executions<7?{calls:[{id:crypto.randomUUID(),type:'function',function:{name:'capture_page',arguments:'{}'}}]}:done,
    execute:async()=>({ok:true,screenshot_id:`capture-${++executions}`,attachment:{id:`attachment-${executions}`,availableInChat:true},
      capture_mode:'viewport',viewport:{width:800,height:600},
      observation:{tabId:1,topDocumentId:'document',url:'https://example.test/',frames:[{frame:0,documentId:'document',text:'Same DOM'}]},
      image:{mimeType:'image/png',data:Buffer.from(changing?`image-bytes-${executions}`:'same-image-bytes').toString('base64')}})});
  return {promise,getExecutions:()=>executions,diagnostics};
}

test('runtime image digest lets genuinely different returned bytes remain new evidence',async()=>{
  const run=await scenario(true);
  assert.equal(await run.promise,done);
  assert.equal(run.getExecutions(),7);
  assert(!JSON.stringify(run.diagnostics).includes('imageHash'));
});

test('runtime repeated image bytes with fresh capture IDs stop rather than claim progress',async()=>{
  const run=await scenario(false);
  await assert.rejects(run.promise,/agent_stalled/);
  assert(run.getExecutions()<7);
});
