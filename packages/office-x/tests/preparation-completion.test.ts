import {it,expect} from 'vitest';
import {startAgent} from '../runtime-src/agent';
import {preparationOnly} from '../runtime-src/preparation-completion';
import type {AgentTransport} from '@genoffice/agent-core';
for(const app of ['word','powerpoint'])for(const empty of [false,true])it(`${app} continues after guide-only ${empty?'empty':'promise'} reply into a verified native edit`,async()=>{
 let turn=0,value='원문',writes=0;const names:string[]=[];
 const transport:AgentTransport={stream(request,cb){queueMicrotask(()=>{
  turn++;const emit=(name:string,input:any)=>cb.onToolCall({id:String(turn),name,input});
  if(turn===1)emit('load_office_guide',{name:'native-'+app});
  else if(turn===2){if(!empty)cb.onDelta('편집 가이드를 로드하고 문서를 수정하겠습니다.');}
  else if(turn===3)emit('inspect_office',{steps:[{target:'document',member:'Name',action:'get'}]});
  else if(turn===4)emit('execute_office_operations',{snapshotId:'fresh',summary:'요청 문장 수정',steps:[{target:'body',member:'Text',action:'set',value:'변경 내용'}],checks:[{read:{target:'body',member:'Text',action:'get'},equals:'변경 내용'}]});
  else cb.onDelta('문서 내용을 수정하고 확인했습니다.');cb.onDone();});return {cancel:()=>cb.onDone()};}};
 const result=await startAgent({transport,request:'현재 문서를 수정해줘',context:{app,permissionMode:'auto'},native:async(name,input)=>{names.push(name);if(name==='inspect_office')return {snapshotId:'fresh',results:[value]};expect(input.snapshotId).toBe('fresh');writes++;value=String((input.steps as {value:unknown}[])[0].value);return {status:'verified',mutated:true,checks:[{actual:value,expected:'변경 내용',passed:value==='변경 내용'}]};},event(){}}).result;
 expect(result.turnLimit).toBe(false);expect(writes).toBe(1);expect(value).toBe('변경 내용');expect(names).toEqual(['inspect_office','execute_office_operations']);expect(turn).toBe(5);
});
it('preparation completion never authorizes editing for explanations, read-only, declined or attempted writes',()=>{const ledger=[{tool:'load_office_guide',status:'read'}];for(const request of ['워드 편집 방법 설명해줘','문서를 수정하지 말고 읽어만 줘','문서 작성 예시를 보여줘'])expect(preparationOnly(request,'confirm',ledger,false)).toBe(false);expect(preparationOnly('문서 수정해줘','read',ledger,false)).toBe(false);expect(preparationOnly('문서 수정해줘','auto',ledger,true)).toBe(false);expect(preparationOnly('문서 수정해줘','auto',[...ledger,{tool:'ask_clarification',status:'read'}],false)).toBe(false);});
it('preparation continuation is bounded and cannot report an untouched document as completed',async()=>{let turns=0,nativeCalls=0;const transport:AgentTransport={stream(request,cb){queueMicrotask(()=>{if(++turns===1)cb.onToolCall({id:'guide',name:'load_office_guide',input:{name:'native-word'}});else if(request.tools.length)cb.onDelta('편집 가이드를 읽었습니다.');else cb.onDelta('가이드만 확인했으며 문서는 변경하지 못했습니다.');cb.onDone();});return {cancel:()=>cb.onDone()};}};const result=await startAgent({transport,request:'문서를 수정해줘',context:{app:'word'},native:async()=>{nativeCalls++;return {};},event(){}}).result;expect(nativeCalls).toBe(0);expect(turns).toBe(4);expect(result.recovery?.code).toBe('agent_preparation_only');expect(result.turnLimit).toBe(true);});
