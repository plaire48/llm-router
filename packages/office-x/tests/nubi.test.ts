import {describe,it,expect} from 'vitest';
import {nubiTransport,nubiMessages} from '../runtime-src/nubi-transport';
import {Conversations} from '../runtime-src/conversations';
import {startAgent} from '../runtime-src/agent';
// @ts-expect-error shared UI module
import {modelData} from '../ui/provider-view.js';

describe('Nubi to GenOffice boundary',()=>{
  it('maps multi-call history with tool identities intact',()=>{
    const messages=nubiMessages({system:'policy',tools:[],messages:[{role:'assistant',text:'',toolCalls:[{id:'a',name:'read_range',input:{address:'A1'}}]},{role:'tool',results:[{id:'a',name:'read_range',output:'{}'}]}]});
    expect((messages[1].tool_calls as any[])[0].function.arguments).toBe('{"address":"A1"}');expect(messages[2].tool_call_id).toBe('a');
  });
  it('actual GenOffice loop executes Nubi calls and emits its verification events',async()=>{
    let turn=0;const events:string[]=[];let seen:any;
    const providers={complete:async(messages:any,tools:any,signal:any,onText:any)=>{seen={messages,tools};turn++;if(turn===1){onText('읽');onText('읽겠습니다.');return {content:'읽겠습니다.',calls:[{id:'read',function:{name:'read_selection',arguments:'{}'}}],finishReason:'tool_calls'};}return {content:'확인 완료',calls:[],finishReason:'stop',usage:{prompt_tokens:20,completion_tokens:3}};}};
    const run=startAgent({transport:nubiTransport(providers),request:'선택한 표를 읽어줘',context:{},native:async()=>({snapshotId:'s',cells:[]}),event:t=>events.push(t)});
    expect((await run.result).text).toBe('확인 완료');expect(turn).toBe(2);expect(events).toContain('tool_executed');expect(events).toContain('usage');expect(seen.messages.some((m:any)=>m.role==='tool')).toBe(true);
  });
  it('never emits calls from a failed or aborted provider response',async()=>{
    const emitted:any[]=[];const controller=nubiTransport({complete:async(...args:any[])=>{await new Promise(r=>setTimeout(r,5));return {calls:[{id:'a',function:{name:'set_formula',arguments:'{}'}}]};}}).stream({system:'',messages:[],tools:[]},{onDelta:()=>{},onToolCall:c=>emitted.push(c),onDone:()=>{},onError:()=>{}});
    controller.cancel();await new Promise(r=>setTimeout(r,15));expect(emitted).toEqual([]);
    await new Promise<void>(resolve=>nubiTransport({complete:async()=>{throw Error('secret-token');}}).stream({system:'',messages:[],tools:[]},{onDelta:()=>{},onToolCall:c=>emitted.push(c),onDone:resolve,onError:e=>{expect(e).not.toContain('secret-token');resolve();}}));expect(emitted).toEqual([]);
  });
  it('seeds text history only for the same document and range',()=>{
    const sessions=new Conversations(),scope={documentId:'a',worksheetId:'s',address:'A1:B3'};
    sessions.remember('conversation',scope,[{role:'user',text:'전 작업'},{role:'assistant',text:'확인',toolCalls:[{id:'old',name:'set_formula',input:{snapshotId:'old'}}]},{role:'tool',results:[{id:'old',name:'set_formula',output:'secret snapshot'}]}]);
    expect(sessions.history('conversation',scope)).toEqual([{role:'user',text:'전 작업'},{role:'assistant',text:'확인'}]);
    expect(sessions.history('conversation',{...scope,documentId:'other'})).toEqual([]);expect(sessions.history('conversation',{...scope,address:'C1'})).toEqual([]);
  });
  it('keeps every catalog model and uses connection id, not refresh time',()=>{
    const models=Array.from({length:50},(_,i)=>({id:'model-'+i,label:'모델 '+i}));
    const data=modelData({provider:'aipro',model:'model-49',models,providers:[{id:'aipro',connected:true,connectionId:7}],catalogs:[{provider:'aipro',model:'model-49',models}]});
    expect(data.catalog.models).toHaveLength(50);expect(data.connections.aipro.receivedAt).toBe(7);expect(data.selectedModels.aipro).toBe('model-49');
  });
});
