import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ProjectService} from '../runtime/project-service.mjs';
import {git} from '../runtime/files.mjs';
import {WORK_PLAN_PROMPT} from '../runtime/work-plan.mjs';
import {REVIEW_PROMPT} from '../runtime/result-review.mjs';
export function fixturePlan(messages) {
  if(!messages[0]?.content.startsWith(WORK_PLAN_PROMPT))return null;
  return {content:JSON.stringify({intent:{goal:'요청한 자료 확인',constraints:[],outcomes:['실제 결과와 남은 확인을 구분한다'],workflowIds:[],skillPaths:[]},steps:[{text:'요청한 자료 확인',expected_outcome:'현재 근거를 확인한다',status:'in_progress'},{text:'확인한 결과 정리',expected_outcome:'실제 결과와 남은 확인을 구분한다',status:'pending'}]}),calls:[]};
}
export function fixtureReview(messages) {
  if(!messages[0]?.content.startsWith(REVIEW_PROMPT))return null;
  const {requirements}=JSON.parse(messages[1].content);
  return {content:JSON.stringify({status:'ready',checks:requirements.map(r=>({requirementId:r.id,state:'unknown',evidenceIds:[],detail:'Fixture response only; no verified outcome.'})),nextStep:''}),calls:[]};
}

export async function fixture(t,{scriptedReview=false,scriptedPlanning=false}={}) {
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-desktop-'))),root=path.join(directory,'repo');
  await mkdir(root);await git(root,['init','-q']);await git(root,['config','user.email','fixture@example.invalid']);await git(root,['config','user.name','Fixture']);
  await mkdir(path.join(root,'openwiki'));
  await writeFile(path.join(root,'app.txt'),'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n');
  await writeFile(path.join(root,'openwiki','home.md'),'# Project knowledge\n\nThe welcome screen uses app.txt.\n');
  await git(root,['add','.']);await git(root,['commit','-qm','Initial fixture']);
  const service=new ProjectService({storageRoot:path.join(directory,'state')});await service.open(root);
  // Existing focused tool tests script executor turns only. Supply a distinct
  // reviewer response without consuming those scripts. End-to-end review tests
  // opt into scriptedReview and exercise the real review/provider boundary.
  {let provider;Object.defineProperty(service,'providers',{configurable:true,get:()=>provider,set:value=>{
    provider=value;if(!value?.complete)return;
    const complete=value.complete.bind(value);
    value.complete=async(messages,...args)=>{
      const plan=!scriptedPlanning&&fixturePlan(messages);if(plan)return plan;
      const review=!scriptedReview&&fixtureReview(messages);if(review)return review;
      return complete(messages,...args);
    };
  }});}
  t.after(async()=>{service.dispose();while(service.processes.active.size)await new Promise(r=>setTimeout(r,30));service.store.close();await rm(directory,{recursive:true,force:true});});
  return {service,root,directory};
}
