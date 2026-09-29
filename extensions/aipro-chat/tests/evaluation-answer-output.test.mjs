import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluationAnswerOutput} from '../scripts/evaluation-answer-output.mjs';
test('evaluation answer capture retains only terminal assistant text, excluding private reasoning and tool arguments',()=>{
  const body='data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[
    {type:'reasoning',summary:[{text:'SECRET_REASONING'}],encrypted_content:'SECRET_ENCRYPTED'},
    {type:'function_call',arguments:'SECRET_ARGUMENT'},
    {type:'message',role:'assistant',content:[{type:'output_text',text:'Public answer'},{type:'reasoning',text:'SECRET_PART'}]},
    {type:'message',role:'user',content:[{type:'output_text',text:'SECRET_USER'}]}
  ]}})+'\n';
  assert.deepEqual(evaluationAnswerOutput(body),{text:'Public answer',characters:13,truncated:false});
  assert.deepEqual(evaluationAnswerOutput(body.replace('response.completed','response.done')),{text:'Public answer',characters:13,truncated:false});
  assert.deepEqual(evaluationAnswerOutput(body,6),{text:'Public',characters:13,truncated:true});
});
test('incomplete or failed provider streams do not become complete candidate answers',()=>{
  for (const body of ['data: broken','data: [DONE]','data: {"type":"response.output_text.delta","delta":"partial"}',
    'data: {"type":"response.failed","response":{"output":[]}}']) assert.equal(evaluationAnswerOutput(body),null);
});
