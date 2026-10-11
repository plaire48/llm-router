import {contextBudget} from '../../../extensions/aipro-chat/context-manager.js';
import {conversationModel, CONTEXT_SUMMARY_RATIO} from '../context-policy.mjs';
import {reportedContextUsage} from '../context-usage.mjs';

function summaryPolicy(model) {
  if (!Number.isSafeInteger(model?.contextLength) || model.contextLength <= 0) return {};
  try {
    const {capacity, trigger} = contextBudget(conversationModel(model));
    const ratio = trigger / capacity;
    const reduced = trigger < Math.floor(capacity * CONTEXT_SUMMARY_RATIO);
    return {compactAt:trigger, compactRatio:ratio, compactLabel:reduced ? '자동 요약' : '자동 요약 (75%)',
      ...(reduced ? {compactNote:'모델의 입력 제한을 먼저 보호해요.'} : {})};
  } catch { return {}; }
}

// The composer's context gauge: the browser's ContextMeter, fed with the task's latest model answer (task.context.usage,
// written by the agent). Provider counters, estimates and the model's maximum
// window have distinct sources. A missing report says nothing about the model's capabilities.
export function contextMeterInfo(usage, catalogModel){
  if(!Number.isSafeInteger(usage?.used)||usage.used<0)return null;
  const model = typeof catalogModel === 'number' ? {contextLength:catalogModel} : catalogModel || {};
  const reported=reportedContextUsage(usage),measured=reported?.total_tokens!=null;
  const used=measured?reported.total_tokens:usage.used;
  const reportedWindow=Number.isSafeInteger(usage.window)&&usage.window>0?usage.window:null;
  const fallbackWindow=Number.isSafeInteger(model.contextLength)&&model.contextLength>0?model.contextLength:null;
  const capacity=reportedWindow||fallbackWindow;
  const compacted=!measured&&usage.reason==='compaction';
  const note=measured?'모델이 알려 준 요청 사용량입니다.':compacted?'요약 후 컨텍스트를 추정했어요. 다음 응답에서 사용량을 갱신해요.':
    reported?'일부 사용량만 받아 전체 컨텍스트는 추정했어요.':usage.reason==='response_usage_missing'?
      '이번 응답의 사용량을 받지 못해 대화와 도구 결과로 추정했어요.':'대화와 도구 결과로 추정한 사용량입니다.';
  return {used,capacity,ratio:capacity?used/capacity:null,kind:measured?'measured':'estimated',
    ...summaryPolicy({...model,contextLength:capacity}),
    usage:reported,
    source:measured?'마지막 응답 실측':compacted?'요약 후 추정':'마지막 응답 추정',
    note:[note,
      !reportedWindow&&fallbackWindow?'현재 모델 목록의 최대 컨텍스트를 사용해요.':''].filter(Boolean).join(' ')};
}

// Keep the gauge available before the first reply and after a failed request.
// Missing measurements never become a made-up percentage or another model's
// usage. The current catalog supplies the window without shrinking it.
export function workspaceContextMeterInfo({task, model, draft = ''} = {}) {
  const modelId = model?.id || model?.name;
  const usage = task?.context?.usage;
  const previous = modelId && usage?.model === modelId ? contextMeterInfo(usage, model) : null;
  if (previous) return previous;
  const capacity = Number.isSafeInteger(model?.contextLength) && model.contextLength > 0 ? model.contextLength : null;
  const hasContext = !!(task?.request || task?.messages?.length || draft.trim());
  return {
    used:hasContext ? null : 0, capacity, ratio:!hasContext && capacity ? 0 : null,
    ...summaryPolicy(model),
    kind:hasContext ? 'unknown' : 'empty', usage:null,
    source:'',
    note:'선택한 모델의 응답을 받으면 요청 사용량을 표시해요.'
  };
}
