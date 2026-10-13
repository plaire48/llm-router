import type {NativeCall} from './excel-skill';

// Recovery reads current content; it never retries a write or manufactures an
// approval. The model must use the returned observation to propose a new plan.
const accessors=new Set('Item Range Cell Characters Paragraphs Words Sentences Rows Columns Cells Runs FindBySlideID get_Address Address Information ComputeStatistics PivotCaches PivotTables ChartObjects SeriesCollection Axes SpecialCells Find Offset Resize'.toLowerCase().split(' '));
export function snapshotReadSteps(input:Record<string,unknown>):Record<string,unknown>[] {
 const steps=Array.isArray(input.steps)?input.steps:[];
 if(steps.length>1000)return [];
 const reads:Record<string,unknown>[]=[];
 for(const raw of steps){
  if(!raw||typeof raw!=='object')return [];
  const s=raw as Record<string,unknown>;if(typeof s.member!=='string')return [];
  const target=typeof s.target==='string'?s.target:'document';
  if(s.action==='get'||s.action==='call'&&accessors.has(s.member.split('.').at(-1)!.toLowerCase()))reads.push({...s});
  else if(s.action==='set')reads.push({id:`snapshot_before_${reads.length}`,target,action:'get',member:s.member,args:s.args||[]});
  else if(s.action==='call')reads.push({target,action:'get',member:'Count'});
  else return [];
 }
 return reads;
}
export async function recoverSnapshot(native:NativeCall,input:Record<string,unknown>,signal?:AbortSignal):Promise<Record<string,unknown>> {
 const steps=snapshotReadSteps(input);
 if(!steps.length)return {ok:false,error:'snapshot_required',invocationStarted:false,mutated:false,recovery:'No edit was attempted. Call inspect_office with read-only steps resolving the affected objects and their actual content. Use ONLY its returned snapshotId for execute_office_operations; never use read_selection/read_range IDs or reuse an ID after an edit/new-document binding.'};
 const observation=await native('inspect_office',{steps},signal);
 if(typeof observation.snapshotId!=='string'||observation.ok===false||observation.error)return {...observation,ok:false,mutated:false,recovery:'No edit was attempted. Resolve the currently bound document objects with inspect_office and inspect_office_members. Propose the edit only after a successful fresh read.'};
 return {status:'read_required',mutated:false,snapshotId:observation.snapshotId,observation,recovery:'The old snapshot was missing, expired or belonged to a different reading tool/document. No edit or approval occurred. These are FRESH read-only observations of the currently bound document. Review the actual originals, update the intended changes, and call execute_office_operations with THIS snapshotId. Do not repeat the old ID, use legacy read IDs, or claim the edit is complete. Native approval, source comparison and readback still follow.'};
}
