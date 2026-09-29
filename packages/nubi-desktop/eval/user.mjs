// The simulated user of an evaluation case. It answers only what the case
// defines and approves only what the case allows. Anything else needs a
// person: the case then ends as needs_human instead of guessing.
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const questionText=question=>typeof question==='string'?question:String(question?.text||'');

export function createUser(testCase){
  const used=new Set(),log={questions:[],answers:[],applied:[],refused:[]};
  return{
    log,
    // Returns answerAgent arguments, or null when no single defined answer fits.
    answer(question){
      const asked=questionText(question);log.questions.push(asked);
      const matches=(testCase.dialogue||[]).map((item,index)=>({...item,index})).filter(item=>!used.has(item.index)&&new RegExp(item.match,'iu').test(asked));
      if(matches.length!==1)return null;
      used.add(matches[0].index);log.answers.push(matches[0].answer);
      if(typeof question==='string')return {answer:matches[0].answer};
      const option=(question.options||[]).find(item=>item.label===matches[0].answer);
      return {choice:option?{questionId:question.id,optionId:option.id}:{questionId:question.id,text:matches[0].answer}};
    },
    allows:kind=>(testCase.approvals||[]).includes(kind),
  };
}

// Applies this task's open proposals the way the editor does: the newest
// proposal per path, write, then let the host confirm the saved hash.
// Commands, setup, elevation and computer actions are never approved here.
export async function applyProposals({service,taskId,user,root}){
  const open=service.state().proposals.filter(proposal=>proposal.taskId===taskId&&proposal.state==='proposed')
    .sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),seen=new Set();
  for(const proposal of open){
    if(seen.has(proposal.path))continue;seen.add(proposal.path);
    const kind=proposal.kind==='create'?'new_file':'patch';
    if(!user.allows(kind)){user.log.refused.push({path:proposal.path,kind,reason:'not_allowed'});continue;}
    try{
      if(kind==='new_file')await service.applyNewFile({proposalId:proposal.id});
      else{
        const prepared=await service.prepareProposal({proposalId:proposal.id});
        if(!prepared.alreadyApplied){await writeFile(path.join(root,proposal.path),prepared.content);await service.confirmProposal({proposalId:proposal.id});}
      }
      user.log.applied.push({path:proposal.path,kind});
    }catch(error){user.log.refused.push({path:proposal.path,kind,reason:/^[a-z_]{1,64}$/.test(error.message)?error.message:'apply_failed'});}
  }
  return user.log;
}
