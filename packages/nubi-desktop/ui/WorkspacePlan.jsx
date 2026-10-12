import React from 'react';
import {TaskPlan} from '../../../extensions/aipro-chat/src/TaskPlan.jsx';

// Host evidence supplies progress. A finished answer never completes plan steps.
export function WorkspacePlan({task,trace,historical=false,answered=false}) {
  // Browser plan history uses epoch milliseconds; Desktop persisted ISO dates.
  // Adapt the host format so shared additions/removals and reasons stay visible.
  const updates=(task.workPlan?.updates||[]).map(update=>({...update,at:typeof update.at==='number'?update.at:Date.parse(update.at)}));
  const waiting=task.state==='waiting_input',running=task.state==='running';
  const collapsed=historical||['review','completed'].includes(task.state);
  const finished=task.state==='review'&&task.resultReview?.status==='ready'&&!!task.resultReview.checks?.length&&task.resultReview.checks.every(check=>check.state==='supported')&&task.workPlan?.steps?.every(step=>step.status==='completed');
  const status=waiting&&!answered?'awaiting_user':running?'running':finished?'done':'paused';
  const label=answered?'답변 받음':waiting?(task.peerWait?'연결한 누비 응답 대기':task.computerConnectionRequest?'앱 연결 대기':'답변 대기'):task.state==='review'?(task.resultReview?.status==='ready'?(task.resultReview.checks?.some(check=>check.state==='pending')?'반영 대기':'응답 확인됨'):'결과 확인 필요'):task.state==='cancelled'?'중지됨':undefined;
  return <TaskPlan compactOverview overviewClassName="nubi-work-plan" defaultExpanded={false} key={`${task.workPlan?.runId||task.id}:${collapsed?'result':'active'}`} progress={{plan:task.workPlan?.steps,updates,status,review:task.resultReview?.status}} trace={trace} question={task.question} phase={task.context?.phase} statusLabel={label}/>;
}
