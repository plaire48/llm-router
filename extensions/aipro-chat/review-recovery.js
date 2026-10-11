// This is a result envelope, never a browser action. OpenCode's structured
// output pattern is adapted to the existing provider tool transport.
export const GOAL_REVIEW_TOOL = {type:'function', function:{name:'report_goal_review',
  description:'Return the independent review in this schema. This only reports a result and performs no action.',
  parameters:{type:'object', additionalProperties:false, required:['status','checks','next_step'], properties:{
    status:{type:'string',enum:['complete','revise','blocked']},
    checks:{type:'array',minItems:1,maxItems:8,items:{type:'object',additionalProperties:false,required:['requirement','status','evidence_ids'],properties:{
      requirement:{type:'string',minLength:1,maxLength:240},status:{type:'string',enum:['met','unmet','unknown']},
      evidence_ids:{type:'array',maxItems:16,items:{type:'integer',minimum:1}},
    }}},next_step:{type:'string',maxLength:600},
  }}}};

export const COMPLETION_REVIEW_TOOL={type:'function',function:{name:'report_completion_intent',description:'Report whether the proposed answer requires external work. No actions are performed.',parameters:{type:'object',additionalProperties:false,required:['decision','scope','next_step'],properties:{decision:{type:'string',enum:['reply','work','question']},scope:{type:'string',enum:['conversation','browser','project']},next_step:{type:'string',maxLength:600}}}}};

export function reviewEnvelope(response, tool=GOAL_REVIEW_TOOL) {
  if (!response?.calls?.length) return response; // Providers may still return valid plain JSON.
  const call=response.calls[0];
  if (response.calls.length!==1 || call?.function?.name!==tool.function.name || typeof call.function.arguments!=='string')
    throw Object.assign(new Error('goal_review_failed'),{reviewReason:'unexpected_tool_call'});
  return {...response,content:call.function.arguments,calls:null};
}

const REASONS=new Set(['json_invalid','schema_invalid','status_inconsistent','evidence_invalid','question_invalid','unexpected_tool_call','response_size','output_limit','response_invalid','too_long','context_budget','context_budget_research','review_unavailable']);
export const reviewReason = error => REASONS.has(error?.reviewReason) ? error.reviewReason : REASONS.has(error?.message) ? error.message : 'review_unavailable';
export const reviewCanRecover = error => ['goal_review_failed','response_invalid','output_limit'].includes(error?.message);
// Unknown/custom tools and scripts are excluded even if a model calls them "read-only".
export const REVIEW_RECOVERY_TOOLS=new Set(['ask_user','browser_snapshot','read_page','inspect_dom','capture_page','verify_page','verify_form','list_tabs','search_documents','read_document','wiki_query','wiki_search','wiki_read','source_search','read_source','read_analysis_evidence']);
export const REVIEW_RECOVERY_GUIDANCE='The independent final reviewer could not produce a valid result. This is a review failure, NOT proof that the page action failed. Preserve all completed actions and receipts. Use only available read/verification tools to inspect focused current evidence and correct unsupported wording. Do not fill, click, navigate, run scripts, request approval or replay writes. Then return a qualified candidate answer for independent review. Do not claim final completion before that review succeeds.';
export function reviewRecoveryQuestion(error) {
  const context=reviewReason(error).startsWith('context_budget');
  return {question:context ? '요청과 근거가 검토 범위를 초과했습니다. 요청 조건은 유지하며 어떤 부분부터 나눠 확인할까요?' : '결과 검토 응답을 다시 확인하지 못했습니다. 현재 작업은 보존했습니다. 어떻게 이어갈까요?',
    ...(!context ? {choices:[{label:'현재 결과 다시 확인'},{label:'직접 확인한 결과 설명'}]} : {}),input_mode:'long_text'};
}
