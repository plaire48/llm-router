import {it,expect,vi} from 'vitest';
import type {AgentTransport,AgentToolCall} from '@genoffice/agent-core';
import {startAgent} from '../runtime-src/agent';
import {officeSkill} from '../runtime-src/office-skill';
const call=(name:string,input:Record<string,unknown>={}):AgentToolCall=>({id:Math.random().toString(),name,input});
const steps=[{id:'parts',target:'document',action:'get',member:'Paragraphs'},{target:'parts',action:'get',member:'Count'}];
const edit={snapshotId:'s',summary:'문서 본문과 제목 서식을 변경합니다.',steps:[{target:'text',action:'set',member:'Text',value:'수정한 내용'}],checks:[{read:{target:'text',action:'get',member:'Text'},equals:'수정한 내용'}]};
it.each(['excel','word','powerpoint'])('%s exposes full native editing when selected content has editable=false',async app=>{
 let turns=0;const names:string[]=[];
 const calls=[call('load_office_guide',{name:'native-'+app}),call('inspect_office',{steps}),call('execute_office_operations',edit),call('inspect_office',{steps}),call('execute_office_operations',edit)];
 const transport:AgentTransport={stream(req,cb){expect(req.tools?.some(t=>t.name==='create_document')).toBe(true);queueMicrotask(()=>{if(turns<calls.length)cb.onToolCall(calls[turns++]);else cb.onDelta('문서 내용과 서식을 확인했습니다.');cb.onDone();});return {cancel(){cb.onDone();}};}};
 const run=startAgent({transport,request:'문서 전체를 읽고 제목과 내용을 수정해줘',context:{app,editable:false,selectionAvailable:false},native:async name=>{names.push(name);return name==='inspect_office'?{snapshotId:'s',results:[2]}:{status:'verified',mutated:true};},event(){}});
 await run.result;expect(names).toEqual(['inspect_office','execute_office_operations','inspect_office','execute_office_operations']);
});
it.each(['word','powerpoint','excel'])('%s can create then inspect and refine a real document through host tools',async app=>{
 const content=app==='word'?{paragraphs:[{style:'Title',text:'주간 보고서'},{rows:[['현황','계획'],['진행 중','검토']]}]}:app==='powerpoint'?{slides:[{title:'착수 회의',body:['목표와 일정']}]}:{sheets:[{name:'매출',rows:[['분기','매출'],['1분기','1000']]}]};
 const queue=[call('create_document',{title:'새 문서',...content}),call('inspect_office',{steps}),call('execute_office_operations',edit),call('save_document',{format:'office'})];const names:string[]=[];
 const transport:AgentTransport={stream(_req,cb){queueMicrotask(()=>{const next=queue.shift();if(next)cb.onToolCall(next);else cb.onDelta('새 문서와 저장 결과를 확인했습니다.');cb.onDone();});return {cancel(){}};}};
 await startAgent({transport,request:'새 문서 만들어서 다듬고 저장해줘',context:{app},event(){},native:async name=>{names.push(name);return {snapshotId:'s',status:'verified',mutated:name!=='inspect_office'};}}).result;
 expect(names).toEqual(['create_document','inspect_office','execute_office_operations','save_document']);
});
it('does not claim a failed creation is complete',async()=>{const skill=officeSkill(async()=>({status:'partial',mutated:true}),{app:'word'});await skill.executeTool(call('create_document'));expect(skill.verifyResponse?.('문서를 만들었습니다.',[])).toBeTruthy();});
it('does not send local GenOffice guide reads to Office',async()=>{const native=vi.fn(async()=>({}));const skill=officeSkill(native,{app:'excel'});const r=await skill.executeTool(call('load_office_guide',{name:'sheets-pivot'}));expect(r.output).toContain('pivot');expect(native).not.toHaveBeenCalled();});
it('stops repeated native failures even when successful guide reads alternate with errors',async()=>{
 let turn=0;const native=vi.fn(async()=>({ok:false,error:'office_member_not_found',failedMember:'Item',invocationStarted:false}));
 const transport:AgentTransport={stream(_req,cb){queueMicrotask(()=>{if(!_req.tools.length){cb.onDelta('지원 도구를 다시 확인해 이어갈 수 있습니다.');cb.onDone();return;}cb.onToolCall(turn++%2?call('inspect_office',{steps}):call('load_office_guide',{name:'native-excel'}));cb.onDone();});return {cancel(){}};}};
 const run=startAgent({transport,request:'값을 수정해줘',context:{app:'excel'},native,event(){}});
 const recovered=await run.result;expect(recovered.recovery?.code).toBe('office_repeated_tool_failure');expect(recovered.cancelled).toBe(false);expect(recovered.recovery?.verifiedWrites).toBe(0);expect(native).toHaveBeenCalledTimes(3);expect(turn).toBe(14);
});

it('current-document destination clarification is not an unverified document mutation',async()=>{const skill=officeSkill(async()=>({status:'redirected',mutated:false,documentTarget:'current',recovery:'use write_cells'}),{app:'excel'});const result=await skill.executeTool(call('create_document'));expect(result.isError).toBe(false);expect(result.mutated).toBe(false);expect(skill.verifyResponse?.('셀 입력을 완료했습니다.',[])).toBeNull();});

it('GenOffice corrects a rejected Count expectation from actual existing sheets without duplicating writes',async()=>{
 const counts=[{id:'sheets',target:'document',action:'get',member:'Worksheets'},{target:'sheets',action:'get',member:'Count'}];let turn=0,writes=0;const names:string[]=[];
 const transport:AgentTransport={stream(req,cb){expect(req.system).toContain('Count is the total');queueMicrotask(()=>{
  if(turn++===0)cb.onToolCall(call('execute_office_operations',{snapshotId:'s',summary:'시트 하나 추가',steps:[{target:'sheets',action:'call',member:'Add',id:'new_sheet'}],checks:[{read:counts[1],equals:1}]}));
  else if(turn===2){const last:any=[...req.messages].reverse().find((m:any)=>m.role==='tool');expect(JSON.parse(last.results[0].output).recovery).toContain('No writes');cb.onToolCall(call('inspect_office',{steps:counts}));}
  else if(turn===3){const last:any=[...req.messages].reverse().find((m:any)=>m.role==='tool');const before=JSON.parse(last.results[0].output);expect(before.results[1]).toBe(3);cb.onToolCall(call('execute_office_operations',{snapshotId:before.snapshotId,summary:'기존 3개 시트에 하나 추가하고 셀 입력',steps:[{target:'sheets',action:'call',member:'Add',id:'new_sheet'},{target:'new_range',action:'set',member:'Value2',value:42}],checks:[{read:counts[1],delta:1},{read:{target:'new_range',action:'get',member:'Value2'},equals:42}]}));}
  else cb.onDelta('새 시트와 셀 입력을 완료했습니다.');cb.onDone();});return {cancel(){}};}};
 const result=await startAgent({transport,request:'시트 하나 추가해서 42 써줘',context:{app:'excel'},event(){},native:async(name,input)=>{names.push(name);if(names.length===1)return {error:'office_count_expectation_invalid',failedMember:'Count',invocationStarted:false,mutated:false};if(name==='inspect_office')return {snapshotId:'observed-3',results:[{reference:'sheets'},3]};expect(input.snapshotId).toBe('observed-3');expect((input.checks as any[])[0].delta).toBe(1);writes++;return {status:'verified',mutated:true,checks:[{actual:4,expected:4,passed:true},{actual:42,expected:42,passed:true}]};}}).result;
 expect(result.text).toContain('완료');expect(writes).toBe(1);expect(names).toEqual(['execute_office_operations','inspect_office','execute_office_operations']);
});
it('Count mismatch reports readbacks without authorizing a repeated write or completion',async()=>{const native=vi.fn(async()=>({error:'readback_mismatch',status:'partial',failedMember:'Count',mutated:true,completedWrites:2,checks:[{read:{member:'Count'},actual:5,expected:4,passed:false},{read:{member:'Value2'},actual:42,expected:42,passed:true}]}));const skill=officeSkill(native,{app:'excel'});const r=await skill.executeTool(call('execute_office_operations'));expect(JSON.parse(r.output).recovery).toContain('Do not replay');expect(r.isError).toBe(true);expect(skill.verifyResponse?.('완료했습니다.',[])).toBeTruthy();expect(native).toHaveBeenCalledTimes(1);});

it('Excel exposes host-resolved number formatting with verified document receipts',async()=>{const {excelSkill}=await import('../runtime-src/excel-skill');const native=vi.fn(async()=>({status:'verified',mutated:true,checks:[{actual:'0.00',expected:'0.00',passed:true}]}));const skill=excelSkill(native,{app:'excel'});expect(skill.tools.some(t=>t.name==='format_cells')).toBe(true);const result=await skill.executeTool(call('format_cells',{address:'D10:E10',numberFormat:'0.00'}));expect(result.isError).toBe(false);expect(native).toHaveBeenCalledWith('format_cells',{address:'D10:E10',numberFormat:'0.00'},undefined);expect(skill.verifyResponse?.('서식 적용을 완료했습니다.',[{...call('format_cells'),ok:true}])).toBeNull();});
