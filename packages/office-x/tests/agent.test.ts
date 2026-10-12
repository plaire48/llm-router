import { describe, it, expect, vi } from 'vitest';
import type { AgentTransport, AgentToolCall } from '@genoffice/agent-core';
import { startAgent } from '../runtime-src/agent';
import { excelSkill } from '../runtime-src/excel-skill';
import { providerTransport, validateConfig } from '../runtime-src/transport';

function scripted(turns: Array<{call?: AgentToolCall; text?: string}>): AgentTransport {
  return { stream(_req,cb) {
    const turn=turns.shift();
    queueMicrotask(()=>{if(turn?.call)cb.onToolCall(turn.call);if(turn?.text)cb.onDelta(turn.text);cb.onDone();});
    return {cancel:()=>cb.onDone()};
  }};
}
const call=(name:string,input:Record<string,unknown>={}):AgentToolCall=>({id:Math.random().toString(),name,input});
describe('real GenOffice AgentLoop with native Office skill',()=>{
  it('runs read, reviewed write and readback sequentially through upstream loop',async()=>{
    const order:string[]=[];
    const run=startAgent({transport:scripted([{call:call('read_selection')},
      {call:call('set_formula',{snapshotId:'snapshot',operations:[{address:'E2',formula:'=C2*D2'}]})},
      {call:call('calculate_and_read')},{text:'수식과 계산값을 확인했습니다. 저장하지 않았습니다.'}]),
      request:'금액을 채워줘',context:{documentId:'pinned'},event:()=>{},native:async name=>{
        order.push(name);return name==='set_formula'?{status:'verified',mutated:true,saved:false}:{snapshotId:'snapshot',cells:[]};
      }});
    expect((await run.result).cancelled).toBe(false);
    expect(order).toEqual(['read_selection','set_formula','calculate_and_read']);
  });
  it('never repeats an uncertain write even if the model asks again',async()=>{
    let writes=0;const skill=excelSkill(async()=>{writes++;throw Error('lost receipt');},{});
    expect((await skill.executeTool(call('set_formula'))).isError).toBe(true);
    expect((await skill.executeTool(call('set_formula'))).output).toContain('writes_stopped');expect(writes).toBe(1);
  });
  it('does not bypass rejection or unsupported tool names',async()=>{
    const native=vi.fn(async()=>({status:'cancelled'}));const skill=excelSkill(native,{});
    await skill.executeTool(call('set_formula'));await skill.executeTool(call('set_formula'));await skill.executeTool(call('run_shell'));
    expect(native).toHaveBeenCalledTimes(1);
  });
  it('cancellation reaches a waiting native approval operation',async()=>{
    let entered!:()=>void;const ready=new Promise<void>(r=>entered=r);let aborted=false;
    const run=startAgent({transport:scripted([{call:call('read_selection')}]),request:'읽기',context:{},event:()=>{},
      native:(_n,_i,signal)=>new Promise((_resolve,reject)=>{entered();signal?.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));});})});
    await ready;run.cancel();expect((await run.result).cancelled).toBe(true);expect(aborted).toBe(true);
  });
  it('uses the GenOffice provider parser for a real-format streamed tool call',async()=>{
    const frames=[{choices:[{delta:{tool_calls:[{index:0,id:'tool-1',type:'function',function:{name:'read_selection',arguments:'{}'}}]}}]},
      {choices:[{delta:{},finish_reason:'tool_calls'}]},'[DONE]'];
    const fetch=vi.fn(async()=>new Response(frames.map(v=>`data: ${typeof v==='string'?v:JSON.stringify(v)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}}));
    vi.stubGlobal('fetch',fetch);
    try {
      const calls:AgentToolCall[]=[];
      await new Promise<void>((resolve,reject)=>providerTransport({baseUrl:'https://model.example/v1',model:'enterprise-model',apiKey:'test-token'}).stream({system:'test',messages:[{role:'user',text:'read'}],tools:[]},
        {onDelta:()=>{},onToolCall:c=>calls.push(c),onDone:resolve,onError:reject}));
      expect(calls[0].name).toBe('read_selection');expect(fetch.mock.calls.length).toBe(1);
    } finally {vi.unstubAllGlobals();}
  });
  it('requires explicit model configuration and secure remote transport',()=>{
    expect(()=>validateConfig({baseUrl:'http://remote.example/v1',model:'m',apiKey:''})).toThrow('https');
    expect(()=>validateConfig({baseUrl:'https://model.example/v1',model:'',apiKey:''})).toThrow();
    expect(validateConfig({baseUrl:'http://127.0.0.1:8787/v1',model:'m',apiKey:''}).model).toBe('m');
  });
});
