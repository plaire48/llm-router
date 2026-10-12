import {it,expect,vi} from 'vitest';
import {textSkill} from '../runtime-src/text-skill';
import {startAgent} from '../runtime-src/agent';
import type {AgentTransport} from '@genoffice/agent-core';
const call=(name:string,input:Record<string,unknown>={})=>({id:'t',name,input});
it.each(['word','powerpoint'])('selects %s tools inside the real GenOffice loop',async app=>{
 let step=0;const native=vi.fn(async(name:string)=>name==='read_selection'?{snapshotId:'s',text:'before',editable:true}:{status:'verified',mutated:true});
 const transport:AgentTransport={stream(req,cb){expect(req.tools?.some(t=>t.name==='replace_text')).toBe(true);expect(req.tools?.some(t=>t.name==='set_formula')).toBe(false);queueMicrotask(()=>{if(step++===0)cb.onToolCall(call('read_selection'));else if(step===2)cb.onToolCall(call('replace_text',{snapshotId:'s',text:'after'}));else cb.onDelta('문장을 확인했습니다.');cb.onDone();});return {cancel(){cb.onDone();}};}};
 const run=startAgent({transport,native,request:'문장을 다듬어줘',context:{app},event(){}});await run.result;expect(native.mock.calls.map(c=>c[0])).toEqual(['read_selection','replace_text']);
});
it.each(['rejected','partial','conflict'])('does not replay a %s text mutation or claim success',async status=>{
 const native=vi.fn(async()=>({status}));const skill=textSkill(native,{app:'word'});await skill.executeTool(call('replace_text'));await skill.executeTool(call('replace_text'));expect(native).toHaveBeenCalledTimes(1);expect(skill.verifyResponse?.('수정했습니다.',[])).toBeTruthy();
});
it('does not replay when native write receipt is lost',async()=>{const native=vi.fn(async()=>{throw Error('lost');});const skill=textSkill(native,{app:'powerpoint'});await skill.executeTool(call('replace_text'));await skill.executeTool(call('replace_text'));expect(native).toHaveBeenCalledTimes(1);});
it.each(['word','powerpoint'])('runs %s outline, observed blocks and one approved batch',async app=>{
 let step=0;const names:string[]=[];
 const transport:AgentTransport={stream(_req,cb){queueMicrotask(()=>{const tools=[call('read_outline'),call('read_selection'),call('replace_blocks',{snapshotId:'s',operations:[{blockId:'p1',text:'First'},{blockId:'p2',text:'Second'}]})];if(step<tools.length)cb.onToolCall(tools[step++]);else cb.onDelta('두 문단을 확인했습니다.');cb.onDone();});return {cancel(){cb.onDone();}};}};
 const run=startAgent({transport,request:'문서 개요 확인 후 선택한 문단을 다듬어줘',context:{app},event(){},native:async name=>{names.push(name);return name==='replace_blocks'?{status:'verified',mutated:true,count:2}:{snapshotId:'s',blocks:[],truncated:false};}});
 await run.result;expect(names).toEqual(['read_outline','read_selection','replace_blocks']);
});
it('one mutation gate covers both single and batch tools',async()=>{const native=vi.fn(async()=>({status:'partial'}));const skill=textSkill(native,{app:'word'});await skill.executeTool(call('replace_blocks'));await skill.executeTool(call('replace_text'));expect(native).toHaveBeenCalledTimes(1);});
