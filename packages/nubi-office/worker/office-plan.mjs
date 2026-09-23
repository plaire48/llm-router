import {inspectChecks, region} from './office-harness.mjs';

// Step completion comes from host observations, never an LLM's progress claim.
export function createPlanProgress(task,{requireEdits=false}={}) {
  const steps=task.steps.map(step=>({...step,state:'pending'}));
  function active(){return steps.find(step=>step.state!=='done');}
  function advance(){const step=active();if(step&&step.state==='pending')step.state='running';}
  advance();
  return {
    active,
    observe(snapshot) {
      if(active()?.kind==='inspect'){active().state='done';advance();}
      // Already satisfied edit steps also need no write.
      while(!requireEdits&&active()?.kind==='edit'&&!active().requiresReview&&inspectChecks(active().checkIndexes.map(i=>task.checks[i]),snapshot).verified){active().state='done';advance();}
    },
    recovering(){const step=active();if(step)step.state='recovering';},
    beginEdit(){if(active()?.kind==='edit'){active().requiresReview=true;active().state='running';}},
    ready(snapshot){const step=active();return step?.kind==='edit'&&(!requireEdits||step.requiresReview)&&inspectChecks(step.checkIndexes.map(i=>task.checks[i]),snapshot).verified?step:null;},
    approve(snapshot){if(!this.ready(snapshot))throw new Error('acceptance_not_met');active().state='done';advance();this.observe(snapshot);},
    assertEdit(checks) {
      const step=active();if(step?.kind!=='edit')throw new Error('plan_step_mismatch');
      const targets=step.checkIndexes.map(i=>task.checks[i]);
      for(const edit of checks){
        const a=region(edit.address);
        for(let r=0;r<a.rows;r++)for(let c=0;c<a.cols;c++){
          if(!targets.some(target=>{const b=region(target.address);return (target.field===edit.field||['value','formula'].includes(target.field)&&['value','formula'].includes(edit.field))&&a.r+r>=b.r&&a.r+r<b.r+b.rows&&a.c+c>=b.c&&a.c+c<b.c+b.cols;}))throw new Error('plan_step_mismatch');
        }
      }
    },
    finishAnalysis(){while(active()?.kind==='analyze'){active().state='done';advance();}},
    reviseAnalysis(){const step=steps.find(s=>s.kind==='analyze');if(step){step.state='running';steps.at(-1).state='pending';}},
    complete(){if(active()?.kind==='verify')active().state='done';},
    stop(state){const step=active();if(step)step.state=state==='awaiting_user'?'waiting':state==='cancelled'?'paused':'failed';},
    snapshot(){return{steps:steps.map(step=>({...step})),total:steps.length,completed:steps.filter(step=>step.state==='done').length,currentStepId:active()?.id||null};}
  };
}
