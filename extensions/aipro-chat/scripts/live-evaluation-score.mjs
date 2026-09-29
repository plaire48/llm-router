export function evaluationRepeats(value) {
 const repeats=value===undefined ? 3 : Number(value);
 if(!Number.isInteger(repeats) || repeats<1 || repeats>5)throw new Error('NUBI_EVAL_REPEATS must be an integer from 1 to 5');
 return repeats;
}
export function liveEvaluationScore(report) {
 const plan=report.plannedTasks || [],ids=[...new Set(plan)],repeats=evaluationRepeats(report.repeats);
 const invalidPlan=ids.length!==plan.length || ids.some(id=>typeof id!=='string' || !id);
 const unexpectedTrials=(report.cases || []).filter(item=>!ids.includes(item.id) || !Number.isInteger(item.trial) || item.trial<1 || item.trial>repeats).length;
 const tasks=ids.map(id=>{
  const trials=Array.from({length:repeats},(_,i)=>{
   const found=(report.cases || []).filter(item=>item.id===id && item.trial===i+1);
   return found.length!==1 || typeof found[0].passed!=='boolean' ? 'missing' : found[0].passed ? 'passed' : 'failed';
  });
  return {id,passed:trials.filter(value=>value==='passed').length,failed:trials.filter(value=>value==='failed').length,missing:trials.filter(value=>value==='missing').length,total:repeats};
 });
 const total=tasks.length*repeats,passed=tasks.reduce((sum,task)=>sum+task.passed,0),missing=tasks.reduce((sum,task)=>sum+task.missing,0);
 const unverifiedTrials=(report.cases || []).filter(item=>!Number.isSafeInteger(item.modelResponses) || item.modelResponses<1 || !Number.isSafeInteger(item.modelRequests) || item.modelRequests<item.modelResponses).length;
 const measurable=unverifiedTrials===0 && report.actualModel===true && total>0 && missing===0 && !invalidPlan && unexpectedTrials===0;
 return {tasks,passed,total,missing,invalidPlan,unexpectedTrials,unverifiedTrials,score:measurable ? Math.round(passed/total*100) : null,
  metrics: {k:repeats,passAt1:measurable ? passed/total : null,
   passAtK:measurable ? tasks.filter(task=>task.passed>0).length/tasks.length : null,
   passPowerK:measurable ? tasks.filter(task=>task.passed===repeats).length/tasks.length : null},
  scope:'real-model-on-synthetic-pages',officialBenchmarkScore:null,productionSuccessRate:null};
}
