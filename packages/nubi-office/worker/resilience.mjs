import {setTimeout as sleep} from 'node:timers/promises';
import pRetry, {AbortError} from 'p-retry';
import {safeError} from './connection-errors.mjs';
import {transient,faultFacts,isRetryableRead,transientRead} from './fault-policy.mjs';
export {transient} from './fault-policy.mjs';
import {connectionErrors} from './connection-errors.mjs';
import {prepareContextRequest,selectedModel,recordPromptTokens,forgetPromptTokens,recordPressure,tokenFactor} from './context-budget.mjs';

// Retrying inference is safe: it cannot execute an Excel tool. Native writes
// must use their own receipt/readback reconciliation, never this function.
export const modelRepairable = new Set(['output_limit','too_long','response_invalid','document_schema_invalid','document_reference_invalid','unsupported_formula','formula_syntax_invalid','circular_formula','formula_dependency_limit','invalid_range','invalid_typed_value','invalid_format','goal_review_failed','document_incomplete','agent_stalled','tools_unavailable','context_checkpoint','task_invalid','task_plan_invalid','recovery_plan_invalid']);
export function retryDelay(attempt, random = Math.random) {return Math.min(30000, 750 * 2 ** Math.min(attempt - 1, 6)) * (0.75 + random() * 0.25);}
// The waiting policy of browser Nubi (MODEL_WAIT_POLICY in extensions/aipro-chat/model-recovery.js): a model call is
// stopped after 2 minutes without a streamed model event, and after 5 minutes in all. Until 2026-09-30 Office stopped
// every call after 2 minutes: writing 200 pasted rows (gpt-5.6-sol) was cut off three times while it was generated.
export const MODEL_WAIT=Object.freeze({idleMs:120000,attemptMs:300000});
// expire runs once the call has been silent for idleMs or has run for attemptMs. renew() is called for every streamed
// model event: text, reasoning or tool call arguments.
export function modelDeadline(expire,{idleMs=MODEL_WAIT.idleMs,attemptMs=MODEL_WAIT.attemptMs}={}){
  let stopped=false,idle=setTimeout(expire,idleMs);const limit=setTimeout(expire,Math.max(idleMs,attemptMs));
  return{renew(){if(stopped)return;clearTimeout(idle);idle=setTimeout(expire,idleMs);},stop(){stopped=true;clearTimeout(idle);clearTimeout(limit);}};
}
export const recoveryHint = (code, attempt) => `Attempt ${attempt} failed (${code}). Keep the ORIGINAL requirements and completed work. Correct the cause, not just the wording. ${code==='output_limit'||code==='too_long'?'Use write_document_chunk with at most 12 cells per call and commit_document_sheet when complete. Never repeat one oversized sheet response.':'Use small valid tool calls, inspect the actual error and correct only the unfinished work.'} Do not invent facts or waive checks. Return only the requested response schema.`;
// These tools can reject local preparation, but cannot mutate native Office.
// Returned failures need supervision just like thrown model failures. They are
// NEVER passed to p-retry: the model must inspect the receipt and decide again.
const localTools=new Set(['delegate_draft_tasks','read_delegation_results','read','find','edit','write','run_script','prepare_python','list_document_skills','use_document_skill','inspect_office_view','show_document_target','review_office_view','read_document_draft','write_document_chunk','write_document_sheet','commit_document_sheet']);

// renewOnPressure(messages): true when the caller can rebuild the request from verified state after the server could not
// answer it at its size; the request is then not sent again as it was (context-budget.mjs, pressure).
export function createResilience({signal,activity,metrics,renewOnPressure=()=>false,attemptTimeoutMs=MODEL_WAIT.idleMs,attemptLimitMs=MODEL_WAIT.attemptMs,wait=(ms,s)=>sleep(ms,undefined,{signal:s}),random=Math.random,now=Date.now,getProgress=()=>'',onStall,repairHint=recoveryHint}) {
  let recovery=null, lastProgress, failures=0, event,lastLocalFailure=null;
  const check=()=>{if(signal.aborted)throw new Error('cancelled');};
  const causes={view_changed_during_review:'검토 중 화면이 바뀌어 최신 화면에서 다시 확인합니다.',view_provider_changed:'검토 중 선택 모델이 바뀌어 결과를 반영하지 않았습니다.',view_source_changed:'문서가 바뀌어 현재 내용을 다시 확인해야 합니다.',view_review_failed:'화면 검토를 마치지 못했습니다. 완료한 문서 작업은 유지합니다.',view_expired:'화면 관찰이 만료되어 다시 확인해야 합니다.',python_environment_failed:'Python 또는 패키지 설치에 실패했습니다. 네트워크와 패키지 조건을 확인합니다.',python_environment_required:'먼저 스킬에 필요한 Python 환경을 준비해야 합니다.',python_requirements_invalid:'설치할 패키지 이름과 고정 버전을 확인합니다.',python_environment_busy:'다른 작업이 같은 Python 환경을 준비하고 있습니다.',python_runtime_missing:'Python 환경 관리 도구가 없습니다. 누비 설치 상태를 확인합니다.',python_limits_unavailable:'Python 실행 제한을 설정하지 못해 코드를 실행하지 않았습니다.',python_environment_changed:'승인한 Python 환경 정보가 바뀌어 실행하지 않았습니다.',python_script_failed:'Python 코드가 실패했습니다. 오류 위치와 입력을 확인해 수정합니다.',python_timeout:'Python 실행 시간이 초과됐습니다. 작업을 나누고 이전 실행 결과를 확인합니다.',python_output_limit:'Python 결과가 너무 큽니다. 필요한 결과만 반환하도록 수정합니다.',python_execution_uncertain:'Python 프로세스 종료를 확인하지 못했습니다. 실행 상태를 확인해야 합니다.',script_dependency_changed:'앞선 계산의 원본이나 코드가 바뀌었습니다. 원본부터 계산을 다시 확인합니다.',script_result_conflict:'계산 결과 위치에 다른 초안이 있어 덮어쓰지 않았습니다.',tool_arguments_invalid:'도구의 입력 형식이 맞지 않아 실행 전에 거절했습니다.',duplicate_write:'새 문서에 이미 쓴 내용을 다시 쓰려 해서 쓰지 않았습니다.',tool_unavailable:'현재 제공하지 않는 도구를 요청해 실행하지 않았습니다.',workspace_file_missing:'요청한 작업 자료를 찾지 못했습니다. 경로를 다시 확인합니다.',workspace_edit_rejected:'초안 수정 위치가 현재 내용과 맞지 않습니다.',script_failed:'계산 코드가 실패했습니다. 입력과 코드를 확인합니다.',script_syntax_error:'계산 코드의 문법을 수정해야 합니다.',script_timeout:'계산 시간이 초과되어 작업을 더 작게 나눠야 합니다.',script_output_invalid:'계산 결과가 지원하는 데이터 형식과 맞지 않습니다.',formula_syntax_invalid:'수식의 문법과 인자 수를 확인해야 합니다.',circular_formula:'수식이 자신이나 다른 수식을 순환 참조합니다.',formula_dependency_limit:'수식 참조가 사전 검사의 처리 범위를 넘었습니다.',document_schema_invalid:'모델 응답이 문서 작성 형식과 맞지 않습니다.',response_invalid:'모델 응답을 읽을 수 없습니다.',output_limit:'모델 응답이 길이 제한에서 끊겼습니다.',too_long:'모델 응답이 너무 큽니다.',document_incomplete:'실행 가능한 문서 작성 결과가 없습니다.',tools_unavailable:'현재 응답에서 도구 호출을 확인하지 못했습니다.',goal_review_failed:'검토 결과의 근거나 형식이 맞지 않습니다.',model_timeout:'모델 응답 대기 시간이 초과됐습니다.',upstream:'모델 서버가 요청을 처리하지 못했습니다.',rate_limited:'모델 사용량 제한으로 응답을 받지 못했습니다.',office_timeout:'Office 실행 결과를 아직 확인하지 못했습니다.',context_checkpoint:'다음 호출을 위해 현재 작업 문맥을 정리합니다.'};
  async function recover(error, attempt, title='응답을 다시 요청합니다.') {
    check();const code=safeError(error),facts=faultFacts(error),serverDelay=facts.retryAfterMs||0,delayMs=Math.max(retryDelay(attempt,random),serverDelay),progress=JSON.stringify(getProgress()),serverDeadline=now()+serverDelay;
    failures=progress===lastProgress?failures+1:1;lastProgress=progress;
    const cause=({model_stream_incomplete:'모델 응답이 끝나기 전에 연결이 끊겼습니다.',excel_busy:'Excel이 다른 작업을 처리하고 있습니다.',office_busy:'Office가 다른 작업을 처리하고 있습니다.'})[code]||causes[code]||connectionErrors[code]||'작업 응답을 검증하지 못했습니다.';
    metrics.retries=(metrics.retries||0)+1;
    recovery={attempt,code,cause,...facts,state:'waiting',withoutProgress:failures,nextAttemptAt:now()+delayMs};
    if(event && event.state==='running')activity.end(event,{state:'waiting'});
    event=activity.start(title,{kind:'recovery',detail:`${cause} (${code}), 재요청 ${attempt}회${serverDelay?`, 서버 지정 대기 ${Math.ceil(serverDelay/1000)}초`:''}`,tool:'recover_failure'});
    // This is a no-progress checkpoint, not a total run/repair budget. Accepted
    // work resets it. A user can resume the SAME run; no completed writes replay.
    if(failures>=3){
      recovery.state='paused';metrics.recoveryPauses=(metrics.recoveryPauses||0)+1;
      activity.end(event,{state:'waiting',title:'진전 없는 재시도를 멈추고 확인을 기다립니다.',detail:`${cause} (${code})`});
      if(!onStall)throw new Error('recovery_no_progress');
      await onStall({...recovery});check();failures=0;lastProgress=JSON.stringify(getProgress());
      // HITL is not permission to bypass a server's Retry-After deadline.
      const remaining=Math.max(0,serverDeadline-now());
      recovery={...recovery,state:remaining?'waiting':'retrying',nextAttemptAt:remaining?now()+remaining:null};
      if(remaining)activity.end(event,{state:'waiting',title:'사용자 확인을 받았습니다. 서버가 지정한 대기 시간을 지킵니다.'});
      await waitDelay(remaining);
      recovery={...recovery,state:'retrying',nextAttemptAt:null};return;
    }
    try {await waitDelay(delayMs);recovery={...recovery,state:'retrying',nextAttemptAt:null};activity.end(event,{state:'waiting',title:'재요청을 준비했습니다. 실제 결과를 기다립니다.'});}
    catch(error){activity.end(event,{state:'cancelled'});throw error;}
  }
  async function waitDelay(delay) {
    // Avoid Node's overflowing timers for long Retry-After values, and keep
    // cancellation responsive. Injected waits make the policy testable.
    for(let left=delay;left>0;){check();const chunk=Math.min(left,30000);await wait(chunk,signal);check();left-=chunk;}
  }
  async function pauseForProgress({code,cause}) {
    check();
    recovery={attempt:0,code,cause,state:'paused',withoutProgress:3,nextAttemptAt:null};
    metrics.recoveryPauses=(metrics.recoveryPauses||0)+1;
    const paused=activity.start('반복 실행을 멈추고 확인을 기다립니다.',{kind:'recovery',detail:cause,tool:'recover_failure'});
    activity.end(paused,{state:'waiting'});
    if(!onStall)throw new Error('recovery_no_progress');
    await onStall({...recovery});check();
    failures=0;lastProgress=JSON.stringify(getProgress());recovery=null;
    activity.note('완료한 작업을 유지하고 다음 동작을 다시 계획합니다.');
  }
  async function retryOperation(operation,mayRetry,title) {
    try {return await pRetry(async()=>{
      check();try{return await operation();}catch(error){check();if(!mayRetry(error))throw new AbortError(error);
        // Normalize known transport TypeErrors; p-retry otherwise treats
        // programming TypeErrors as permanent, as it should.
        throw Object.assign(new Error(safeError(error)),faultFacts(error));}
    },{retries:Infinity,minTimeout:0,maxTimeout:0,factor:1,signal,
      onFailedAttempt:({error,attemptNumber})=>recover(error,attemptNumber,title)});
    }catch(error){check();throw error;}
  }
  async function complete(providers,messages,tools=[],onText=()=>{},onPhase=()=>{},options={}) {
    let hadText=false;
    return retryOperation(async()=>{
      check();
      const local=new AbortController();let deadline,abort,active=true;
      const renew=()=>{if(active&&!signal.aborted&&!local.signal.aborted)deadline.renew();};
      const emitText=value=>{if(active&&!signal.aborted&&!local.signal.aborted){renew();hadText=true;onText(value);}};
      const emitPhase=value=>{if(active&&!signal.aborted&&!local.signal.aborted){renew();onPhase(value);}};
      const interrupted=new Promise((_,reject)=>{
        abort=()=>{active=false;local.abort();reject(new Error('cancelled'));};signal.addEventListener('abort',abort,{once:true});
        deadline=modelDeadline(()=>{active=false;local.abort();reject(new Error('model_timeout'));},{idleMs:attemptTimeoutMs,attemptMs:attemptLimitMs});
      });
      try {
        const model=selectedModel(providers),prepared=prepareContextRequest(messages,tools,metrics,model),estimated=metrics.requestContext?.lastEstimatedTokens;metrics.modelCalls++;
        // A request the model server refuses as too long discards the measurements of that model; a large one it could not
        // answer lowers that model's compaction point (context-budget.mjs).
        let result;try{result=await Promise.race([providers.complete(prepared,tools,local.signal,emitText,emitPhase,renew,options),interrupted]);}
        catch(error){
          if(safeError(error)==='context_overflow')forgetPromptTokens(model);
          else if(transient(error)&&!signal.aborted){
            const pressure=recordPressure(model,Math.round((estimated||0)*tokenFactor(model)));
            if(pressure){if(metrics.requestContext)metrics.requestContext.pressureTokens=pressure;if(renewOnPressure(prepared))throw Object.assign(new Error('context_overflow'),{pressure:true});}
          }
          throw error;
        }
        check();recovery=null;
        // The tokens the model server counted for this request calibrate the budget of the model.
        const promptTokens=result?.usage?.prompt_tokens,factor=recordPromptTokens(model,estimated,promptTokens),state=metrics.requestContext;
        if(factor!==null&&state)Object.assign(state,{tokenCount:'measured',lastPromptTokens:promptTokens,tokenFactor:factor,peakPromptTokens:Math.max(state.peakPromptTokens||0,promptTokens)});return result;
      }catch(error){
        active=false;if(!signal.aborted&&hadText){onText('');hadText=false;}throw error;
      }finally {active=false;deadline.stop();signal.removeEventListener('abort',abort);local.abort();}
    },transient,'모델 연결을 확인하고 자동으로 다시 요청합니다.');
  }
  async function read(name,operation) {
    // Fail closed: adding a tool never implicitly authorizes replaying it.
    if(!isRetryableRead(name))throw new Error('unsafe_tool_retry');
    return retryOperation(async()=>{
      const result=await operation();check();
      if(result?.error)throw new Error(result.error);
      recovery=null;return result;
    },transientRead,'Office의 읽기 결과를 다시 확인하고 있습니다.');
  }
  async function localTool(name,operation){
    check();const result=await operation();check();
    if(!localTools.has(name))return result;
    if(!result?.error){if(lastLocalFailure?.tool===name)lastLocalFailure=null;return result;}
    metrics.localToolFailures=(metrics.localToolFailures||0)+1;
    lastLocalFailure={tool:name,error:safeError(result.error),...faultFacts(result),
      ...Object.fromEntries(['reason','errorName','detail','issue','instruction'].filter(key=>typeof result[key]==='string').map(key=>[key,result[key].slice(0,key==='instruction'?600:240)]))};
    // A model failure inside a read-only tool retains the inference policy.
    // Authentication/configuration failures must not become tool retry loops.
    if(name==='review_office_view'&&result.error==='view_review_failed'&&result.reason){
      const cause=Object.assign(new Error(safeError(result.reason)),faultFacts(result));
      if(!transient(cause)&&!modelRepairable.has(cause.message)&&cause.message!=='analysis_invalid')throw cause;
    }
    const attempt=JSON.stringify(getProgress())===lastProgress?failures+1:1;
    await recover(Object.assign(new Error(safeError(result.error)),faultFacts(result)),attempt,'도구 오류를 확인하고 다음 동작을 수정합니다.');check();
    return{...result,recoveryHandled:true};
  }
  // responseFormat: the JSON schema the provider asks the server to enforce (AI Pro); the answer is parsed and checked
  // all the same.
  async function structured(makeMessages,parse,providers,{tools=[],title='응답 형식을 확인하고 다시 요청합니다.',responseFormat}={}) {
    let feedback='';
    for(let attempt=0;;){
      check();let response;
      try {response=await complete(providers,makeMessages(feedback),tools,undefined,undefined,responseFormat?{responseFormat}:{});return parse(response);}
      catch(error){check();if(!modelRepairable.has(safeError(error)))throw error;
        feedback=JSON.stringify({error:safeError(error),instruction:repairHint(safeError(error),attempt+1),issue:typeof error.issue==='string'?error.issue.slice(0,600):undefined,rejectedResponse:response?.content?.slice(0,6000)});
        await recover(error,++attempt,title);
      }
    }
  }
  return{complete,structured,read,localTool,localFailure:()=>lastLocalFailure?{...lastLocalFailure}:null,recover,pauseForProgress,status:()=>recovery?{...recovery}:null,check};
}
