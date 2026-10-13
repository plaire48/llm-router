import type {NativeCall} from './excel-skill';
// Calculate is a fixed native operation, never an arbitrary read-only call.
export async function inspectWithCalculation(native:NativeCall,input:Record<string,unknown>,signal?:AbortSignal):Promise<Record<string,unknown>> {
 const steps=Array.isArray(input.steps)?input.steps as Record<string,unknown>[]:[];
 const calculations=steps.filter(s=>typeof s?.member==='string'&&s.member.toLowerCase()==='calculate');
 if(!calculations.length)return native('inspect_office',input,signal);
 if(steps.length>1000||calculations.length>5||calculations.some(s=>!['get','call'].includes(String(s.action))||Array.isArray(s.args)&&s.args.length||s.value!==undefined))return {ok:false,error:'office_argument_invalid',invocationStarted:false,inputRule:'calculate_has_no_arguments',mutated:false};
 const reads:Record<string,unknown>[]=[];let calculated:Record<string,unknown>={};
 for(const step of steps){
  if(step.member?.toString().toLowerCase()!=='calculate'){reads.push(step);continue;}
  if(reads.length){const before=await native('inspect_office',{steps:reads},signal);if(before.ok===false||before.error)return before;}
  const result=await native('calculate_office',{target:step.target||'document'},signal);
  if(result.ok===false||result.error||result.status!=='calculated')return result;calculated=result;
 }
 // Snapshot and values are from AFTER calculation. Never return a pre-calc ID.
 if(!reads.length)return {...calculated,recovery:'Calculation finished. Inspect relevant Value2 and Formula on the bound document for a fresh snapshot before editing.'};
 return {...await native('inspect_office',{steps:reads},signal),calculated:true,calculationScope:'requested native targets',mutated:false};
}
