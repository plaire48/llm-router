// What the approval card of a batch shows. Text only: no input, no state.
const RESULT={value_matched:'입력값 일치',state_matched:'상태 확인',value_mismatch:'입력값이 요청과 다름',state_mismatch:'상태가 요청과 다름',state_unavailable:'상태를 읽지 못함'};
const ran=state=>['observed','attention','acknowledged','starting'].includes(state);
function result(action,step){
  if(!ran(action.state))return '';
  if(step.execution==='unknown')return '결과를 알 수 없음';
  if(step.execution==='already_at_target')return '이미 요청한 상태';
  if(step.execution==='command_returned')return RESULT[step.verification]||'실행함. 결과는 화면에서 확인';
  return action.state==='starting'?'':'실행하지 않음';
}
function summary(action){
  const at=action.stopped?.step?action.stopped.step+'번째 단계':'한 단계';
  switch(action.state){
    case 'proposed':return '승인하면 아래 순서대로 한 번 실행합니다. 대상이 바뀌면 그 단계에서 멈춥니다.';
    case 'starting':return '실행 결과를 기다립니다.';
    case 'rejected':return '이 묶음은 실행하지 않았습니다.';
    case 'acknowledged':return '사용자가 결과를 확인했습니다. 업무 성공 판정과는 별개입니다.';
    case 'stale':return action.error==='computer_approval_expired'?'승인 시간이 지나 실행하지 않았습니다. 다시 제안해 주세요.'
      :action.error==='computer_document_stale'?'문서 분석의 원본이 바뀌어 실행하지 않았습니다. 최신 문서로 다시 확인해 주세요.'
      :action.error==='wiki_evidence_stale'?'OpenWiki-SDS 근거가 바뀌어 실행하지 않았습니다. 최신 근거로 다시 제안해 주세요.'
      :'대상이 바뀌어 실행하지 않았습니다. 현재 화면으로 다시 제안해 주세요.';
    case 'attention':return action.error==='computer_pointer_hide_failed'?'단계는 실행했지만 표시용 커서를 숨기지 못했습니다. 화면을 확인해 주세요.':action.verification==='steps_mismatch'?at+'의 결과가 요청과 다릅니다. 실제 앱을 확인해 주세요. 남은 단계는 실행하지 않았습니다.'
      :at+'의 결과를 알 수 없습니다. 실제 앱을 확인해 주세요. 같은 동작을 자동으로 반복하지 않습니다.';
    case 'observed':return action.verification==='steps_partial'?at+'에서 대상이 바뀌어 멈췄습니다. 그 단계부터는 실행하지 않았습니다.'
      :'모든 단계를 실행하고 값과 상태를 확인했습니다. 버튼을 누른 결과와 업무 결과는 별도로 확인해 주세요.';
    default:return '실제 앱의 결과를 확인해 주세요.';
  }
}
export function batchView(action,verbs){
  const steps=(action.steps||[]).map(step=>({index:step.index,label:(verbs[step.action]||step.action)+': '+(step.target?.element?.name||step.target?.element?.type||step.selector),
    ...(step.action==='set_value'?{value:step.value??''}:{}),result:result(action,step)}));
  return {title:`묶음 입력 ${steps.length}단계`,steps,summary:summary(action)};
}
