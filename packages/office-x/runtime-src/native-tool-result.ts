import type {NativeCall} from './excel-skill';
const identifier=(value:unknown)=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(value)?value:undefined;
export class NativeToolFailure extends Error {
 readonly detail:Record<string,unknown>;
 constructor(tool:string,result:Record<string,unknown>){
  const code=identifier(result.error)||'native_operation_incomplete';super(code);
  this.detail={error:code,nativeTool:identifier(tool),status:identifier(result.status)||'failed',mutated:result.mutated===true,completedWrites:typeof result.completedWrites==='number'?result.completedWrites:undefined,writeResultUncertain:result.writeResultUncertain===true,invocationStarted:typeof result.invocationStarted==='boolean'?result.invocationStarted:undefined,
   failedMember:typeof result.failedMember==='string'&&/^[A-Za-z_][A-Za-z0-9_.]{0,99}$/.test(result.failedMember)?result.failedMember:undefined,nativeCode:typeof result.nativeCode==='string'&&/^0x[0-9a-f]{8}$/i.test(result.nativeCode)?result.nativeCode:undefined,inputPath:typeof result.inputPath==='string'&&/^[A-Za-z_][A-Za-z0-9_.\[\]]{0,149}$/.test(result.inputPath)?result.inputPath:undefined,inputRule:identifier(result.inputRule),
   recovery:tool==='export_document_copy'?'No full copy was returned. Do not retry file-engine reads as native writes. Use inspect_office for current Office content and reviewed execute_office_operations/write_cells for edits; these do not need a successful full copy. Full file-engine conversion requires an available artifact.':'The native operation did not finish. Review the native error and actual document result before proceeding; never replay an uncertain write.'};
 }
}
export function checkedNative(native:NativeCall):NativeCall{return async(name,input,signal)=>{
 const result=await native(name,input,signal);
 if(result.ok===false||result.error||['failed','partial','conflict','cancelled','rejected','verification_pending'].includes(String(result.status)))throw new NativeToolFailure(name,result);
 return result;
};}
