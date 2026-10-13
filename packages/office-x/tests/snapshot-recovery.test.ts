import {it,expect,vi} from 'vitest';
import type {AgentTransport,AgentToolCall} from '@genoffice/agent-core';
import {officeSkill} from '../runtime-src/office-skill';
import {startAgent} from '../runtime-src/agent';
import {snapshotReadSteps} from '../runtime-src/snapshot-recovery';
const edit={snapshotId:'legacy-or-expired',summary:'문서 내용을 입력합니다.',steps:[{id:'range',target:'document',action:'get',member:'Content'},{target:'range',action:'set',member:'Text',value:'새 내용'}],checks:[{read:{target:'range',action:'get',member:'Text'},equals:'새 내용'}]};
const call=(name:string,input:Record<string,unknown>):AgentToolCall=>({id:crypto.randomUUID(),name,input});
it.each(['excel','word','powerpoint'])('%s reads fresh originals after a pre-call snapshot failure and never replays a write',async app=>{
 const native=vi.fn(async(name:string)=>name==='execute_office_operations'?{ok:false,error:'snapshot_required',invocationStarted:false,mutated:false}:{snapshotId:'fresh-native',results:['original']});
 const skill=officeSkill(native,{app});const result=await skill.executeTool(call('execute_office_operations',edit));
 expect(native.mock.calls.map(c=>c[0])).toEqual(['execute_office_operations','inspect_office']);
 expect(result.isError).toBe(false);expect(result.mutated).toBe(false);expect(JSON.parse(result.output)).toMatchObject({status:'read_required',snapshotId:'fresh-native',observation:{results:['original']}});
 expect(skill.verifyResponse?.('문서 수정을 완료했습니다.',[])).toBeTruthy();
 native.mockResolvedValueOnce({status:'verified',mutated:true} as any);
 expect((await skill.executeTool(call('execute_office_operations',{...edit,snapshotId:'fresh-native'}))).isError).toBe(false);
 expect(skill.verifyResponse?.('문서 수정을 완료했습니다.',[])).toBeNull();
});
it('GenOffice loop revises the snapshot from actual recovery output before completing',async()=>{
 const names:string[]=[],ids:string[]=[];let turn=0;
 const transport:AgentTransport={stream(req,cb){queueMicrotask(()=>{
  if(turn++===0)cb.onToolCall(call('execute_office_operations',edit));
  else if(turn===2){const last=[...req.messages].reverse().find(m=>m.role==='tool');const result=JSON.parse((last as any).results[0].output);expect(result.status).toBe('read_required');expect(result.observation.results).toEqual(['current document']);cb.onToolCall(call('execute_office_operations',{...edit,snapshotId:result.snapshotId}));}
  else cb.onDelta('문서 내용과 결과를 확인했습니다.');cb.onDone();});return {cancel(){}};}};
 const run=startAgent({transport,request:'문서를 수정해줘',context:{app:'word'},event(){},native:async(name,input)=>{names.push(name);if(name==='inspect_office')return {snapshotId:'fresh-after-binding',results:['current document']};ids.push(String(input.snapshotId));return ids.length===1?{ok:false,error:'snapshot_required',invocationStarted:false,mutated:false}:{status:'verified',mutated:true};}});
 expect((await run.result).text).toContain('결과를 확인');expect(ids).toEqual(['legacy-or-expired','fresh-after-binding']);expect(names).toEqual(['execute_office_operations','inspect_office','execute_office_operations']);
});
it('unknown or partial execution results are never recovered or replayed as snapshot failures',async()=>{
 for(const error of [{error:'snapshot_required',mutated:true,status:'partial'},{error:'snapshot_required'},{error:'source_changed',invocationStarted:false,mutated:false}]){const native=vi.fn(async()=>error),skill=officeSkill(native,{app:'excel'});expect((await skill.executeTool(call('execute_office_operations',edit))).isError).toBe(true);expect(native).toHaveBeenCalledTimes(1);}
});
it('recovery inspection contains getters and accessors but no writes or mutating calls',()=>{
 const reads=snapshotReadSteps({steps:[...edit.steps,{target:'parts',action:'call',member:'Add',id:'new_part'},{target:'parts',action:'call',member:'Delete'}]});
 expect(reads).toEqual([{id:'range',target:'document',action:'get',member:'Content'},{id:'snapshot_before_1',target:'range',action:'get',member:'Text',args:[]},{target:'parts',action:'get',member:'Count'},{target:'parts',action:'get',member:'Count'}]);
 expect(reads.some(s=>s.action==='set'||['Add','Delete'].includes(String(s.member)))).toBe(false);
});
it('failed recovery reading still reports no document mutation and supplies replan guidance',async()=>{
 const native=vi.fn(async(name:string)=>name==='inspect_office'?{ok:false,error:'office_target_unknown',invocationStarted:false}:{ok:false,error:'snapshot_required',invocationStarted:false}),skill=officeSkill(native,{app:'excel'});
 const r=await skill.executeTool(call('execute_office_operations',edit));expect(r.isError).toBe(true);expect(r.mutated).toBe(false);expect(JSON.parse(r.output).recovery).toContain('No edit was attempted');
});
