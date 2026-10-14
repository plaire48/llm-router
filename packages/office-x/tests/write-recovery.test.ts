import {it,expect} from 'vitest';
import {startAgent} from '../runtime-src/agent';
import type {AgentTransport} from '@genoffice/agent-core';
const wait=()=>new Promise(r=>setTimeout(r,20));
it.each(['excel','word','powerpoint'])('%s pauses the same run until HITL, then plans only remaining writes',async app=>{
 let turn=0,writes=0,resume!:(v:any)=>void;const events:any[]=[];
 const transport:AgentTransport={stream(request,cb){queueMicrotask(()=>{turn++;if(turn<=2)cb.onToolCall({id:String(turn),name:app==='excel'?'write_cells':'execute_office_operations',input:app==='excel'?(turn===1?{summary:'first',operations:[{address:'A1',value:1}]}:{summary:'remaining',operations:[{address:'B1',value:2}]}):{snapshotId:turn===1?'before':'fresh',summary:turn===1?'first':'remaining',steps:[{target:'document',action:'set',member:'Content.Text',value:turn===1?'first':'remaining'}],checks:[{read:{target:'document',action:'get',member:'Content.Text'},equals:turn===1?'first':'remaining'}]}});else cb.onDelta('남은 작업을 처리했습니다.');if(turn===1)cb.onToolCall({id:'queued',name:'write_cells',input:{operations:[{address:'Z1',value:'must not replay'}]}});cb.onDone();});return {cancel:()=>cb.onDone()};}};
 const run=startAgent({transport,request:'두 값 입력',context:{app},event:(type,data)=>events.push({type,data}),native:async(name,input)=>{
  if(name==='review_write_recovery')return new Promise(r=>resume=r);
  if(input.operations)expect(JSON.stringify(input)).not.toContain('must not replay');writes++;return writes===1?{status:'partial',mutated:true,error:'readback_mismatch',completedWrites:1}:{status:'verified',mutated:true};
 }});
 let done=false;void run.result.then(()=>done=true);await wait();expect(writes).toBe(1);expect(turn).toBe(1);expect(done).toBe(false);
 expect(events.some(e=>e.data?.stage==='awaiting_user')).toBe(true);
 resume({status:'read_required',resumed:true,mutated:false,previousWriteVerified:false,snapshotId:'fresh'});
 expect((await run.result).cancelled).toBe(false);expect(writes).toBe(2);expect(turn).toBe(3);
});
it('HITL decline prevents the remaining tools and model turn',async()=>{
 let writes=0,turns=0;
 const transport:AgentTransport={stream(_r,cb){turns++;queueMicrotask(()=>{cb.onToolCall({id:'1',name:'write_cells',input:{operations:[{address:'A1',value:1}]}});cb.onToolCall({id:'2',name:'write_cells',input:{operations:[{address:'B1',value:2}]}});cb.onDone();});return {cancel:()=>cb.onDone()};}};
 const result=await startAgent({transport,request:'쓰기',context:{app:'excel'},event(){},native:async name=>{if(name==='review_write_recovery')return {status:'recovery_cancelled'};writes++;return {status:'partial',mutated:true};}}).result;
 expect(result.cancelled).toBe(true);expect(writes).toBe(1);expect(turns).toBe(1);
});
it('cancel interrupts a pending human gate without another write',async()=>{
 let writes=0,waiting=false;
 const transport:AgentTransport={stream(_r,cb){queueMicrotask(()=>{cb.onToolCall({id:'1',name:'write_cells',input:{operations:[{address:'A1',value:1}]}});cb.onDone();});return {cancel:()=>cb.onDone()};}};
 const run=startAgent({transport,request:'쓰기',context:{app:'excel'},event(){},native:async(name,_input,signal)=>{if(name==='review_write_recovery'){waiting=true;return new Promise((_r,j)=>signal?.addEventListener('abort',()=>j(Error('cancelled')),{once:true}));}writes++;return {status:'partial',mutated:true};}});
 await wait();expect(waiting).toBe(true);run.cancel();expect((await run.result).cancelled).toBe(true);expect(writes).toBe(1);
});
