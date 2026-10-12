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
