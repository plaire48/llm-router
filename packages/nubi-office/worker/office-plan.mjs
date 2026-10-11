import {inspectChecks, region} from './office-harness.mjs';

// Step completion comes from host observations, never an LLM's progress claim.
export function createPlanProgress(task,{requireEdits=false}={}) {
  const steps=task.steps.map(step=>({...step,state:'pending'})),written=new Set();
  const cells=address=>{const a=region(address),list=[];for(let r=0;r<a.rows;r++)for(let c=0;c<a.cols;c++){let n=a.c+c,name='';for(;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;list.push(name+(a.r+r));}return list;};
  // A later edit step needs no second write when this run already wrote all of its cells.
  const alreadyWritten=step=>step.checkIndexes.length>0&&step.checkIndexes.every(i=>cells(task.checks[i].address).every(cell=>written.has(cell)));
  function active(){return steps.find(step=>step.state!=='done');}
  function advance(){const step=active();if(step&&step.state==='pending')step.state='running';}
  advance();
  return {
    active,
    observe(snapshot) {
      if(active()?.kind==='inspect'){active().state='done';advance();}
      // Already satisfied edit steps also need no write.
      while((!requireEdits||alreadyWritten(active()||{checkIndexes:[]}))&&active()?.kind==='edit'&&!active().requiresReview&&inspectChecks(active().checkIndexes.map(i=>task.checks[i]),snapshot).verified){active().state='done';advance();}
    },
    recovering(){const step=active();if(step)step.state='recovering';},
    beginEdit(addresses=[]){for(const address of addresses)for(const cell of cells(address))written.add(cell);if(active()?.kind==='edit'){active().requiresReview=true;active().state='running';}},
    ready(snapshot){const step=active();return step?.kind==='edit'&&(!requireEdits||step.requiresReview)&&inspectChecks(step.checkIndexes.map(i=>task.checks[i]),snapshot).verified?step:null;},
    approve(snapshot){if(!this.ready(snapshot))throw new Error('acceptance_not_met');active().state='done';advance();this.observe(snapshot);},
    // The last edit step: only verify steps follow. Its semantic review is the final review of the whole task.
    isLastEdit(){const step=active();return step?.kind==='edit'&&steps.slice(steps.indexOf(step)+1).every(later=>later.kind==='verify');},
    approveByHost(snapshot){const step=this.ready(snapshot);if(!step)throw new Error('acceptance_not_met');step.state='done';step.approvedBy='host';advance();this.observe(snapshot);return step;},
    // A final review that finds a problem reopens that step, so a correction can be written.
    reopenHostApproved(){const step=[...steps].reverse().find(item=>item.approvedBy==='host');if(!step)return null;delete step.approvedBy;step.state='running';step.requiresReview=true;for(const later of steps.slice(steps.indexOf(step)+1))later.state='pending';return step;},
    // before: the cells before the write. A cell that is empty, in no step, and between two planned cells of the active
    // step in its column or in its row is part of that step: the plan checked the ends of what it fills. Measured
    // 2026-09-30 (gpt-5.6-sol, 200 pasted rows): the plan checked A2, A201 and all of B and C, and the write of A3:A200
    // was refused until a person was needed.
    assertEdit(checks,allowed=()=>false,{before}={}) {
      const step=active(),mismatch=issue=>{throw Object.assign(new Error('plan_step_mismatch'),{issue:issue.slice(0,600)});};
      if(step?.kind!=='edit')mismatch(`No edit step is active: the current step is ${step?`${step.id} (${step.kind})`:'none'}. Every planned edit step is already complete because its checks hold in the current cells. Do not write again; verify the result, or report which requirement is still unmet.`);
      const targets=step.checkIndexes.map(i=>task.checks[i]);
      const ends=targets.filter(target=>['value','formula'].includes(target.field)).map(target=>region(target.address)),outer=before?region(before.address):null;
      const planned=new Set(steps.flatMap(item=>item.checkIndexes).flatMap(i=>cells(task.checks[i].address)));
      const empty=(row,column)=>{const at=[row-outer.r,column-outer.c],value=before.values?.[at[0]]?.[at[1]];return(value===null||value===undefined||value==='')&&!before.formulas?.[at[0]]?.[at[1]];};
      const between=(row,column,name)=>!!outer&&row>=outer.r&&row<outer.r+outer.rows&&column>=outer.c&&column<outer.c+outer.cols&&!planned.has(name)&&empty(row,column)&&(
        ends.some(b=>b.c<=column&&column<b.c+b.cols&&b.r+b.rows<=row)&&ends.some(b=>b.c<=column&&column<b.c+b.cols&&b.r>row)||
        ends.some(b=>b.r<=row&&row<b.r+b.rows&&b.c+b.cols<=column)&&ends.some(b=>b.r<=row&&row<b.r+b.rows&&b.c>column));
      for(const edit of checks){
        const a=region(edit.address);
        for(let r=0;r<a.rows;r++)for(let c=0;c<a.cols;c++){
          if(allowed(cells(edit.address)[r*a.cols+c]))continue;
          if(['value','formula'].includes(edit.field)&&between(a.r+r,a.c+c,cells(edit.address)[r*a.cols+c]))continue;
          if(!targets.some(target=>{const b=region(target.address);return (target.field===edit.field||['value','formula'].includes(target.field)&&['value','formula'].includes(edit.field))&&a.r+r>=b.r&&a.r+r<b.r+b.rows&&a.c+c>=b.c&&a.c+c<b.c+b.cols;}))mismatch(`The write changes ${edit.field} of ${cells(edit.address)[r*a.cols+c]}, which the active step ${step.id} does not plan. This step covers: ${targets.map(target=>target.address+' '+target.field).join(', ')||'nothing'}. Write only what this step covers; later steps are written after this one is verified.`);
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
