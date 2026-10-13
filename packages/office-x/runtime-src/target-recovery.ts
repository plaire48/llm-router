import type {NativeCall} from './excel-skill';
export function canRecoverTarget(result:Record<string,unknown>):boolean {
 return result.invocationStarted===false&&result.mutated!==true&&!(typeof result.completedWrites==='number'&&result.completedWrites>0)&&result.writeResultUncertain!==true&&(result.error==='office_target_unknown'||result.error==='office_argument_count'&&typeof result.failedMember==='string'&&result.failedMember.split('.').at(-1)?.toLowerCase()==='item');
}
export async function recoverExcelTarget(native:NativeCall,input:Record<string,unknown>,context:Record<string,unknown>,failure:Record<string,unknown>,signal?:AbortSignal):Promise<Record<string,unknown>> {
 const steps=Array.isArray(input.steps)?input.steps as Record<string,unknown>[]:[];
 const addresses=steps.flatMap(s=>Array.isArray(s?.args)?s.args:[]).filter((v):v is string=>typeof v==='string'&&/^[A-Z]{1,3}[1-9][0-9]{0,6}(?::[A-Z]{1,3}[1-9][0-9]{0,6})?$/.test(v));
 const address=addresses[0]||(typeof context.address==='string'?context.address:'A1:T101');
 const observation=await native('read_cells',{address,...(typeof input.sheet==='string'?{sheet:input.sheet}:{})},signal);
 if(observation.ok===false||observation.error||typeof observation.snapshotId!=='string')return {...failure,recovery:'No edit was attempted. Use read_cells with an explicit bounded address and optional worksheet name on the current bound workbook. It returns real cells_read_sheet/cells_read_range handles. Item requires an explicit index/name; do not repeat a missing-index call or guess the selected range.'};
 return {status:'read_required',mutated:false,address,snapshotId:observation.snapshotId,observation,previousFailure:{error:failure.error,failedMember:failure.failedMember,nativeCode:failure.nativeCode},recovery:'No edit was attempted. These are actual bounded values/formulas from the bound workbook, not the entire workbook. Use the returned cells_read_sheet and cells_read_range handles and THIS snapshotId. Review actual originals, then revise the intended changes and submit execute_office_operations for approval with independent checks. Item needs a one-based index or an observed name; these handles avoid the rejected Item lookup. Do not replay the previous malformed path, assume omitted selectors, or claim completion before a verified edit.'};
}
