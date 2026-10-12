import {ResponseTime} from './ResponseTime.jsx';
import React from 'react';
import {AgentTrace} from '../../../extensions/aipro-chat/src/AgentTrace.jsx';
import {TOOL_LABELS, isAnalysisStep, normalizeTrace, normalizeTraceId} from '../../../extensions/aipro-chat/agent-trace.js';
import {WorkspacePlan} from './WorkspacePlan.jsx';
import {currentActivityRunId} from './conversation-activity.mjs';

// Fixed host vocabulary. Native operations keep their own names and authority.
const toolLabels = Object.freeze({...TOOL_LABELS, ...{inspect_environment:'실행 환경 확인',request_computer_connection:'확인할 앱 연결 요청',inspect_workspace_changes:'작업공간 변경 확인',read_process_output:'실행 기록 확인',analyze_documents:'문서 분담 분석',read_document_analysis:'저장된 분석 확인',compare_local_pages:'변경 전후 화면 확인',update_plan:'작업 계획 정리',review_task:'요구사항과 결과 확인',list_skill_resources:'스킬 자료 목록 확인',use_skill:'등록한 스킬 사용',discover_capabilities:'스킬과 도구 찾기',read_skill:'스킬 지침 확인',read_conversation:'이전 대화 확인',computer_checkpoint:'앱 작업 기록 확인',read_computer_result:'동작 결과 확인',list_computer_apps:'등록된 앱 확인',propose_computer_launch:'앱 실행 제안',verify_computer_value:'화면 값 대조',observe_computer:'앱 화면 확인',propose_computer_action:'컴퓨터 동작 제안',propose_computer_batch:'컴퓨터 동작 묶음 제안',select_tools:'필요한 도구 연결',inspect_path:'생성 위치와 규칙 확인',propose_new_file:'새 파일 제안',propose_setup_action:'실행할 명령 준비',code_outline:'코드 구조 확인',recovery_snapshot:'중단 기록 확인',propose_command_repair:'명령 수정안 준비',delegate_analysis:'조사 나누기',collect_analysis:'조사 결과 확인',read_analysis_evidence:'분석 근거 읽기',cancel_analysis:'조사 중단',analysis_research:'문서와 소스 조사',analysis_review:'독립 검토',analysis_recovery:'실패 원인 확인',analysis_page:'화면 근거 분석',knowledge_query:'연결된 자료 확인',record_change_plan:'변경 계획 정리',source_search:'관련 소스 찾기',read_source:'소스 읽기',wiki_query:'프로젝트 지식 찾기',propose_patch:'필요한 구간 수정',propose_edit:'변경안 준비',ask_user:'요구사항 확인'},
  ground_computer_target:'조작할 위치 확인',verify_computer_outcome:'앱 동작 결과 대조',
  personal_mail_query:'메일과 개인 위키 검색',read_personal_mail:'메일 원문과 개인 위키 조회',
  ask_openwiki:'프로젝트 자료 조사'});
const traceOptions = Object.freeze({toolLabels, toolErrorLabels:{propose_setup_action:"준비안 확인 필요"}, errorLabels:{tool_arguments_invalid:"입력 형식 수정 필요",plan_json_invalid:"응답 형식 확인 필요",plan_arguments_invalid:"계획 항목 확인 필요",plan_tool_calls:"계획 응답 확인 필요",plan_output_limit:"응답 길이 초과",plan_request_format:"요청 형식 확인 필요",plan_request_failed:"모델 연결 확인 필요"}, normalizeId(value) {
  if (normalizeTraceId(value)) return value;
  if (typeof value !== 'string' || value.length > 160) return null;
  const [runId, round, ...index] = value.split(':');
  return normalizeTraceId(runId) && /^(?:\d+|review)$/.test(round) && index.length === 1 && /^[a-z0-9_-]+$/i.test(index[0]) ? value : null;
}});

export function WorkspaceActivity({task,run,historical=false}) {
  const questions=task.questionHistory||[];
  if(run)task={id:task.id,...run};
  const runId = run?.runId || currentActivityRunId(task);
  if (!runId) return null;
  const live = !historical&&task.state === 'running';
  const collapsed=historical||['review','completed'].includes(task.state);
  const answered = !!task.question?.id&&questions.some(question=>question.id===task.question.id&&question.answer?.text);
  const waiting = task.state === 'waiting_input'&&!answered;
  // A reviewed answer can still hand off at an approval boundary. It does not
  // verify all actions or recover earlier failures merely by being delivered.
  const verified=['review','completed'].includes(task.state)&&task.resultReview?.runId===runId&&task.resultReview.status==='ready'&&!!task.resultReview.checks?.length&&task.resultReview.checks.every(check=>check.state==='supported');
  // The previous run's plan/trace must never appear as this run's progress.
  // Analysis workers are presented once, in the analysis history section with their roles, ranges and outcomes; the
  // run's trace keeps the leader's own steps (as the Workbench did before the per-run activity, 2026-10-07).
  const trace = normalizeTrace((task.trace || []).filter(event => (event.runId === runId || event.id?.startsWith(runId + ':')) && !isAnalysisStep(event)), traceOptions).map(event => {
    if(answered&&event.tool==='ask_user'&&event.status==='waiting')return {...event,status:'done'};
    // A stopped actor is not a running tool. Unsettled operations remain pending,
    // never become completed/cancelled just because the actor stopped.
    if (!live && !isAnalysisStep(event) && ['queued','running'].includes(event.status)) {
      return {...event,status:'waiting',label:`${toolLabels[event.tool]} 결과 확인 대기`};
    }
    // The plan above already names these phases; do not repeat its heading inside each operation.
    const visibleEvent=task.workPlan?.runId===runId?{...event,planStep:undefined}:event;
    return ['personal_mail_query','read_personal_mail','ask_openwiki'].includes(event.tool) ? {...visibleEvent,label:toolLabels[event.tool]} : visibleEvent;
  });
  const plan = task.workPlan?.runId === runId ? task.workPlan : null;
  const updates = plan?.updates || [];
  const currentPlan = plan ? {...plan, updates:updates.some(update => update.runId) ? updates.filter(update => update.runId === runId) : updates} : null;
  const idleLabel = task.context?.phase === 'summarizing' ? '이전 대화를 정리하고 있어요'
    : task.replyRegeneration?.state === 'running' ? '답변을 다시 작성하고 있어요'
    : task.checkpoint?.phase === 'planning' ? '작업 계획을 세우고 있어요' : '모델 응답을 기다리고 있어요';
  const currentStep=trace.findLast(event=>event.status==='running'&&event.tool!=='update_plan'&&event.tool!=='progress_note');
  const needsAttention=trace.some(event=>['error','waiting','cancelled'].includes(event.status));
  const summaryTitle=live?(currentStep?.label||toolLabels[currentStep?.tool]||idleLabel):waiting?'확인 대기':'진행 기록';
  if (!currentPlan?.steps?.length && !trace.length && !live) return null;
  return <section className="nubi-agent-activity" data-run-id={runId} data-historical={historical||undefined} aria-label="계획과 진행 상황" aria-busy={live}>
    {currentPlan?.steps?.length > 0 && <WorkspacePlan task={{...task,workPlan:currentPlan}} historical={historical} answered={answered} trace={trace.map(event => ({...event,label:event.label || toolLabels[event.tool]}))}/>}
    <AgentTrace compactStatuses summaryTitle={summaryTitle} summaryAside={live?<ResponseTime timing={task.responseTiming} label="" live/>:null} key={`${runId}:${collapsed?'result':'active'}:${needsAttention?'attention':'normal'}`} steps={trace} traceOptions={traceOptions} live={live} question={task.question}
      preserveNotes preserveCompleted defaultExpanded={!collapsed&&needsAttention} completed={verified} verified={verified} awaitingUser={waiting} stopped={['paused','interrupted','cancelled','failed'].includes(task.state)} idleLabel={idleLabel}/>
  </section>;
}
