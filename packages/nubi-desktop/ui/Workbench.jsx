import {WorkspaceUpdate,WorkspaceUpdateProgress,useWorkspaceUpdate} from './WorkspaceUpdate.jsx';
import {DESKTOP_PROVIDER_LABELS} from './provider-labels.mjs';
import {ClaudeConnection,ClaudeAccountUsage} from './ClaudeConnection.jsx';
import {OutgoingMessages,useOutgoingMessages,deliveryRecorded} from './OutgoingMessages.jsx';
import {welcomeGreeting} from './welcome-greetings.mjs';
import {submitTaskMessage} from './submit-task-message.mjs';
import {ConversationSearch} from './ConversationSearch.jsx';
import {mailSearchDraft} from './mail-search-draft.mjs';
import {AnswerSources} from './AnswerSources.jsx';
import {AnalysisHistory} from './AnalysisHistory.jsx';
import {AGENT_COMMANDS,desktopSkillCommand} from '../runtime/agent-commands.mjs';
import {MessageTimestamp} from './MessageTimestamp.jsx';
import {UsagePanel} from '../../../extensions/aipro-chat/src/UsagePanel.jsx';
import {ResponseTime} from './ResponseTime.jsx';
import {MailHistory} from './MailHistory.jsx';
import {AppliedFileChanges} from './AppliedFileChanges.jsx';
import {MailEvidenceChips,useMailDraftReferences,appendMailReferences,removeMailReference} from './MailEvidence.jsx';
import {WorkspaceInputs} from './WorkspaceInputs.jsx';
import {WorkspaceActivity} from './WorkspaceActivity.jsx';
import {conversationActivity} from './conversation-activity.mjs';
import {MailLibrary} from './MailLibrary.jsx';


import {incomingRequests,badgeText} from './agent-connections.mjs';
import {useComposerDraft} from './useComposerDraft.js';
import {SessionSidebar} from './SessionSidebar.jsx';
import {WorkspaceIconAction} from './WorkspaceIconAction.jsx';
import {WorkspaceToolbar} from './WorkspaceToolbar.jsx';
import {DriftLabel} from './DriftLabel.jsx';
import {WorkspaceNavigation} from './WorkspaceNavigation.jsx';
import {GhesAccount} from './GhesAccount.jsx';
import {marketplaceAuthenticationErrors} from './CompanySkillSignIn.jsx';
import {ghesMessages} from './ghes-account-state.mjs';
import {providerLoginError,providerLoginDiagnostics} from './provider-login-state.mjs';
import {closeSession, openSession, restoreSessionNavigation, saveSessionNavigation} from './session-navigation.mjs';
import {flushSync} from 'react-dom';
import {SkillManager} from './SkillManager.jsx';
import {SkillLibrary} from './SkillLibrary.jsx';
import {SkillRegistration} from './SkillRegistration.jsx';
import {ComputerConnectionForm} from './ComputerConnectionForm.jsx';
import {ComputerUse} from './ComputerUse.jsx';
import {SetupActions} from './SetupActions.jsx';
import {DecisionPrompt} from './DecisionPrompt.jsx';
import {ProjectStart} from './ProjectStart.jsx';
import {WikiInitializationProgress} from './WikiInitializationProgress.jsx';
import {TerminalBlock} from './TerminalBlock.jsx';
import {WindowMark,TerminalMark,RecoveryStatus} from './marks.jsx';
import {ApprovalModeControl} from './ApprovalMode.jsx';
import {WORKSPACE_LAYOUT} from '../electron-app/workspace-layout.cjs';
import {ApprovalBar} from './ApprovalBar.jsx';
import React, {useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo} from 'react';
import {CxButton, CxInput, CxNotice, CxCheckbox, DetailPanel, SearchInput, Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {AgentMark, NubiLogo} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {NubiLogin} from '../../../extensions/aipro-chat/src/NubiSurfaces.jsx';
import {WorkspaceComposer} from './WorkspaceComposer.jsx';
import {teamWorkspaceErrors} from './teamWorkspaceErrors.js';
import {useConversationScroll} from './useConversationScroll.js';
import {useSidebarResize} from './useSidebarResize.js';
import {DeckDisclosure, DeckStatus, DeckEmpty} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {Welcome} from '../../../extensions/aipro-chat/src/Welcome.jsx';
import {AmbientScene, useIdleExpression, useMotionPreference} from '../../../extensions/aipro-chat/src/Atmosphere.jsx';
import {ContextMeter, ModelPicker, ModelSelection, ProviderIcon} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {workspaceContextMeterInfo} from './context-gauge.mjs';
import {FabrixConnection} from '../../../extensions/aipro-chat/src/FabrixConnection.jsx';
import {QuestionDecision} from './QuestionDecision.jsx';
import {qualityLabel} from '../runtime/quality-status.mjs';
import {WikiEvidence} from './WikiEvidence.jsx';
import {GitEmptyState} from './GitEmptyState.jsx';
import {WikiUpdate} from './WikiUpdate.jsx';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {WorkspaceSkillMenu} from './WorkspaceSkillMenu.jsx';
import {WorkspaceToast, notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {ReasoningPicker} from './ReasoningPicker.jsx';

// After the user applies the last proposal, the task continues once, unless a command waits for its approval:
// a check proposed with its fix runs when the user approves it (2026-09-30).
const AUTO_STEPS=8;
// The shared ContextMeter also estimates a draft; the composer gauge shows the task's latest answer instead.
const NO_MESSAGES=[],NO_PROMPT={};
const showNotice=message=>notifyWorkspaceToast(message,{success:true});
const showError=message=>notifyWorkspaceToast(message,{error:true});
const providerLabels=DESKTOP_PROVIDER_LABELS;
function modelDisplayName(message, provider) {
  const id = message?.modelId || message?.model || provider?.model;
  const catalog = (provider?.models || []).find(item => item.id === id || item.name === id);
  return message?.modelName || catalog?.label || catalog?.displayName || catalog?.name || id || providerLabels[provider?.provider] || '모델';
}

function ConversationMessages({messages,task,provider,beforeMessage,afterMessage,questionMessage,questionControl,onRegenerate,onSource,regenerateDisabled=false}) {
  const resting = useIdleExpression(task?.state === 'running' || task?.state === 'waiting_input');
  return messages.map((message,index)=>{
    const content=message.displayContent||message.content||'',modelName=modelDisplayName(message,provider);
    const assistant = message.role === 'assistant';
    const latest = assistant && message === task?.messages?.at(-1);
    // A run can also contain questions or interim messages. Its final duration
    // belongs only to the last answer, never to every message from that run.
    const timing = message.responseTiming || (latest && !message.questionId && message.runId && task?.responseTiming?.runId === message.runId && task.responseTiming.state === 'completed' ? task.responseTiming : null);
    const at = assistant ? timing?.finishedAt || message.at : message.sentAt || message.at;
    const regenerating = latest && task?.replyRegeneration?.state === 'running';
    const canRegenerate = latest && onRegenerate && task.state === 'review';
    const markMood = regenerating || message.state === 'pending' ? 'working' : message.error === 'cancelled' ? 'still' : message.error ? 'sad' : resting;
    const body=message===questionMessage?questionControl:<MessageBody role={message.role} content={content} sourceReferences={message.sourceReferences} onSource={source=>onSource?.(source,message)}/>;
    return <React.Fragment key={message.id||message.inputId||index}>
      {beforeMessage?.(message)}
      <article className={`message message-${message.role} nubi-message ${message.role}`} aria-label={assistant?`${modelName} 답변`:'내 메시지'}>
        {assistant&&<div className="answer-model" title={modelName}><AgentMark size={26} className="nubi-answer-mark" mood={markMood} lively={markMood!=='still'}/><span>{modelName}</span></div>}
        {assistant?body:<div className="nubi-user-bubble">{body}<MailEvidenceChips references={message.mailReferences} onOpen={source=>onSource?.({...source,kind:'mail'},message)}/></div>}
        {content&&<div className="message-actions">
          <MessageTimestamp at={at} role={message.role}/>
          <CopyButton text={content} label={`${assistant?'답변':'내'} 메시지 복사`} successMessage="메시지를 복사했습니다."/>
          {assistant&&<ResponseTime timing={timing} label=""/>}
          {canRegenerate&&<ActionButton action="refresh" iconOnly label="다시 응답 받기" title="다시 응답 받기" busy={regenerating} disabled={regenerateDisabled} onClick={()=>onRegenerate(message)}/>}
        </div>}
        {assistant&&<AnswerSources message={message} onOpen={source=>onSource?.(source,message)}/>}
      </article>
      {afterMessage?.(message)}
    </React.Fragment>;
  });
}
export const waitingOn=(state,taskId)=>[...(state.proposals||[]),...(state.setupActions||[]),...(state.commandRepairs||[])].some(item=>item.taskId===taskId&&item.state==='proposed');
const errors = {claude_models_unavailable:'Claude 모델 목록을 받지 못했어요. 다시 연결해 주세요.',claude_cli_missing:'Claude Code를 먼저 설치해 주세요.',claude_cli_update:'Claude Code를 업데이트해 주세요.',claude_login_required:'Claude Code에서 로그인한 뒤 다시 연결해 주세요.',claude_cli_failed:'Claude Code 실행을 완료하지 못했어요. 로그인과 연결을 확인해 주세요.',claude_cli_timeout:'Claude Code 응답이 늦어 중지했어요. 기록은 보존했습니다.',claude_response_invalid:'Claude 응답 형식을 확인하지 못했어요. 기록은 보존했습니다.',clone_root_mismatch:'복제한 저장소의 경로가 달라요. 프로젝트 폴더를 확인해 주세요.',project_active:'다른 프로젝트로 이동한 뒤 목록에서 제거해 주세요.',project_changed:'프로젝트가 바뀌었어요. 현재 대화에서 출처를 다시 열어 주세요.',project_catalog_unavailable:'프로젝트 목록을 저장하거나 읽지 못했어요. 저장 위치의 권한을 확인해 주세요.',project_name_invalid:'프로젝트 이름을 80자 이내로 입력해 주세요.',answer_source_changed:'답변 이후 원문이 바뀌었어요. 다시 검색해 주세요.',mail_attachment_beta_disabled:'Beta에서는 첨부 다운로드만 지원해요. 메일 본문으로 질문해 주세요.',mail_source_changed:'답변 이후 메일이나 첨부가 바뀌었어요. 다시 검색해 주세요.',skill_command_missing:'일치하는 명령이나 스킬이 없어요. /를 입력해 목록에서 선택해 주세요.',skill_command_ambiguous:'이름이 같은 스킬이 있어요. 스킬 관리에서 이름을 구분해 주세요.',agent_command_ui_only:'입력창에서 /를 입력해 해당 메뉴를 열어 주세요.',invalid_model:'선택한 모델로 요청하지 못했어요. 모델 목록을 새로고침한 뒤 다시 선택해 주세요.',request_rejected:'모델이 요청 설정을 거절했어요. 모델과 추론 정도를 확인해 주세요.',request_format:'모델이 요청 형식을 받지 못했어요. 대화 기록은 보존했습니다.',request_endpoint:'모델 서버의 요청 주소를 확인할 수 없어요.',agent_input_closed:'지금은 메시지를 반영할 수 없어요. 초안은 보존했습니다.',agent_input_changed:'대기 메시지가 바뀌었어요. 현재 목록을 확인해 주세요.',agent_input_full:'대기 메시지는 20개까지 넣을 수 있어요.',agent_input_invalid:'메시지를 16,000자 이내로 입력해 주세요.',setup_waiting_for_proposals:'수정안을 먼저 반영해 주세요. 반영하면 이 명령을 실행할 수 있어요.',process_running:'명령이 실행 중인 대화는 끝난 뒤 삭제해 주세요.',worktree_remove_failed:'대화의 작업 폴더를 지우지 못했어요. 그 폴더를 연 창이나 터미널을 닫고 다시 삭제해 주세요.',remote_invalid:'https://, ssh:// 또는 git@ 주소를 넣어 주세요.',project_picker_unavailable:'폴더 선택 창을 열지 못했어요. 앱을 다시 시작한 뒤 다시 눌러 주세요.',project_path_missing:'폴더를 찾지 못했어요. 경로를 확인하고 다시 열어 주세요.',project_path_denied:'이 폴더를 읽을 권한이 없어요. 권한이 있는 폴더를 열어 주세요.',not_git_repository:'Git 저장소가 아닌 폴더예요. Git으로 관리하는 프로젝트 폴더를 골라 주세요.',git_unavailable:'Git을 찾지 못했어요. Git을 설치한 뒤 프로젝트를 다시 열어 주세요.',git_unsafe_directory:'Git이 이 폴더의 소유자를 확인할 수 없어 막았어요. 터미널에서 git config --global --add safe.directory <폴더 경로>를 실행한 뒤 다시 열어 주세요.',git_timeout:'Git이 응답하지 않았어요. 잠시 뒤 다시 열어 주세요.',workspace_untrusted:'신뢰한 폴더만 열 수 있어요. 신뢰 확인 창에서 "Yes, I trust the authors"를 눌러 주세요.',work_plan_invalid:'AI가 작업 계획 형식을 맞추지 못했어요. 기록은 보존됐으며 ‘이어서 진행’으로 다시 시도할 수 있어요.',goal_review_failed:'요구사항과 결과를 끝까지 대조하지 못했어요. 기록을 확인하고 이어갈 수 있어요.',elevation_approval_required:'관리자 권한 실행을 별도로 승인해 주세요.',elevation_unavailable:'관리자 실행은 Windows PowerShell에서 지원합니다.',elevation_command_limit:'관리자 명령을 3000자 이내의 짧은 작업으로 나누고 권한이 필요한 이유를 적어 주세요.',context_input_too_large:'현재 모델의 문맥 한도를 넘었어요. 대화는 보존했습니다. 더 큰 문맥을 지원하는 모델로 이어가 주세요.',context_compaction_failed:'대화를 정리하지 못했어요. 원문은 보존했습니다. 다시 이어갈 수 있어요.',context_history_changed:'대화가 바뀌어 요약을 저장하지 않았어요. 현재 대화로 다시 이어가 주세요.',file_exists:'같은 이름의 파일이 생겼어요. 현재 파일을 읽고 새 제안을 만들어 주세요.',parent_missing:'저장할 폴더가 없어요. 폴더 생성부터 승인해 주세요.',project_rules_changed:'프로젝트 규칙이 바뀌었어요. 규칙과 변경 계획을 다시 확인해 주세요.',rules_unavailable:'프로젝트 규칙을 읽지 못했어요. 파일 경로와 권한을 확인해 주세요.',proposal_missing:'변경 제안이 더 이상 없어요. 목록을 새로고침해 주세요.',zip_limit:'ZIP이 너무 커요. 파일당 16 MB, 전체 256 MB까지 가져올 수 있어요.',provider_changed:'모델 연결이 바뀌었어요. 모델을 다시 고른 뒤 시도해 주세요.',process_missing:'명령 기록을 찾을 수 없어요. 이미 끝났거나 지워졌어요.',setup_changed:'근거 파일이나 제안이 바뀌었어요. 현재 내용으로 다시 준비해 주세요.',setup_cancelled:'중지한 작업입니다. 실행할 내용을 다시 확인해 주세요.',setup_execution_unconfirmed:'실행 상태를 확인해 주세요. 같은 명령을 반복하지 않습니다.',agent_busy:'AI가 다른 작업을 확인하고 있어요. 입력한 내용은 보관했어요.',proposal_invalid_syntax:'수정안에 새 문법 오류가 있어요. 오류를 고친 뒤 다시 제안해 주세요.',quality_unavailable:'문법 검사를 마치지 못했어요. 변경안은 보존했습니다.',search_unavailable:'검색 실행기를 찾지 못했어요. 설치 상태를 확인해 주세요.',wiki_evidence_stale:'위키 근거가 바뀌었어요. 현재 문서와 코드를 다시 확인해 주세요.',wiki_evidence_required:'변경 계획에 쓸 위키 근거를 다시 찾아 주세요.',tool_unsettled:'이전 도구의 결과를 기다리고 있어요. 중복 실행은 막았습니다.',recovery_changed:'현재 작업 상태를 다시 확인해 주세요.',model_timeout:'모델 응답이 없어 진행 기록을 보존했어요.',network:'모델 연결이 끊겼어요. 진행 기록부터 이어갈 수 있어요.',rate_limited:'모델 사용량 제한에 도달했어요. 잠시 후 이어갈 수 있어요.',unauthorized:'모델을 다시 연결한 뒤 이어가 주세요.',question_pending:'먼저 확인 질문에 답해 주세요.',question_changed:'질문 상태가 바뀌었어요. 현재 질문을 다시 확인해 주세요.',project_locked:'다른 누비 창에서 사용 중이에요. 해당 창에서 이어가 주세요.',source_read_required:'수정할 구간을 다시 읽어야 해요.',applied_changed:'반영 후 파일이 바뀌었어요. 현재 파일로 새 제안을 만들어 주세요.',knowledge_busy:'위키 기록을 저장하고 있어요. 잠시 후 다시 확인해 주세요.',editor_dirty:'저장하지 않은 수정이 있어요. 파일을 먼저 확인해 주세요.',source_stale:'제안을 만든 뒤 파일이 바뀌었어요. 현재 내용과 다시 비교해 주세요.',provider_missing:'먼저 로그인하면 분석을 시작할 수 있어요.',project_busy:'진행 중인 작업을 마친 뒤 프로젝트를 바꿔 주세요.',preview_scope:'이 버전은 localhost 화면만 비교할 수 있어요.',preview_http_error:'비교할 화면을 열지 못했어요. 서버 주소와 실행 상태를 확인해 주세요.',command_invalid:'실행할 명령을 입력해 주세요.',shell_unavailable:'선택한 셸을 찾을 수 없어요. 설치 상태를 확인하고 다시 선택해 주세요.',agent_failed:'모델 요청을 완료하지 못했어요. 연결을 확인한 뒤 다시 시작해 주세요.',host_disconnected:'실행기 연결이 종료됐어요. 앱을 다시 열어 작업 기록을 확인해 주세요.',write_unconfirmed:'저장 결과가 제안과 다릅니다. 실제 파일을 확인해 주세요.',operation_failed:'작업을 완료하지 못했어요. 입력과 실행 환경을 확인해 주세요.'};
// A code without its own message is shown with the code, not as advice to check input and connection.
const failure=(error,lead='요청을 처리하지 못했어요. 다시 시도해 주세요.')=>teamWorkspaceErrors[error?.message]||errors[error?.message]||lead+(/^[a-z][a-z0-9_]{2,60}$/.test(error?.message||'')?` 오류 코드: ${error.message}`:'');
// The task a first opened project starts with.
const OPENED_BY_BUTTON='nubi-workspace-opened-by-button';
Object.assign(errors,{answer_changed:'대화가 바뀌었어요. 마지막 답변에서 다시 눌러 주세요.',approval_pending:'진행 중인 작업과 변경 확인을 마친 뒤 다시 응답받을 수 있어요.'});
Object.assign(errors,{mail_reference_limit:'메일 근거는 20개까지 연결할 수 있어요. 일부를 제거해 주세요.',mail_input_invalid:'연결한 메일 근거를 다시 선택해 주세요.'});
const ENVIRONMENT_REQUEST='처음 연 프로젝트예요. 실행 환경(매니페스트, 잠금 파일, README, 설정 파일)을 확인하고, 필요한 의존성 설치와 빌드, 테스트를 하나씩 제안해 줘. 설치와 실행은 승인받은 뒤에만 해 줘.';
// The window reloads when a folder opens, so the button leaves a short-lived mark in storage.
const markOpened=()=>{try{localStorage.setItem(OPENED_BY_BUTTON,String(Date.now()));}catch{/* Only the environment task depends on it. */}};
const openedByButton=()=>{try{const at=Number(localStorage.getItem(OPENED_BY_BUTTON));localStorage.removeItem(OPENED_BY_BUTTON);return at>0&&Date.now()-at<120000;}catch{return false;}};
const stateLabel = {creating:'저장 확인 중',attention:'저장 확인 필요',conflicted:'기존 파일 확인 필요',checking:'실행 전 확인',paused:'복구 대기',timed_out:'시간 제한으로 중단',draft:'준비됨',ready:'작업 공간 준비됨',running:'진행 중',stopping:'중지 중',completed:'실행 종료',review:'결과 검토',waiting_input:'답변 대기',failed:'확인 필요',cancelled:'중지됨',interrupted:'중단된 작업',proposed:'검토 대기',applied:'반영됨'};
export function Workbench({api,installUpdate,showAnalysisHistory=false,projects=[],switchProject,renameProject,removeProject,openCurrent,startConversation,chooseFolder,activeView,activeFile,wikiInitialization,openMailDocument,openMailSources,closeMailDocument,importProject,cloneRepository,workspaceView,hostLayout,toolbarHost,onMinimumAgentWidth,connectMarketplace,openTeamWorkspace,ghesAccount,ghesUpdate,ghesRepositories,openPath,review,apply,openURI,openBrowser,openWebPage,toastHost=true,startupRequest,onStartupHandled,mailDraftRequest,onMailDraftHandled}) {
  const workspaceUpdate=useWorkspaceUpdate(api,installUpdate);
  const [mailPage,setMailPage]=useState(false);
  const [projectPicker,setProjectPicker]=useState(false);
  const [skillImportBusy,setSkillImportBusy]=useState(false),skillRegistrationOrigin=useRef(null);
  const [accountRevision,setAccountRevision]=useState(0),[accountOpen,setAccountOpen]=useState(false),[accountLoginRequest,setAccountLoginRequest]=useState(0),accountButton=useRef(null),pendingMarketplace=useRef(null);
  const [skillTab,setSkillTab]=useState('installed'),[skillsPage,setSkillsPage]=useState(false),[skillRevision,setSkillRevision]=useState(0);const skillsButton=useRef(null),skillsPanelTrigger=useRef(null);
  function registerSkill(){
    if(actionLock.current||skillImportBusy)return;
    skillRegistrationOrigin.current={panel:panel==='skills'?'skills':null,trigger:document.activeElement};
    setPanel('skill-import');
  }
  function closeSkillRegistration(){
    if(skillImportBusy)return;
    const origin=skillRegistrationOrigin.current;skillRegistrationOrigin.current=null;
    setSkillTab('installed');setPanel(origin?.panel||null);
    requestAnimationFrame(()=>{const target=origin?.trigger?.isConnected?origin.trigger:document.querySelector('.nubi-custom-skill-register');target?.focus({preventScroll:true});});
  }
  function skillRegistered(){
    setSkillRevision(value=>value+1);
    const origin=skillRegistrationOrigin.current;skillRegistrationOrigin.current=null;
    setSkillTab('installed');setPanel(origin?.panel||null);
    requestAnimationFrame(()=>document.querySelector('.nubi-custom-skill-register')?.focus({preventScroll:true}));
  }
  const [project,setProject]=useState(null),[taskId,setTaskId]=useState(null),[environmentPending,setEnvironmentPending]=useState(false);
  function startCompanySignIn(){
    flushSync(()=>{setPanel(null);setAccountOpen(true);setAccountLoginRequest(value=>value+1);});
  }
  function restoreMarketplacePanel(pending){
    if(!pending||pending.projectId!==project?.projectId||pending.taskId!==taskId||pending.skillsPage!==skillsPage||mailPage)return;
    if(pending.panel==='skills'){setSkillTab(pending.skillTab);setPanel('skills');}
  }
  async function connectCompanyMarketplace({interactive=true}={}){
    try{const result=await connectMarketplace();if(!result?.loginRequired)return result;}
    catch(error){if(!interactive||!marketplaceAuthenticationErrors.has(error.message))throw error;}
    if(!interactive)return {loginRequired:true};
    pendingMarketplace.current={projectId:project?.projectId,taskId,panel:panel==='skills'?'skills':null,skillTab:'marketplace',skillsPage};
    startCompanySignIn();return {cancelled:true};
  }
  async function accountConnected(){
    setAccountRevision(value=>value+1);
    const pending=pendingMarketplace.current;pendingMarketplace.current=null;
    if(pending&&pending.projectId===project?.projectId){
      try{const result=await connectMarketplace();if(result?.loginRequired)throw Error('ghes_login_required');}
      catch(error){showError(ghesMessages[error.message]||'스킬 연결을 다시 확인해 주세요.');}
      setSkillRevision(value=>value+1);restoreMarketplacePanel(pending);
    }
    setAccountOpen(false);
  }
  function cancelCompanyConnection(){setAccountRevision(value=>value+1);const pending=pendingMarketplace.current;pendingMarketplace.current=null;restoreMarketplacePanel(pending);setAccountOpen(false);}
  function enterTeamWorkspace(){panelOrigin.current=null;setPanel(null);setMailPage(false);setSkillTab('marketplace');setSkillsPage(true);if(activeView)void workspaceView?.(null);if(compact)setSidebarOpen(false);}
  const [openTabs,setOpenTabs]=useState([]),[tabsProject,setTabsProject]=useState(null);
  const [minimumAgentWidth,setMinimumAgentWidth]=useState(WORKSPACE_LAYOUT.minimumAgent);
  const railWidth=hostLayout==='integrated'&&workspaceView?WORKSPACE_LAYOUT.rail:0;
  const sidebarBreakpoint=hostLayout==='integrated'?railWidth+WORKSPACE_LAYOUT.minimumProjects+minimumAgentWidth:900;
  const workbenchNode=useRef(null),[hostWidth,setHostWidth]=useState(window.innerWidth);
  const compact=hostWidth<sidebarBreakpoint;
  const [sidebarOpen,setSidebarOpen]=useState(()=>window.innerWidth>sidebarBreakpoint);
  const resizeSidebar=!!project&&sidebarOpen&&!compact;
  const sidebarResize=useSidebarResize(workbenchNode,{hostWidth,railWidth,reservedWidth:compact?0:minimumAgentWidth,enabled:resizeSidebar,defaultWidth:WORKSPACE_LAYOUT.projects,minWidth:WORKSPACE_LAYOUT.minimumProjects});
  useLayoutEffect(()=>{onMinimumAgentWidth?.(minimumAgentWidth);},[minimumAgentWidth,onMinimumAgentWidth]);
  const [request,setRequest,readDraft,moveDraft]=useComposerDraft(project?.projectId,taskId);
  const [mailReferences,setMailReferences,readMailReferences,moveMailDraft]=useMailDraftReferences(project?.projectId,taskId);
  const projectRefForSubmit=useRef(project?.projectId);projectRefForSubmit.current=project?.projectId;
  const draftScope=useRef(null);draftScope.current=JSON.stringify([project?.projectId,taskId]);
  const [inputBusy,setInputBusy]=useState(false),inputLock=useRef(false),inputAttempt=useRef(null),draftLatest=useRef('');draftLatest.current=request;
  const historyTrigger=useRef(null);
  const [outgoing,setOutgoing]=useOutgoingMessages();
  const visibleOutgoing=outgoing.filter(item=>item.projectId===project?.projectId&&item.taskId===(taskId??null)&&!projectPicker);
  const sendingOutgoing=visibleOutgoing.find(item=>item.phase!=='unconfirmed');
  useEffect(()=>{if(!project)return;setOutgoing(items=>{const next=items.filter(item=>item.projectId!==project.projectId||!deliveryRecorded(item,project.tasks?.find(task=>task.id===item.taskId)));return next.length===items.length?items:next;});},[project,setOutgoing]);
  const dismissOutgoing=id=>setOutgoing(items=>items.filter(item=>item.id!==id));
  const [submitting,setSubmitting]=useState(false),submitLock=useRef(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[panel,setPanel]=useState(null);
  const [claudeChecking,setClaudeChecking]=useState(false),[claudeIssue,setClaudeIssue]=useState(null);
  const usageButton=useRef(null),usageRead=useRef(0),usageAccountPending=useRef(null);
  const [usageData,setUsageData]=useState({auth:{provider:'aipro',present:false},connections:{}});
  const loadAccountUsage=useCallback(async({force,signal})=>{
    const revision=++usageRead.current;usageAccountPending.current=revision;
    try {const data=await api('usage',{action:'account',force});if(!signal.aborted&&revision===usageRead.current)setUsageData(data);}
    catch {if(!signal.aborted&&revision===usageRead.current)setUsageData(data=>({...data,accountUsage:{...data.accountUsage,error:'quota_unavailable'}}));}
    finally {if(usageAccountPending.current===revision)usageAccountPending.current=null;}
  },[api]);
  useEffect(()=>{
    if(panel!=='usage')return;
    let alive=true,pending=false;
    const read=async()=>{if(pending||document.hidden||usageAccountPending.current!==null)return;pending=true;const revision=++usageRead.current;
      try {const data=await api('usage');if(alive&&revision===usageRead.current)setUsageData(data);}
      catch {if(alive&&revision===usageRead.current)setUsageData(data=>({...data,usageError:'usage_unavailable'}));}
      finally {pending=false;}
    };
    void read();const timer=setInterval(read,2000);
    return()=>{alive=false;usageRead.current++;usageAccountPending.current=null;clearInterval(timer);};
  },[panel,api]);
  useEffect(()=>window.nubi?.onBrowserEvent?.(event=>{if(event.type==='opened'){panelOrigin.current=null;setPanel(null);setAccountOpen(false);}}),[]);
  const [nativeChanges,setNativeChanges]=useState(null),[nativePatch,setNativePatch]=useState(null);
  async function openWorkspaceView(view){const result=await workspaceView(view);if(result?.changes){setNativeChanges(result.changes);setNativePatch(null);setPanel('changes');}}
  const [catalogLoading,setCatalogLoading]=useState(null),catalogRequests=useRef(new Map()),providerRevision=useRef(0);
  const [provider,setProvider]=useState(null),[query,setQuery]=useState(''),[search,setSearch]=useState(null),[wikiSearch,setWikiSearch]=useState(null),[processResult,setProcessResult]=useState(null);
  const loginErrorToast=useRef('');
  useEffect(()=>{
    const message=providerLoginError(provider);
    if(!message){loginErrorToast.current='';return;}
    const key=`${provider?.persistenceError||provider?.loginError}:${provider?.loginDiagnostics?.at(-1)?.at||''}`;
    if(loginErrorToast.current===key)return;
    loginErrorToast.current=key;showError(message);
  },[provider?.loginError,provider?.persistenceError,provider?.loginDiagnostics]);
  const [script,setScript]=useState(''),[shell,setShell]=useState(''),[beforeUrl,setBeforeUrl]=useState(''),[afterUrl,setAfterUrl]=useState(''),[comparison,setComparison]=useState(null),[overlay,setOverlay]=useState(false);
  const [knowledge,setKnowledge]=useState(null),[timeoutSeconds,setTimeoutSeconds]=useState(0),[autoDiagnose,setAutoDiagnose]=useState(true);
  const [answer,setAnswer]=useState(''),[welcomeAnimated,setWelcomeAnimated]=useState(false);
  const [approval,setApproval]=useState({mode:'ask',allowedCommands:[]});
  const motion=useMotionPreference(),resting=useIdleExpression(busy||!!provider?.pending||taskId!==null);
  const [greeting,setGreeting]=useState(()=>welcomeGreeting());
  const intro={title:hostLayout==='integrated'?'모델을 연결해 시작하세요.':greeting,description:null};
  const modelData={activeProvider:provider?.provider||'aipro',settings:{modelId:provider?.model||''},catalog:{models:(provider?.models||[]).map(m=>({...m,name:m.id,displayName:m.label||m.id})),diagnostics:provider?.modelCatalog?.diagnostics},connections:Object.fromEntries((provider?.providers||[]).map(p=>[p.id,{present:p.connected,receivedAt:p.connectionId||0}])),pending:provider?.pending?{provider:provider.pending,phase:provider.pendingPhase||'waiting'}:null,report:{provider:provider?.provider,error:provider?.loginError}};
  const fabrixRpc=useCallback((method,args)=>api('fabrix',{method,...args}),[api]);
  const panelOrigin=useRef(null),modelTrigger=useRef(null),mailButton=useRef(null);
  const shownWikiJob=useRef(null);
  useEffect(()=>{if(['running','attention'].includes(wikiInitialization?.state)&&wikiInitialization.id&&shownWikiJob.current!==wikiInitialization.id&&(!panel||panel==='wiki-progress')){shownWikiJob.current=wikiInitialization.id;setPanel('wiki-progress');}},[wikiInitialization?.id,wikiInitialization?.state,panel]);
  function openModels(){modelTrigger.current=document.activeElement;setPanel('models');}
  function openMailConnection(){panelOrigin.current=null;setPanel('mail');}
  useEffect(()=>{if(!startupRequest)return;if(startupRequest.target==='mail')openMailConnection();else openModels();onStartupHandled?.();},[startupRequest]);
  function closeModels(){setPanel(null);requestAnimationFrame(()=>{(modelTrigger.current?.isConnected?modelTrigger.current:composer.current)?.focus();});}
  function closePanel(trigger){setPanel(null);requestAnimationFrame(()=>trigger.current?.focus());}
  function openChildPanel(next){panelOrigin.current={panel,trigger:document.activeElement};setPanel(next);}
  function returnToPanel(){const origin=panelOrigin.current;panelOrigin.current=null;setPanel(origin?.panel||null);requestAnimationFrame(()=>{const name=origin?.trigger?.getAttribute('data-panel-link');if(name)document.querySelector(`[data-panel-link="${name}"]`)?.focus();});}
  const panelBack=panelOrigin.current?<div className="nubi-panel-navigation"><ActionButton action="back" className="nubi-panel-back" label={`${panelOrigin.current?.panel==='settings'?'설정으로':'프로젝트 자료로'} 돌아가기`} onClick={returnToPanel}/></div>:null;
  const searchRun=useRef(0),libraryButton=useRef(null),appButton=useRef(null),settingsButton=useRef(null),agentButton=useRef(null),composer=useRef(null),mounted=useRef(true),polling=useRef(false),actionLock=useRef(false),autoTried=useRef(new Set()),autoSteps=useRef(new Map()),taskErrorToast=useRef('');
  const task=projectPicker?null:project?.tasks?.find(t=>t.id===taskId), proposals=project?.proposals?.filter(p=>p.taskId===taskId&&p.state!=='superseded')||[];
  const pendingProposals=proposals.filter(item=>item.state!=='applied'),appliedProposals=proposals.filter(item=>item.state==='applied');
  const effectiveShell=project?.profiles?.some(p=>p.id===shell)?shell:project?.defaultShell||project?.profiles?.[0]?.id||'';
  const connectionRequest=DESKTOP_FEATURES.computerUse&&['pending','connected'].includes(task?.computerConnectionRequest?.state)?task.computerConnectionRequest:null;
  const running=task?.state==='running',activeTask=project?.tasks?.find(t=>t.state==='running');
  const latestUserMessage=task?.messages?.findLast(message=>message.role==='user');
  // Keep inbox admissions and all following replies at the transcript foot.
  // A consumed steering row stays where its pending message was shown.
  const inboxTurnStart=task?.messages?.findIndex(message=>message.inputId)??-1;
  const historyMessages=inboxTurnStart<0?task?.messages||[]:task.messages.slice(0,inboxTurnStart);
  const inboxMessages=inboxTurnStart<0?[]:task.messages.slice(inboxTurnStart);
  const activityLayout=conversationActivity(task),activityRunId=activityLayout.runId,activityAnswer=activityLayout.anchor;
  // The analysis history (document and role analyses with ranges, partial outcomes and unread ranges) follows the current
  // run's activity; the per-run refactor of 2026-10-04 had dropped it although the runtime still records it.
  const activity=task?<><WorkspaceActivity key={activityRunId||task.id} task={task}/><AnalysisHistory key={`analysis:${task.id}`} api={api} task={task} showHistory={showAnalysisHistory}/></>:null;
  const historicalActivity=run=><WorkspaceActivity key={run.runId} task={task} run={run} historical/>;
  const beforeActivityAnswer=message=><>{activityLayout.before.get(message)?.map(historicalActivity)}{message===activityAnswer&&activity}</>;
  const afterActivityMessage=message=>activityLayout.after.get(message)?.map(historicalActivity);
  const questionControl=task?.question&&task.state==='waiting_input'?<QuestionDecision key={task.question.id||task.id} question={typeof task.question==='string'?{id:task.id,text:task.question,options:[],kind:'text'}:task.question} disabled={busy||running} blocked={!!panel} onDraft={draft=>api('saveQuestionDraft',{taskId,questionId:task.question.id,draft})} onChoose={async choice=>{await api('answerAgent',{taskId,choice,...(typeof task.question==='string'?{answer:choice.text}:{})});await refresh();return true;}}/>:null;
  const detachedQuestions=(task?.questionHistory||[]).filter(question=>!task.messages.some(message=>message.role==='assistant'&&message.questionId===question.id)||!task.messages.some(message=>message.role==='user'&&message.content===question.answer?.text));
  const conversationScroll=useConversationScroll(task&&!mailPage&&!skillsPage?`${project?.projectId}:${task.id}`:null,latestUserMessage?.inputId||latestUserMessage?.id||latestUserMessage?.at,task?.inbox?.filter(item=>item.mode==='steer').map(item=>item.id).join('|')||'');
  const latestProcess=project?.processes?.find(p=>p.taskId===taskId),latestComparison=project?.comparisons?.find(c=>c.taskId===taskId);
  // Selecting a conversation always leaves the mail and skills pages: the search dialog used to leave the mail page
  // open while the sidebar closed it (defect found by the modal check, 2026-10-06).
  function selectSession(id){if(id===null)setGreeting(previous=>welcomeGreeting({previous}));setProjectPicker(false);setSkillsPage(false);setMailPage(false);setOpenTabs(tabs=>openSession(tabs,id));setTaskId(id);setError('');}
  // The trash icon deletes a conversation and its records; applied files stay (user decision 2026-09-30). The current
  // conversation's place goes back to a new conversation, not to another one.
  function deleteSession(id){return perform(async()=>{await api('deleteTask',{taskId:id});setOpenTabs(tabs=>closeSession(tabs,null,id).tabs);if(taskId===id)setTaskId(null);await refresh();showNotice('대화를 삭제했어요.');return true;});}
  async function copyProjectPath(args){
    return api('copyProjectPath',args);
  }
  async function refresh(){const result=await api('overview',{taskId});if(mounted.current)setProject(result);return result;}
  // The native shell's overview is separate from Workbench state. Refresh the
  // page inventory on completion and when reopening project materials.
  useEffect(()=>{
    if(!project?.projectId||!(panel==='library'||['completed','existing'].includes(wikiInitialization?.state)))return;
    let current=true;const projectId=project.projectId;
    api('overview',{taskId}).then(value=>{if(current&&value.projectId===projectId)setProject(previous=>previous?.projectId===projectId?{...previous,wikiFiles:value.wikiFiles}:previous);}).catch(error=>{if(current)showError(failure(error));});
    return()=>{current=false;};
  },[api,project?.projectId,panel,wikiInitialization?.id,wikiInitialization?.state,wikiInitialization?.finishedAt]);

  // Before a folder opens there is no project state to merge: a model change there is not an error.
  async function refreshProvider(args){const value=await api('provider',args);if(mounted.current)setProvider(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);if(value.connected){const state=await api('state',{taskId}).catch(e=>{if(e.message==='project_missing')return null;throw e;});if(state&&mounted.current)setProject(p=>({...p,...state}));}return value;}
  function showProjectStart(){setMailPage(false);setSkillsPage(false);setPanel(null);setProjectPicker(true);if(compact)setSidebarOpen(false);if(activeView)void workspaceView?.(activeView);}
  function openFolder(){return perform(chooseFolder);}
  async function perform(operation){if(actionLock.current)return;actionLock.current=true;setBusy(true);setError('');try{return await operation();}catch(e){if(mounted.current)setError(failure(e));if(['setup_changed','setup_execution_unconfirmed','quality_unavailable','proposal_invalid_syntax'].includes(e.message))await refresh().catch(()=>{});}finally{actionLock.current=false;if(mounted.current)setBusy(false);}}
  useEffect(()=>{
    if(!environmentPending||!project?.projectId||!provider?.connected||activeTask)return;
    setEnvironmentPending(false);
    perform(async()=>{const created=await api('createTask',{request:ENVIRONMENT_REQUEST});setProject(p=>({...p,tasks:[created,...(p?.tasks||[]).filter(item=>item.id!==created.id)]}));selectSession(created.id);await api('startAgent',{taskId:created.id});await refresh();});
  },[environmentPending,project?.projectId,provider?.connected,activeTask]);
  useEffect(()=>{mounted.current=true;openCurrent().then(value=>{if(!mounted.current)return;setProject(value);if(openedByButton()&&value&&!value.tasks?.length)setEnvironmentPending(true);}).catch(e=>{if(!mounted.current)return;showError(failure(e,'프로젝트를 열지 못했어요. 다시 열어 주세요.'));});api('provider').then(value=>{if(mounted.current)setProvider(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}).catch(()=>{});return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(!project?.projectId)return;const restored=restoreSessionNavigation(project.projectId,project.tasks);setOpenTabs(restored.tabs);setTaskId(restored.selected);setTabsProject(project.projectId);},[project?.projectId]);
  useEffect(()=>{let wasWide=null;const observer=new ResizeObserver(([entry])=>{const width=entry.contentRect.width;if(!width)return;setHostWidth(width);const wide=width>=sidebarBreakpoint;if(wasWide===true&&!wide)setSidebarOpen(false);wasWide=wide;});if(workbenchNode.current)observer.observe(workbenchNode.current);return()=>observer.disconnect();},[sidebarBreakpoint]);
  useEffect(()=>{if(tabsProject===project?.projectId)saveSessionNavigation(tabsProject,openTabs,taskId);},[tabsProject,project?.projectId,openTabs,taskId]);
  // The native window and its optional live web surface share one worker.
  // Reflect login/model changes from either surface without replaying actions.
  useEffect(()=>{let pending=false;const sync=async()=>{if(document.hidden||pending)return;pending=true;try{const value=await api('provider',{action:'status'});if(mounted.current)setProvider(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);}catch{}finally{pending=false;}};const timer=setInterval(sync,2000);window.addEventListener('focus',sync);return()=>{clearInterval(timer);window.removeEventListener('focus',sync);};},[api]);
  useEffect(()=>{
    if(!activeTask&&!(sendingOutgoing&&taskId)&&!provider?.pending&&!['checking','running','stopping'].includes(processResult?.state)&&!['queued','diagnosing'].includes(processResult?.recoveryState))return;
    let alive=true;const projectId=project?.projectId;
    const check=async()=>{if(document.hidden||polling.current)return;polling.current=true;try{
      let needsState=!!activeTask||!!(sendingOutgoing&&taskId),providerValue,processValue;
      if(provider?.pending){providerValue=await api('provider');if(!alive)return;needsState ||= providerValue.connected;}
      if(processResult&&(['checking','running','stopping'].includes(processResult.state)||['queued','diagnosing'].includes(processResult.recoveryState))){processValue=await api('poll',{id:processResult.id});if(!alive)return;needsState=true;}
      // One snapshot per cycle, after any command update. Discard late replies on navigation.
      const state=needsState?await api('state',{taskId}):null;
      if(!alive||!mounted.current)return;
      if(providerValue)setProvider(previous=>JSON.stringify(previous)===JSON.stringify(providerValue)?previous:providerValue);
      if(processValue)setProcessResult(processValue);
      if(state)setProject(p=>p?.projectId===projectId?{...p,...state}:p);
    }catch{}finally{polling.current=false;}};
    const timer=setInterval(check,1000);const visible=()=>{if(!document.hidden)void check();};document.addEventListener('visibilitychange',visible);
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[activeTask?.id,provider?.pending,processResult?.id,processResult?.state,processResult?.recoveryState,taskId,project?.projectId,sendingOutgoing?.id]);
  // A paired Nubi sends requests and results at any time (user decision 2026-10-01): while one is paired, or a
  // pairing address waits to be used, the header count and the exchanged tasks stay current.
  const [inviteUntil,setInviteUntil]=useState(0),linked=!!project?.peerLinks?.length||inviteUntil>0;
  useEffect(()=>{if(!inviteUntil)return;const timer=setTimeout(()=>setInviteUntil(0),Math.max(0,inviteUntil-Date.now()));return()=>clearTimeout(timer);},[inviteUntil]);
  useEffect(()=>{
    if(!linked||!project?.projectId)return;
    const check=async()=>{if(document.hidden||polling.current)return;polling.current=true;try{const state=await api('state',{taskId});if(mounted.current)setProject(p=>p?.projectId===project.projectId?{...p,...state}:p);}catch{}finally{polling.current=false;}};
    const timer=setInterval(check,3000);return()=>clearInterval(timer);
  },[linked,project?.projectId,taskId]);
  useEffect(()=>{setShell(project?.defaultShell||'');},[project?.projectId,project?.defaultShell]);
  useEffect(()=>{if(!project?.projectId)return;let current=true;api('approvalPolicy').then(value=>{if(current)setApproval(value);}).catch(()=>{});return()=>{current=false;};},[project?.projectId]);
  // Automatic approval (user decision 2026-09-30): what the mode or an always-allowed command lets through is done the
  // way the user's own click does it, one step at a time: the proposals of files through the editor, then one command.
  // A task that keeps asking stops after AUTO_STEPS automatic steps for one message of the user.
  useEffect(()=>{
    if(!taskId||!task||running||task.question||task.state!=='review'||busy||connectionRequest)return;
    if(approval.mode==='ask'&&!approval.allowedCommands.length)return;
    // The count belongs to the task and its latest user message: switching to another task does not reset it.
    const turn=(task.messages||[]).filter(message=>message.role==='user').length;
    if(autoSteps.current.get(taskId)?.turn!==turn)autoSteps.current.set(taskId,{turn,count:0});
    const steps=autoSteps.current.get(taskId);
    if(steps.count>=AUTO_STEPS)return;
    let live=true;
    (async()=>{
      const next=await api('autoApprovals',{taskId}).catch(()=>null);
      if(!live||!next)return;
      const files=next.proposals.filter(id=>!autoTried.current.has(id)),command=next.command&&!autoTried.current.has(next.command.id)?next.command:null;
      if(!files.length&&!command)return;
      if(++steps.count===AUTO_STEPS)notifyWorkspaceToast('자동 진행을 여기서 멈췄어요. 남은 승인은 직접 확인해 주세요.');
      await perform(async()=>{
        if(files.length){
          for(const id of files){autoTried.current.add(id);await apply(id);}
          const latest=await refresh();showNotice(`파일 ${files.length}개를 자동으로 반영했어요.`);
          if(provider?.connected&&!waitingOn(latest,taskId)){await api('startAgent',{taskId});await refresh();}
          return;
        }
        autoTried.current.add(command.id);
        const value=command.kind==='setup'?await api('decideSetupAction',{id:command.id,fingerprint:command.fingerprint,decision:'approve'}):await api('applyCommandRepair',{id:command.id});
        await refresh();showNotice(command.reason==='allowed'?'항상 허용한 명령을 실행했어요.':'프로젝트 검사 명령을 자동으로 실행했어요.');
        if(value?.resultProcessId){setProcessResult(await api('poll',{id:value.resultProcessId}));setPanel(null);}
      });
    })();
    return()=>{live=false;};
  },[project,taskId,running,task?.state,task?.question,busy,approval]);
  useEffect(()=>{let current=true;setProcessResult(project?.processes?.find(p=>p.taskId===taskId)||null);setComparison(null);const previous=project?.comparisons?.find(c=>c.taskId===taskId);if(previous)api('comparison',{id:previous.id}).then(value=>{if(current&&mounted.current)setComparison(value);}).catch(()=>{});return()=>{current=false;};},[taskId,latestProcess?.id,latestComparison?.id]);
  useEffect(()=>{let current=true;setKnowledge(null);if(taskId&&panel==='library')api('knowledgeStatus',{taskId}).then(value=>{if(current)setKnowledge(value);}).catch(e=>{if(current)setError(errors[e.message]||'위키 기록을 확인하지 못했어요.');});return()=>{current=false;};},[taskId,panel]);
  useEffect(()=>{searchRun.current++;setSearch(null);setWikiSearch(null);},[project?.projectId,taskId]);
  useEffect(()=>{if(!error)return;showError(error);setError('');},[error]);
  useEffect(()=>{
    if(!task?.error){taskErrorToast.current='';return;}
    const key=`${task.id}:${task.error}`;
    if(taskErrorToast.current===key)return;
    taskErrorToast.current=key;
    showError(errors[task.error]||'분석이 멈췄어요. 연결을 확인한 뒤 다시 시도해 주세요.');
  },[task?.id,task?.error]);
  const [launchingTask,setLaunchingTask]=useState(null);
  async function launchTask(id,operation){setLaunchingTask({id,startedAt:new Date().toISOString(),elapsedMs:0});try{return await operation();}finally{if(mounted.current)setLaunchingTask(null);}}
  async function submit(event){event.preventDefault();
    const shortcut=/^\/(skills|model|usage)\s*$/.exec(request.trim());
    if(shortcut){setRequest('');runComposerCommand(AGENT_COMMANDS.find(item=>item.command===shortcut[1]).action);return;}
    if(running){await sendRunningInput();return;}
    if(!request.trim()||busy||submitLock.current||task?.question||connectionRequest)return;
    const text=request,references=[...mailReferences],scope=draftScope.current,projectId=project?.projectId,id=crypto.randomUUID();
    const item={id,projectId,taskId:taskId??null,text,references,phase:'sending',at:new Date().toISOString(),inputId:id,messageCount:task?.messages?.length||0};
    submitLock.current=true;setSubmitting(true);setOutgoing(items=>[...items,item]);setRequest('');setMailReferences([]);
    conversationScroll.followLatest();requestAnimationFrame(()=>composer.current?.focus());
    const currentProject=()=>mounted.current&&projectRefForSubmit.current===projectId;
    let accepted=false;
    const refreshTask=async selectedId=>{const selectedScope=JSON.stringify([projectId,selectedId]);const value=await api('state',{taskId:selectedId});if(currentProject()&&draftScope.current===selectedScope)setProject(current=>({...current,...value}));};
    try{
      if(task){
        const key=JSON.stringify([projectId,taskId,text,references]);
        if(inputAttempt.current?.key!==key)inputAttempt.current={key,id};
        const inputId=inputAttempt.current.id;setOutgoing(items=>items.map(item=>item.id===id?{...item,inputId}:item));
        await submitTaskMessage(api,{taskId,text,mailReferences:references,inputId:inputAttempt.current.id,onState:value=>{if(currentProject()&&draftScope.current===scope)setProject(current=>({...current,...value}));}});
        accepted=true;inputAttempt.current=null;await refreshTask(taskId);
      }else{
        const created=await api('createTask',{request:text,mailReferences:references});
        if(currentProject()){
          setProject(p=>({...p,tasks:[created,...p.tasks.filter(item=>item.id!==created.id)]}));
          setOutgoing(items=>items.map(item=>item.id===id?{...item,taskId:created.id,createdTask:true}:item));
          if(draftScope.current===scope){moveDraft(created.id);moveMailDraft(created.id);selectSession(created.id);requestAnimationFrame(()=>composer.current?.focus());}
        }
        if(!currentProject())throw Error('project_changed');
        if(provider?.connected){await api('startAgent',{taskId:created.id});accepted=true;await refreshTask(created.id);}
      }
      if(mounted.current)setOutgoing(items=>items.filter(item=>item.id!==id));
    }catch(cause){
      if(mounted.current){if(!accepted)setError(failure(cause));setOutgoing(items=>items.map(item=>item.id===id?{...item,phase:accepted?'accepted':'unconfirmed'}:item));
        // The bubble preserves uncertain requests. Never put them back in Send automatically.
      }
    }finally{submitLock.current=false;if(mounted.current)setSubmitting(false);}
  }

  async function inputAction(action,args={}){
    if(inputLock.current)return;inputLock.current=true;setInputBusy(true);setError('');
    try{const result=await api('agentInput',{taskId,action,runId:task.checkpoint?.runId,...args});await refresh();if(['enqueue','steer','start'].includes(action))conversationScroll.followLatest();return result;}
    catch(e){setError(failure(e));}
    finally{inputLock.current=false;if(mounted.current)setInputBusy(false);}
  }
  async function sendRunningInput(){
    const text=request.trim();if(!text||busy||inputLock.current||submitLock.current)return;
    const references=[...mailReferences],projectId=project?.projectId,scope=draftScope.current,key=JSON.stringify([projectId,taskId,task.checkpoint?.runId,text,references]);
    if(inputAttempt.current?.key!==key)inputAttempt.current={key,id:crypto.randomUUID()};
    const id=inputAttempt.current.id;
    inputLock.current=true;setInputBusy(true);setError('');
    setOutgoing(items=>[...items.filter(item=>item.id!==id),{id,inputId:id,projectId,taskId,text,references,queued:true,phase:'sending',at:new Date().toISOString(),messageCount:task.messages?.length||0}]);
    setRequest('');setMailReferences([]);conversationScroll.followLatest();requestAnimationFrame(()=>composer.current?.focus());
    let accepted=false;
    try{
      const updated=await api('agentInput',{taskId,action:'enqueue',runId:task.checkpoint?.runId,id,text,mode:'queue',mailReferences:references});
      accepted=true;inputAttempt.current=null;
      if(mounted.current&&draftScope.current===scope){
        if(updated?.id===taskId)setProject(current=>({...current,tasks:current.tasks.map(item=>item.id===taskId?updated:item)}));
        else {const value=await api('state',{taskId});if(mounted.current&&draftScope.current===scope)setProject(current=>({...current,...value}));}
      }
      if(mounted.current)setOutgoing(items=>items.filter(item=>item.id!==id));
    }catch(cause){if(mounted.current){if(!accepted)setError(failure(cause));setOutgoing(items=>items.map(item=>item.id===id?{...item,phase:accepted?'accepted':'unconfirmed'}:item));}}
    finally{inputLock.current=false;if(mounted.current)setInputBusy(false);}
  }
  async function editInput(id){
    if(request.trim()){setError('입력 중인 메시지를 먼저 보내거나 비워 주세요.');return;}
    const item=task.inbox.find(item=>item.id===id);if(!item)return;
    try{appendMailReferences(readMailReferences(),item.mailReferences||[]);}catch(error){setError(failure(error));return;}
    const result=await inputAction('remove',{id});if(result){const draft=readDraft();setRequest(draft?draft+'\n'+result.text:result.text);setMailReferences(current=>appendMailReferences(current,result.mailReferences||[]));if(draft)showNotice('초안 아래에 편집할 메시지를 넣었어요.');requestAnimationFrame(()=>composer.current?.focus());}
  }
  async function refreshCatalog(options={}){
    const selected=options.provider||provider?.provider;
    if(catalogRequests.current.has(selected))return catalogRequests.current.get(selected);
    const revision=providerRevision.current;
    setCatalogLoading(selected);
    const request=(async()=>{try{
      const value=await api('provider',{action:'refresh',input:{provider:selected}});
      if(mounted.current&&revision===providerRevision.current)setProvider(value);
      return true;
    }catch(cause){if(mounted.current)showError('모델 목록을 갱신하지 못했어요. 새로고침으로 다시 시도해 주세요.');return false;}
    finally{catalogRequests.current.delete(selected);if(mounted.current)setCatalogLoading(value=>value===selected?null:value);}})();
    catalogRequests.current.set(selected,request);return request;
  }
  async function modelAction(action,input={}){if(action==='refresh')return refreshCatalog(input);providerRevision.current++;return perform(async()=>{await refreshProvider({action,input});return true;});}
  async function regenerateResponse(message){
    if(!provider?.connected){openModels();return;}
    await perform(async()=>{await launchTask(taskId,()=>api('regenerateAnswer',{taskId,messageId:message.id}));await refresh();conversationScroll.followLatest();});
  }
  async function login(selected){if(selected==='claude'){
    if(actionLock.current)return;
    providerRevision.current++;
    await perform(async()=>{
      setClaudeChecking(true);
      try {await refreshProvider({action:'login',input:{provider:'claude'}});setClaudeIssue(null);}
      catch(cause){
        if(!['claude_cli_missing','claude_cli_update','claude_login_required'].includes(cause.message))throw cause;
        setClaudeIssue(cause.message);openChildPanel('claude');
      }finally{if(mounted.current)setClaudeChecking(false);}
    });return;
  }if(selected==='fabrix'){openChildPanel('fabrix');return;}await modelAction('login',{provider:selected});}
  function openSkillPanel(tab,trigger) {
    skillsPanelTrigger.current=trigger||document.activeElement;
    setSkillTab(tab);setPanel('skills');
  }
  function addSkillToDraft(skill) {
    const draft=draftLatest.current;
    setRequest('/'+desktopSkillCommand(skill)+' '+draft);
    requestAnimationFrame(() => composer.current?.focus());
  }
  const [mailSourceTarget,setMailSourceTarget]=useState(null);
  const mailViewState=useMemo(()=>({current:{}}),[project?.projectId]);
  const handledMailDraft=useRef(null);
  useEffect(()=>{
    if(!mailDraftRequest||handledMailDraft.current===mailDraftRequest.requestId||!project?.projectId)return;
    handledMailDraft.current=mailDraftRequest.requestId;
    void askFromMail(mailDraftRequest.reference).catch(error=>{if(mounted.current)showError(failure(error));}).finally(()=>onMailDraftHandled?.());
  },[mailDraftRequest?.requestId,project?.projectId]);
  async function askFromMail(reference){
    if(busy||inputLock.current||task?.question||connectionRequest)throw Error('agent_busy');
    const scope=draftScope.current,references=Array.isArray(reference)?reference:[reference];
    appendMailReferences(readMailReferences(),references);
    const observed=await Promise.all(references.map(item=>api('mail',{...item,action:'evidence'})));
    if(!mounted.current||draftScope.current!==scope)throw Error('agent_busy');
    const next=appendMailReferences(readMailReferences(),observed);
    setMailReferences(next);
    if(openMailSources)openMailSources(observed);else closeMailDocument?.();
    setMailPage(false);setSkillsPage(false);setProjectPicker(false);setMailSourceTarget(null);
    requestAnimationFrame(()=>composer.current?.focus());
  }
  function askMailSearch({query,filters}){
    if(busy||inputLock.current||task?.question||connectionRequest)throw Error('agent_busy');
    setRequest(mailSearchDraft(readDraft(),query,filters));
    closeMailDocument?.();setMailPage(false);setSkillsPage(false);setProjectPicker(false);setMailSourceTarget(null);
    requestAnimationFrame(()=>composer.current?.focus());
  }
  function openAnswerSource(source,message) {
    if(source.kind==='mail'){
      void perform(async()=>{const observed=await api('mail',{...source,action:'evidence'});if(openMailSources){if(source.attachmentId&&openMailDocument)await openMailDocument(source.id,source.attachmentId,source);else openMailSources([observed]);}else{setMailSourceTarget({...source,key:crypto.randomUUID()});setMailPage(true);}setPanel(null);});
    }else void perform(async()=>{const sourceProjectId=project?.projectId;const current=await api('editorSource',{projectId:sourceProjectId,path:source.path,taskId});if(!mounted.current)return;if(current.hash!==source.hash)throw Error('answer_source_changed');await openPath(source.path,taskId,{projectId:sourceProjectId,line:source.start,expectedHash:source.hash,canPresent:()=>mounted.current});});
  }
  function runComposerCommand(action){if(action==='model')openModels();else if(action==='skills')openSkillPanel('installed');else if(action==='usage')setPanel('usage');}
  const mailEvidence=<MailEvidenceChips references={mailReferences} onRemove={item=>setMailReferences(current=>removeMailReference(current,item))} onOpen={source=>openAnswerSource({...source,kind:'mail'})}/>;
  const waitingRequests=incomingRequests(project).length;
  const panelTitle=(icon,label)=><span className="nubi-panel-title" title={label}><span className="nubi-panel-title-icon" aria-hidden="true">{icon==='app'?<WindowMark size={18}/>:icon==='terminal'?<TerminalMark/>:<Icon name={icon} size={18}/>}</span><span>{label}</span></span>;
  const approvalControl=project?<ApprovalModeControl policy={approval} disabled={busy} onMode={mode=>perform(async()=>{setApproval(await api('setApprovalMode',{mode}));})} onRemove={item=>perform(async()=>{setApproval(await api('removeAllowedCommand',{profile:item.profile,script:item.script}));})}/>:null;
  const modelPicker=provider?.connected?<ModelPicker data={modelData} providerLabels={providerLabels} loading={catalogLoading===provider?.provider} disabled={submitting||busy||!!activeTask} open={panel==='models'} onOpen={openModels} onRefresh={()=>modelAction('refresh')}/>:<CxButton className="model-trigger" data-provider={provider?.provider||'aipro'} aria-haspopup="dialog" aria-label="모델 선택" title="모델을 선택하고 로그인" disabled={busy} onClick={openModels}><ProviderIcon provider={provider?.provider||'aipro'}/><span className="model-trigger-label"><span>{provider?.models?.find(model=>model.id===provider.model)?.label||provider?.model||'모델 선택'}</span></span><Icon name="chevronDown" size={16}/></CxButton>;
  const reasoningControl=['aipro','chatgpt','claude'].includes(provider?.provider)?<ReasoningPicker api={api} provider={provider} disabled={busy||!!activeTask}/>:null;
  const contextModel=modelData.catalog.models.find(m=>m.id===provider?.model)||{name:provider?.model||'',displayName:provider?.model||'선택한 모델 없음'};
  const meter=workspaceContextMeterInfo({task,model:contextModel,draft:request});
  const contextMeter=<ContextMeter dialogTitle={panelTitle('chartColumn','컨텍스트 사용량')} usageInfo={meter} model={contextModel} messages={NO_MESSAGES} draft="" promptContext={NO_PROMPT} stats={{count:task?.context?.compactions||0,beforeTokens:task?.context?.beforeTokens,afterTokens:task?.context?.afterTokens}}/>;
  const choosingProject=projectPicker||(!project)||(!task&&project.kind!=='conversation'&&!project.wikiFiles?.length&&(!wikiInitialization||['waiting_model','waiting_source'].includes(wikiInitialization.state)));
  const companyAccount=ghesAccount&&<GhesAccount account={ghesAccount} updates={ghesUpdate} repositories={ghesRepositories} open={accountOpen} loginRequest={accountLoginRequest} onOpen={()=>setAccountOpen(true)} onClose={()=>{setAccountOpen(false);restoreMarketplacePanel(pendingMarketplace.current);}} onConnected={accountConnected} onCancelled={cancelCompanyConnection} buttonRef={accountButton}/>;
  return <div ref={workbenchNode} className="nubi-workbench" style={{'--nubi-chat-min-width':`${minimumAgentWidth}px`}} data-compact={compact} data-large-text={false} data-host-layout={hostLayout} data-workspace-screen={mailPage||panel==='mail'?'mail':skillsPage?'skills':task?'conversation':'welcome'}><AmbientScene/>{toastHost&&<WorkspaceToast/>}
    <WorkspaceToolbar layoutRoot={workbenchNode} accountControl={<><WorkspaceUpdate compact update={workspaceUpdate} onInstall={installUpdate}/>{companyAccount}</>} host={hostLayout==='integrated'?toolbarHost:null} title={mailPage?'메일':skillsPage?'AI Workspace':task?.request||projects.find(entry=>entry.id===project?.projectId)?.name||project?.name||'시작하기'} status={task&&task.state!=='review'&&(task.state==='paused'&&!connectionRequest?<RecoveryStatus/>:<DeckStatus tone={running?'active':'neutral'}>{connectionRequest?'앱 연결 대기':task.state==='waiting_input'&&task.peerWait&&!task.question?'연결한 누비 응답 대기':task.state==='running'&&Number.isFinite(task.responseTiming?.elapsedMs)?<ResponseTime timing={task.responseTiming} label="진행" live/>:stateLabel[task.state]||task.state}</DeckStatus>)} project={project} sidebarOpen={sidebarOpen} onToggleSidebar={()=>setSidebarOpen(value=>!value)} disabled={busy} onNew={()=>{setMailPage(false);setSkillsPage(false);selectSession(null);if(compact)setSidebarOpen(false);requestAnimationFrame(()=>composer.current?.focus());}}>
      <WorkspaceIconAction ref={toolbarHost?usageButton:undefined} icon="chartColumn" iconOnly label="토큰 사용량" aria-haspopup="dialog" onClick={()=>setPanel('usage')}/>
      {project&&<WorkspaceIconAction icon="bookmark" iconOnly indicator={wikiInitialization?.state==='running'&&<span className="status-spinner" aria-label="위키 준비 중"/>} label="위키" title={wikiInitialization?.state==='running'?'프로젝트 위키 준비 중':'프로젝트 위키'} aria-busy={wikiInitialization?.state==='running'||undefined} onClick={()=>setPanel(wikiInitialization?.state==='running'?'wiki-progress':'library')}/>}
    </WorkspaceToolbar>
    <div className={`nubi-workbench-layout${project?' has-project':''}`}>
    {workspaceView&&hostLayout==='integrated'&&<WorkspaceNavigation activeView={activeView} homeActive={!mailPage&&!skillsPage&&!taskId&&!activeView} onMail={()=>{setMailPage(true);setPanel(null);if(activeView)void workspaceView(null);}} mailActive={mailPage} rail disabled={!project} homeDisabled={busy} settingsRef={settingsButton} onHome={()=>{if(!busy){setMailPage(false);selectSession(null);requestAnimationFrame(()=>composer.current?.focus());}}} onSidebarToggle={()=>setSidebarOpen(value=>!value)} sidebarOpen={sidebarOpen} onView={view=>perform(()=>openWorkspaceView(view))} onSettings={()=>setPanel('settings')} skillsRef={skillsButton} skillsActive={skillsPage&&skillTab==='installed'} teamActive={skillsPage&&skillTab==='marketplace'} onSkills={()=>{panelOrigin.current=null;setPanel(null);setSkillTab('installed');setSkillsPage(true);if(compact)setSidebarOpen(false);}} onTeamWorkspace={hostLayout==='integrated'?enterTeamWorkspace:undefined} accountControl={toolbarHost?null:companyAccount}/>}
    {<SessionSidebar projects={projects} onSwitchProject={switchProject&&((id)=>perform(()=>switchProject(id)))} onRenameProject={renameProject&&((id,name)=>perform(()=>renameProject(id,name)))} onRemoveProject={removeProject&&((id)=>perform(()=>removeProject(id)))} filesMode={hostLayout!=='integrated'&&['files','file'].includes(activeView)} activeFile={activeFile} onOpenFile={openPath?path=>perform(async()=>{await openPath(path);if(compact)setSidebarOpen(false);}):undefined} brand={hostLayout==='integrated'&&!toolbarHost} compactAt={sidebarBreakpoint} compact={compact} project={project} selected={taskId} open={sidebarOpen} disabled={busy} onToggle={()=>setSidebarOpen(value=>!value)} onChooseProject={showProjectStart} onSearch={event=>{historyTrigger.current=event.currentTarget;setPanel('history');}} onCopyProjectPath={copyProjectPath} onNew={()=>{setMailPage(false);selectSession(null);if(compact)setSidebarOpen(false);requestAnimationFrame(()=>composer.current?.focus());}} onSelect={id=>{setMailPage(false);selectSession(id);if(compact)setSidebarOpen(false);}} onDelete={deleteSession}/>}
    {resizeSidebar&&<div className="nubi-sidebar-resize" {...sidebarResize}/>}
    <div className="nubi-workbench-content">
    {mailPage?<MailHistory viewState={mailViewState} onReturn={mailSourceTarget?()=>{closeMailDocument?.();setMailPage(false);setMailSourceTarget(null);requestAnimationFrame(()=>composer.current?.focus());}:undefined} sourceTarget={mailSourceTarget} onSettings={openMailConnection} connectionRef={mailButton} api={api} provider={provider} onDocument={openMailDocument} onAsk={askFromMail} onAskSearch={askMailSearch}/>:skillsPage?<SkillManager accountRevision={accountRevision} onSignIn={startCompanySignIn} key={`${project?.projectId}:${skillTab}:${skillRevision}`} api={api} initialTab={skillTab} openPath={openPath} onRegister={registerSkill} connectMarketplace={connectMarketplace&&connectCompanyMarketplace}  onBack={()=>{setSkillsPage(false);requestAnimationFrame(()=>skillsButton.current?.focus());}}/>:<>
    {!toolbarHost&&<header className="nubi-bar">{hostLayout==='integrated'&&project?<DriftLabel className="nubi-conversation-title" title={task?.request||undefined}>{task?.request||''}</DriftLabel>:<NubiLogo size={hostLayout==='integrated'?24:32} product="Workspace" versionLabel="Beta" mood={activeTask?'working':'idle'}/>}{/* no project, no empty label (user decision 2026-09-30) */project?.name&&<DriftLabel className="nubi-project-label">{project.name}</DriftLabel>}{task&&task.state!=='review'&&(task.state==='paused'&&!connectionRequest?<RecoveryStatus/>:<DeckStatus tone={running?'active':'neutral'}>{connectionRequest?'앱 연결 대기':task.state==='waiting_input'&&task.peerWait&&!task.question?'연결한 누비 응답 대기':task.state==='running'&&Number.isFinite(task.responseTiming?.elapsedMs)?<ResponseTime timing={task.responseTiming} label="진행" live/>:stateLabel[task.state]||task.state}</DeckStatus>)}<div className="nubi-header-actions">
      <CxButton ref={usageButton} className="nubi-icon-button" aria-label="토큰 사용량" title="토큰 사용량" aria-haspopup="dialog" onClick={()=>setPanel('usage')}><Icon name="chartColumn" size={18}/><span>사용량</span></CxButton>
      {DESKTOP_FEATURES.computerUse&&task&&<CxButton ref={appButton} className="nubi-icon-button" aria-label="앱 연결" title="앱 연결" onClick={()=>setPanel('computer')}><WindowMark size={18}/></CxButton>}{project&&<WorkspaceIconAction icon="bookmark" iconOnly indicator={wikiInitialization?.state==='running'&&<span className="status-spinner" aria-label="위키 준비 중"/>} label="위키" title={wikiInitialization?.state==='running'?'프로젝트 위키 준비 중':'프로젝트 위키'} aria-busy={wikiInitialization?.state==='running'||undefined} onClick={()=>setPanel(wikiInitialization?.state==='running'?'wiki-progress':'library')}/>}
    </div></header>}
    {project&&workspaceView&&hostLayout!=='integrated'&&<WorkspaceNavigation settingsRef={settingsButton} onSettings={()=>setPanel('settings')} onView={view=>perform(()=>openWorkspaceView(view))}/>}
    <main className="nubi-main">
      {!task&&!provider&&<div className="nubi-connecting" role="status">누비를 준비하고 있어요.</div>}
      {!task&&provider&&!provider.connected&&!projectPicker&&!(!project&&projects.length>0)&&<NubiLogin checkingProvider={claudeChecking?'claude':null} providerLabels={providerLabels} mood={provider.pending||claudeChecking?'working':provider.loginError?'sad':resting} intro={intro} pending={modelData.pending} onLogin={login} onCancel={()=>modelAction('cancel')}>
        {!!mailReferences.length&&<div className="nubi-mail-login-context"><p>선택한 메일은 연결 후 질문할 수 있어요.</p>{mailEvidence}</div>}
        {provider.loginError&&provider.loginDiagnostics?.length>0&&<DeckDisclosure title="연결 진단" icon="link"><pre>{providerLoginDiagnostics(provider)}</pre></DeckDisclosure>}
      </NubiLogin>}
      {!task&&(provider?.connected||projectPicker||!project&&projects.length>0)&&<section className={visibleOutgoing.length?"nubi-task nubi-submit-scene":"nubi-start chat-page is-empty"}>
        {visibleOutgoing.length?<div className="nubi-conversation-wrap"><div className="nubi-conversation-scroll" ref={conversationScroll.viewport} aria-label="대화 내용" tabIndex={0} onScroll={conversationScroll.onScroll}><div className="nubi-conversation-content" ref={conversationScroll.content}><OutgoingMessages items={visibleOutgoing} onDismiss={dismissOutgoing} onSource={source=>openAnswerSource({...source,kind:'mail'})}/></div></div></div>:<Welcome animate={!welcomeAnimated&&!request&&!motion.paused} onComplete={setWelcomeAnimated} mood={resting} intro={false} lead="" greeting={choosingProject?'프로젝트를 열어 주세요.':greeting} markSize={200}/>}
        {choosingProject?<ProjectStart projects={projects} onSelectProject={switchProject&&((id)=>perform(()=>switchProject(id)))} modelControl={modelPicker} onCancel={projectPicker&&project?()=>setProjectPicker(false):undefined} onStartConversation={startConversation&&(()=>perform(startConversation))} busy={busy} blocked={!!activeTask} onOpenFolder={()=>openFolder()} onClone={cloneRepository&&(url=>perform(()=>cloneRepository(url)))}/>:<WorkspaceComposer commandApi={api} taskId={taskId} onCommand={runComposerCommand} onMinimumWidth={setMinimumAgentWidth} className="nubi-compose-card" modelControl={<><WorkspaceSkillMenu api={api} taskId={taskId} onSelect={addSkillToDraft} onMarketplace={hostLayout==='integrated'?trigger=>openSkillPanel('marketplace',trigger):undefined} onManage={trigger=>openSkillPanel('installed',trigger)}/>{modelPicker}{reasoningControl}</>} contextControl={contextMeter} actionControl={approvalControl} evidenceControl={mailEvidence} onSubmit={submit} inputRef={composer} value={request} onChange={e=>setRequest(e.target.value)} placeholder="함께할 일을 적어 주세요" aria-label="작업 요청" sending={submitting} sendDisabled={!request.trim()||submitting||busy}/>}

      </section>}
      {task&&<section className="nubi-task"><div className="nubi-conversation-wrap"><div className="nubi-conversation-scroll" ref={conversationScroll.viewport} aria-label="대화 내용" tabIndex={0} onScroll={conversationScroll.onScroll} onFocusCapture={conversationScroll.onFocusCapture}><div className="nubi-conversation-content" ref={conversationScroll.content}>
                <article className="message message-user nubi-request" aria-label="내 메시지"><div className="nubi-user-bubble"><MessageBody role="user" content={task.request}/><MailEvidenceChips references={task.requestMailReferences} onOpen={source=>openAnswerSource({...source,kind:'mail'})}/></div><div className="message-actions"><MessageTimestamp at={task.createdAt}/><CopyButton text={task.request} label="내 메시지 복사" successMessage="메시지를 복사했습니다."/></div></article>
                {activityLayout.root.map(historicalActivity)}

        <div className="nubi-enter">
          {!task.messages.length&&!running&&!connectionRequest&&!provider?.connected&&<p className="nubi-muted">모델을 연결해 분석을 시작하세요.</p>}

          <ConversationMessages onSource={openAnswerSource} messages={historyMessages} task={task} provider={provider} onRegenerate={regenerateResponse} regenerateDisabled={busy||running||waitingOn(project,taskId)||!!task.question||!!connectionRequest} beforeMessage={beforeActivityAnswer} afterMessage={afterActivityMessage} questionMessage={activityLayout.questionMessage} questionControl={questionControl}/>
          {running&&task.streamingAnswer&&<article className="message message-assistant nubi-streaming-answer" aria-label="작성 중인 답변"><MessageBody role="assistant" content={task.streamingAnswer}/></article>}
          {DESKTOP_FEATURES.computerUse&&connectionRequest&&!task.question&&task.state!=='cancelled'&&<ComputerConnectionForm request={connectionRequest} key={'connection-'+connectionRequest.id} taskId={taskId} state={project.computer} api={api} refresh={refresh} disabled={busy||running}/>}
          {DESKTOP_FEATURES.computerUse&&<ComputerUse showControls={false} key={`computer-${task.id}`} taskId={taskId} state={project.computer} api={api} refresh={refresh} disabled={busy||running||!!task.question||task.state==='cancelled'}/>}
          <SetupActions actions={(project.setupActions||[]).filter(a=>a.taskId===taskId)} proposals={proposals} processes={project.processes||[]} onAlways={action=>perform(async()=>{setApproval(await api('allowCommand',{kind:'setup',id:action.id}));const value=await api('decideSetupAction',{id:action.id,fingerprint:action.fingerprint,decision:'approve'});await refresh();if(value.resultProcessId){setProcessResult(await api('poll',{id:value.resultProcessId}));setPanel(null);}})} disabled={busy||running||!!task.question||task.state==='cancelled'} onDecision={(action,decision)=>perform(async()=>{const value=await api('decideSetupAction',{id:action.id,fingerprint:action.fingerprint,decision,elevationConsent:action.privilege==='administrator'});await refresh();if(value.resultProcessId){setProcessResult(await api('poll',{id:value.resultProcessId}));setPanel(null);}})} onResult={id=>perform(async()=>{setProcessResult(await api('poll',{id}));setPanel(null);})}/>
          {task.changePlan&&<DeckDisclosure icon="clipboardCheck" title={`작업 계획 (${task.changePlan.targets.length}개 파일)`}><p>{task.changePlan.summary}</p><ul className="nubi-plan-list">{task.changePlan.requirements.map(r=><li key={r.id}><strong>{r.text}</strong><small>{r.criterionId?'완료 조건 '+r.criterionId:'누비가 정리한 요구사항'}</small></li>)}</ul>{task.changePlan.targets.map(target=><CxButton className="nubi-file-link" key={target.path} onClick={()=>perform(()=>openPath(target.path,taskId))}><Icon name="file" size={16}/><DriftLabel as="strong">{target.path}</DriftLabel><span>{target.reason}</span></CxButton>)}<p className="nubi-muted">관련 항목 {task.changePlan.impact.items.reduce((n,item)=>n+item.nodes.length,0)}개를 검토합니다.{task.changePlan.impact.unmapped.length?' 연결 정보가 없는 파일은 영향 범위를 따로 확인해야 해요.':''}</p>{task.changePlan.wikiEvidence?.length>0&&<DeckDisclosure title={`계획의 위키 근거 ${task.changePlan.wikiEvidence.length}개`}>{task.changePlan.wikiEvidence.map(row=><CxButton key={row.evidenceId} className="nubi-file-link" onClick={()=>perform(()=>openPath(row.path,taskId))}><Icon name="file" size={16}/><DriftLabel>{row.path}:{row.start}</DriftLabel></CxButton>)}<p className="nubi-muted">계획에 사용한 문서입니다. 제안을 만들 때 변경 여부를 다시 확인합니다.</p></DeckDisclosure>}<h3>완료할 일</h3><ul className="nubi-plan-list">{task.changePlan.checks.map((check,i)=><li key={i}>{check.description}<small>{({test:'테스트',browser:'실제 화면',inspection:'직접 확인'})[check.method]}</small></li>)}</ul>{task.changePlan.assumptions.length>0&&<p className="nubi-muted">전제: {task.changePlan.assumptions.join(', ')}</p>}</DeckDisclosure>}
          {!!detachedQuestions.length&&<DeckDisclosure title="확인한 요구사항" icon="check">{detachedQuestions.map((q,i)=><div className="nubi-decided-question" key={q.id||i}><p>{q.text}</p><strong>{q.answer.text}</strong></div>)}</DeckDisclosure>}
          {pendingProposals.length>0&&<section className="nubi-results"><h2>변경 제안</h2>{pendingProposals.map(p=><article className="nubi-file-card" key={p.id}><span className="nubi-file-tile" aria-hidden="true"><Icon name="file" size={20}/></span><div className="nubi-file-body"><strong>{p.path}</strong>{p.reason&&<p>{p.reason}</p>}<div className="nubi-file-meta"><span className="nubi-pill" data-tone={p.state==='proposed'?'blue':p.state==='applied'?'done':undefined}>{stateLabel[p.state]||p.state}</span>{p.kind==='create'&&<span className="nubi-pill">새 파일</span>}{p.stats?.state==='counted'&&<span className="nubi-pill nubi-pill-mono" title="추가한 줄과 지운 줄">+{p.stats.added} −{p.stats.removed}줄</span>}<span className="nubi-pill" data-tone={p.quality?.state==='passed'?'done':p.quality?.state==='blocked'?'danger':undefined} title="문법 검사 결과입니다. 타입 검사와 실행 테스트는 별도로 확인합니다.">{qualityLabel(p.quality)}</span></div></div><div className="nubi-file-actions"><CxButton className="nubi-icon-button" aria-label="비교" title="변경 비교" onClick={()=>perform(()=>review(p.id))}><Icon name="columns" size={18}/><span>비교</span></CxButton>{p.state==='proposed'&&<>{p.kind!=='create'&&<CxButton className="nubi-icon-button" onClick={()=>perform(async()=>{const result=await api('mergeProposal',{proposalId:p.id});if(result.conflicted){setError('같은 부분이 바뀌었어요. 현재 파일과 제안을 비교해 주세요.');return;}await refresh();showNotice('현재 파일에 맞춰 새 제안을 만들었어요.');})} aria-label="다시 맞추기" title="현재 파일에 다시 맞추기"><Icon name="refresh" size={18}/><span>다시 맞추기</span></CxButton>}<CxButton variant="primary" onClick={()=>perform(async()=>{await apply(p.id);const latest=await refresh();showNotice('파일 반영을 확인했어요.');if(provider?.connected&&!running&&!task.question&&task.state!=='cancelled'&&!waitingOn(latest,taskId)){await api('startAgent',{taskId});await refresh();}})} aria-label="반영" title="파일에 반영"><Icon name="check" size={18}/><span>반영</span></CxButton></>}</div></article>)}</section>}
          {!!task.sources?.length&&<DeckDisclosure title={`확인한 자료 ${task.sources.length}개`} icon="file">{task.sources.map(source=><CxButton className="nubi-file-link" key={source.path} onClick={()=>perform(()=>openPath(source.path,taskId))}><Icon name="file" size={16}/><DriftLabel>{source.path}</DriftLabel></CxButton>)}</DeckDisclosure>}
          {/* A command run as it reads in its shell (user decision 2026-09-30): state, exit code and stop in the bar. */}{processResult&&<div className="nubi-process"><TerminalBlock label="명령 실행" copyOutput={!!processResult.output} profile={project?.profiles?.find(p=>p.id===processResult.profile)?.label||processResult.profile} workspace={processResult.cwd} command={processResult.script} output={processResult.fault==='shell_command_limit'?'명령이 너무 길어요. 짧은 명령으로 나누거나 다른 셸을 선택해 주세요.':processResult.output||'출력을 기다리고 있어요.'} status={<><span className="nubi-terminal-state" data-state={processResult.state}>{stateLabel[processResult.state]||processResult.state}</span>{processResult.exitCode!==null&&<span className="nubi-terminal-exit" title="종료 코드">exit {processResult.exitCode}</span>}{processResult.state==='running'&&<CxButton className="nubi-terminal-stop" aria-label="명령 중지" title="명령 중지" onClick={()=>perform(async()=>setProcessResult(await api('stop',{id:processResult.id})))}><span className="stop-symbol" aria-hidden="true"/></CxButton>}</>}/></div>}
          {processResult&&['failed','timed_out','interrupted'].includes(processResult.state)&&<section className="nubi-recovery-card" aria-label="실행 오류 복구"><p>{processResult.execution==='not_started'?'실행 전 검사에서 오류를 발견했어요.':'일부 변경이 남아 있을 수 있어요. 실제 결과부터 확인합니다.'}</p><CxButton disabled={busy||running||!!task.question} onClick={()=>provider?.connected?perform(async()=>{await api('diagnoseProcess',{id:processResult.id});await refresh();}):openModels()}><Icon name="search" size={16}/>{provider?.connected?'오류 분석':'로그인 후 오류 분석'}</CxButton></section>}
          {(project.commandRepairs||[]).filter(r=>r.taskId===taskId).map(r=>{const runRepair=always=>perform(async()=>{if(always)setApproval(await api('allowCommand',{kind:'repair',id:r.id}));const result=await api('applyCommandRepair',{id:r.id});if(result.resultProcessId)setProcessResult(await api('poll',{id:result.resultProcessId}));await refresh();});return <DecisionPrompt key={r.id} id={r.id} title="수정한 명령을 실행할까요?" summary={r.state==='proposed'?'명령 수정 제안':r.state==='started'?'수정한 명령 실행됨':'실행 상태 확인 필요'} icon="terminal" label={r.state==='proposed'?'확인하고 실행':'명령 상세'} pending={r.state==='proposed'} blocked={busy||running||!!task.question}>
            <p>{r.reason}</p>
            <TerminalBlock profile={r.profile} workspace={r.workspace} command={r.script} label="수정한 명령"/>
            {r.state==='proposed'?<ApprovalBar disabled={busy||running||!!task.question} onApprove={()=>runRepair(false)} onAlways={()=>runRepair(true)}/>:<p className="nubi-muted">{r.state==='started'?'실행 결과는 대화에서 확인해 주세요.':'실행 상태를 확인해 주세요. 같은 명령을 자동으로 반복하지 않습니다.'}</p>}
          </DecisionPrompt>;})}
          {comparison&&<div className="nubi-comparison"><div className="nubi-compare-toolbar"><DeckStatus>{comparison.state==='stale'?'기준 변경됨':'캡처됨'}</DeckStatus><CxButton aria-pressed={overlay} onClick={()=>setOverlay(!overlay)}><Icon name="layers" size={16}/>{overlay?'나란히 보기':'겹쳐 보기'}</CxButton></div><div className={`nubi-captures ${overlay?'overlay':''}`}><figure><figcaption>변경 전</figcaption><img src={comparison.beforeImage} alt="변경 전 실제 로컬 화면"/></figure><figure><figcaption>변경 후</figcaption><img src={comparison.afterImage} alt="변경 후 실제 로컬 화면"/></figure></div><p className="nubi-muted">{comparison.note}</p></div>}
          <ConversationMessages onSource={openAnswerSource} messages={inboxMessages} task={task} provider={provider} onRegenerate={regenerateResponse} regenerateDisabled={busy||running||waitingOn(project,taskId)||!!task.question||!!connectionRequest} beforeMessage={beforeActivityAnswer} afterMessage={afterActivityMessage} questionMessage={activityLayout.questionMessage} questionControl={questionControl}/>
          <OutgoingMessages items={visibleOutgoing} onDismiss={dismissOutgoing} task={task} onSource={source=>openAnswerSource({...source,kind:'mail'})}/>
          {!activityAnswer&&activity}
          {!activityLayout.questionMessage&&questionControl}
          {task.recovery?.state==='retrying'&&<CxNotice>로그인 상태를 다시 확인합니다. ({task.recovery.attempt}회)</CxNotice>}
          {['paused','interrupted'].includes(task.state)&&<p className="nubi-muted">{task.error==='work_plan_invalid'?'계획 응답을 확인하지 못해 멈췄어요. 요청과 기록은 보관했습니다.':'진행 내용을 저장했어요. 현재 파일을 확인하고 이어갑니다.'}</p>}
          {launchingTask?.id===taskId&&!running&&<p className="nubi-launch-progress" role="status"><ResponseTime timing={launchingTask} label="진행" live/></p>}
          <div className="nubi-task-actions">
            {provider?.connected&&!running&&!submitting&&launchingTask?.id!==taskId&&!task.question&&!connectionRequest&&['draft','ready','paused','failed','interrupted','cancelled'].includes(task.state)&&<ActionButton action="refresh" iconOnly={false} visibleLabel={task.state==='draft'?'시작':'이어서 진행'} label={task.state==='draft'?'시작':'이어서 진행'} title={task.state==='draft'?'시작':'이어서 진행'} disabled={busy||running} onClick={()=>perform(async()=>{await launchTask(taskId,()=>api(['paused','failed','interrupted'].includes(task.state)?'resumeAgent':'startAgent',{taskId}));await refresh();})}/>}
          </div>
          <AppliedFileChanges api={api} taskId={taskId} receipts={appliedProposals} onOpen={(row,options)=>openPath(row.path,taskId,{...options,expectedHash:row.hash,revealInExplorer:true})}/>
          <WorkspaceInputs kind="steer" task={task} busy={busy||inputBusy} onAction={inputAction} onEdit={editInput} onSource={source=>openAnswerSource({...source,kind:'mail'})}/>
        </div></div></div>{conversationScroll.away&&<CxButton className="nubi-jump-latest" aria-label="최신 메시지로 이동" title="최신 메시지로 이동" onClick={conversationScroll.followLatest}><Icon name="arrowDown" size={18}/></CxButton>}</div>
          <div className="composer-stack nubi-followup-stack"><WorkspaceInputs task={task} busy={busy||inputBusy} onAction={inputAction} onEdit={editInput} onSource={source=>openAnswerSource({...source,kind:'mail'})}/>
          {!task.question&&!connectionRequest&&<WorkspaceComposer commandApi={api} taskId={taskId} onCommand={runComposerCommand} onMinimumWidth={setMinimumAgentWidth} className="nubi-compose-card nubi-followup" onStop={running?()=>perform(async()=>{await api('stopAgent',{taskId});await refresh();}):undefined} modelControl={<><WorkspaceSkillMenu api={api} taskId={taskId} onSelect={addSkillToDraft} onMarketplace={hostLayout==='integrated'?trigger=>openSkillPanel('marketplace',trigger):undefined} onManage={trigger=>openSkillPanel('installed',trigger)}/>{modelPicker}{reasoningControl}</>} contextControl={contextMeter} actionControl={approvalControl} evidenceControl={mailEvidence} onSubmit={submit} id="followup" inputRef={composer} value={request} onChange={e=>setRequest(e.target.value)} placeholder={running?"추가 메시지 입력":"이어서 요청해 주세요"} aria-label="추가 요청" title={running?"Enter로 대기열에 추가, Shift+Enter로 줄바꿈":""} sending={submitting} sendDisabled={submitting||!provider?.connected||!request.trim()||busy||inputBusy||!!task.question||!!connectionRequest}/>}</div>


      </section>}
    </main>
    </>}
    </div></div>
    {panel==='changes'&&nativeChanges&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('columns','Git 변경')} variant="modal" onClose={()=>setPanel(null)}><div className="nubi-git-changes"><span className="nubi-muted">{nativeChanges.branch}</span>{nativeChanges.entries.map(entry=><CxButton className="nubi-git-change" key={entry.path} disabled={busy} onClick={()=>perform(async()=>setNativePatch(await api('workspaceChanges',{path:entry.path})))}><Icon name="file" size={16}/><span>{entry.path}</span><small>{({untracked:'새 파일',deleted:'삭제',added:'추가',modified:'수정'})[entry.state]}</small></CxButton>)}{!nativeChanges.entries.length&&<GitEmptyState/>}{nativeChanges.truncated&&<p className="nubi-muted">변경이 많아 일부 파일만 표시합니다.</p>}{nativePatch&&<section><strong>{nativePatch.path}</strong>{nativePatch.state!=='deleted'&&<CxButton onClick={()=>{setPanel(null);perform(()=>openPath(nativePatch.path));}}><Icon name="file" size={16}/>파일 열기</CxButton>}{nativePatch.patch!==null&&<pre className="nubi-git-patch">{nativePatch.patch||'현재 변경이 없어요.'}</pre>}{nativePatch.patchTruncated&&<p className="nubi-muted">변경 내용의 일부만 확인했습니다.</p>}{nativePatch.state==='untracked'&&<p className="nubi-muted">새 파일은 파일을 열어 내용을 확인하세요.</p>}</section>}</div></DetailPanel>}
    {DESKTOP_FEATURES.computerUse&&panel==='computer'&&task&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('app','앱 연결')} variant="modal" onClose={()=>{setPanel(null);requestAnimationFrame(()=>appButton.current?.focus());}}>
      {connectionRequest?<ComputerConnectionForm key={connectionRequest.id} request={connectionRequest} taskId={taskId} state={project.computer} api={api} refresh={refresh} disabled={busy||running}/>:<ComputerUse expanded showActions={false} key={taskId} taskId={taskId} state={project.computer} api={api} refresh={refresh} disabled={busy||running||!!task.question||task.state==='cancelled'}/>}
    </DetailPanel>}
    {panel==='manual'&&task&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('terminal','실행과 비교')} variant="modal" onClose={()=>{if(panelOrigin.current)returnToPanel();else closePanel(settingsButton);}}>
      {panelBack}

          <form className="nubi-run-form" onSubmit={e=>{e.preventDefault();perform(async()=>{setProcessResult(await api('run',{taskId,script,profile:effectiveShell,timeoutMs:timeoutSeconds*1000,autoDiagnose}));setPanel(null);await refresh();});}}><label htmlFor="run-command"><TerminalMark/>명령 실행</label><div className="nubi-inline"><CxInput id="run-command" value={script} onChange={e=>setScript(e.target.value)} placeholder="예: npm run dev -- --port 5174"/><CxSelect aria-label="셸" value={effectiveShell} onChange={e=>setShell(e.target.value)}>{project.profiles.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</CxSelect><CxButton type="submit" variant="primary" disabled={!script.trim()||!effectiveShell||busy}><Icon name="arrowRight" size={16}/>실행</CxButton></div><small>{task.workspace?'별도 작업 공간에서 실행합니다.':'현재 프로젝트 폴더에서 실행합니다.'}</small></form>
          <DeckDisclosure title={task.workspace?'별도 작업 공간 준비됨':'별도 작업 공간'} icon="file"><p>마지막 커밋으로 만들며 커밋하지 않은 변경은 원래 폴더에 남습니다.</p>{!task.workspace?<CxButton disabled={busy} onClick={()=>perform(async()=>{await api('createWorktree',{taskId});await refresh();})}><Icon name="plus" size={16}/>작업 공간 만들기</CxButton>:<code>{task.workspace}</code>}</DeckDisclosure>
          <DeckDisclosure title="실행 설정" icon="sliders"><CxCheckbox label="실행 후 AI가 결과 확인" checked={autoDiagnose} onChange={e=>setAutoDiagnose(e.target.checked)}/><label className="nubi-recovery-option"><span>실행 시간 제한 (초)</span><CxInput aria-label="실행 시간 제한 (초)" type="number" min={0} max={86400} value={timeoutSeconds} onChange={e=>setTimeoutSeconds(Number(e.target.value))}/></label><p className="nubi-muted">0은 시간 제한 없이 실행합니다.</p></DeckDisclosure>
          <DeckDisclosure title="화면 비교" icon="columns"><form className="nubi-compare-form" onSubmit={e=>{e.preventDefault();perform(async()=>{setComparison(await api('compare',{taskId,beforeUrl,afterUrl}));setPanel(null);});}}><div className="nubi-url-pair"><label>변경 전<CxInput value={beforeUrl} onChange={e=>setBeforeUrl(e.target.value)} placeholder="http://localhost:5173"/></label><label>변경 후<CxInput value={afterUrl} onChange={e=>setAfterUrl(e.target.value)} placeholder="http://localhost:5174"/></label></div><CxButton type="submit" variant="primary" busy={busy} disabled={!beforeUrl||!afterUrl||busy}><Icon name="columns" size={16}/>비교</CxButton></form></DeckDisclosure>
    </DetailPanel>}
    {panel==='wiki-progress'&&<DetailPanel title="위키 준비" variant="modal" className="deck-dialog nubi-panel nubi-wiki-progress-dialog" hideHelp onClose={()=>setPanel(null)} footer={<><CxButton onClick={()=>setPanel(null)}><Icon name={wikiInitialization?.state==='running'?'minimize':'xClose'} size={18}/>{wikiInitialization?.state==='running'?'백그라운드로':'닫기'}</CxButton>{wikiInitialization?.state==='running'&&<CxButton onClick={()=>api('wikiInitialization',{action:'cancel'}).catch(error=>showError(failure(error)))}><Icon name="xClose" size={18}/>중지</CxButton>}{['attention','cancelled'].includes(wikiInitialization?.state)&&<CxButton variant="primary" onClick={()=>api('wikiInitialization',{action:'retry'}).catch(error=>showError(failure(error)))}><Icon name="refresh" size={18}/>다시 시도</CxButton>}</>}><WikiInitializationProgress job={wikiInitialization}/></DetailPanel>}
    {panel==='claude'&&<ClaudeConnection initialIssue={claudeIssue} api={api} onConnected={async()=>{await refreshProvider();returnToPanel();}} onClose={returnToPanel} openWebPage={openWebPage}/>}
    {panel==='models'&&<ModelSelection title={panelTitle('list','모델 선택')} data={modelData} autoRefresh={false} selectWhileLoading showProviderNames providerLabels={providerLabels} disabled={submitting||!!activeTask||busy} loading={catalogLoading===provider?.provider} onError={showError} onProviderSelect={selected=>modelAction('select',{provider:selected})} onSelect={model=>modelAction('model',{model})} onRefresh={refreshCatalog} onLogin={login} onLogout={selected=>modelAction('disconnect',{provider:selected})} onCancelLogin={()=>modelAction('cancel')} onClose={closeModels}/>}
    {panel==='fabrix'&&<FabrixConnection title={panelTitle('logIn','FabriX 연결')} rpc={fabrixRpc} showActionLabels onError={showError} onNotice={notifyWorkspaceToast} requestPermission={()=>Promise.resolve(true)} onClose={returnToPanel} onConnected={async()=>{await refreshProvider();returnToPanel();}}/>}
    {panel==='mail'&&<DetailPanel className="deck-dialog nubi-panel" title={panelTitle('mail','메일 설정')} variant="modal" onClose={()=>panelOrigin.current?returnToPanel():closePanel(mailButton)}>{panelBack}<MailLibrary api={api} provider={provider} onProviderLogin={login} onProviderAction={modelAction} providerBusy={busy||!!activeTask} openWebPage={openWebPage?async url=>{await openWebPage(url);setPanel(null);}:undefined}/></DetailPanel>}
    {panel==='analysis-history'&&task&&<DetailPanel variant="modal" className="deck-dialog nubi-panel" title={panelTitle('clock','작업 기록')} onClose={()=>setPanel(null)}><AnalysisHistory api={api} task={task} showHistory/></DetailPanel>}
    <WorkspaceUpdateProgress update={workspaceUpdate}/>
    {panel==='settings'&&<DetailPanel className="deck-dialog nubi-panel" title={panelTitle('sliders','설정')} variant="modal" onClose={()=>closePanel(settingsButton)}><div className="nubi-settings">{project?<div className="nubi-settings-field"><label htmlFor="nubi-default-shell"><TerminalMark size={18}/>기본 터미널</label><CxSelect id="nubi-default-shell" value={project.defaultShell||''} disabled={busy||!!activeTask} onChange={e=>perform(async()=>{await api('setShellPreference',{profile:e.target.value});setShell('');await refresh();})}>{project.profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.label}</option>)}</CxSelect></div>:<p className="nubi-muted">프로젝트를 열면 기본 터미널을 설정할 수 있어요.</p>}{task&&<CxButton onClick={()=>setPanel('analysis-history')}><Icon name="clock" size={16}/>작업 기록</CxButton>}<WorkspaceUpdate update={workspaceUpdate} onInstall={installUpdate}/></div></DetailPanel>}
    {panel==='usage'&&<UsagePanel data={usageData} providerLabels={providerLabels} afterAccount={<ClaudeAccountUsage data={usageData}/> } loadAccountUsage={loadAccountUsage} scopeLabel="이 앱에서 사용한 토큰" onClose={()=>closePanel(usageButton)}/>}
    {panel==='history'&&<DetailPanel className="deck-dialog nubi-panel" title={panelTitle('search','대화 검색')} variant="modal" initialFocus="#nubi-conversation-search" onClose={()=>closePanel(historyTrigger)}>
      <ConversationSearch api={api} projectId={project?.projectId} taskId={taskId} busy={busy} onSelect={id=>perform(async()=>{const selected=await api('conversationHistory',{taskId:id});setProject(current=>({...current,tasks:[selected,...current.tasks.filter(item=>item.id!==id)]}));selectSession(id);setPanel(null);if(compact)setSidebarOpen(false);requestAnimationFrame(()=>composer.current?.focus());})}/>

    </DetailPanel>}
    {panel==='skills'&&<DetailPanel className="deck-dialog nubi-panel nubi-skill-dialog" title={panelTitle('layers','스킬 관리')} variant="modal" onClose={()=>{if(panelOrigin.current)returnToPanel();else closePanel(skillsPanelTrigger.current?.isConnected?skillsPanelTrigger:skillsButton);}}>{panelBack}<SkillLibrary key={`${project?.projectId}-${taskId||'root'}-${skillTab}-${skillRevision}`} api={api} taskId={taskId} openPath={file=>{flushSync(()=>setPanel(null));return perform(()=>openPath(file));}} onRegister={registerSkill} marketplaceEnabled={hostLayout==='integrated'} connectMarketplace={connectMarketplace&&connectCompanyMarketplace}  initialTab={skillTab}/></DetailPanel>}
    {panel==='skill-import'&&<DetailPanel className="deck-dialog nubi-panel nubi-skill-register-dialog" title={panelTitle('layers','스킬 등록')} variant="modal" onClose={closeSkillRegistration}><SkillRegistration api={api} taskId={taskId} onBusy={setSkillImportBusy} onRegistered={skillRegistered}/></DetailPanel>}
    {panel==='library'&&<DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title={panelTitle('bookmark','프로젝트 자료')} variant="modal" onClose={()=>closePanel(libraryButton)}>{renderLibrary()}</DetailPanel>}
  </div>;
  function openLibraryPath(file){if(actionLock.current)return;flushSync(()=>setPanel(null));return perform(()=>openPath(file,taskId||undefined));}
  function renderLibrary(){return <div className="nubi-library">{wikiInitialization&&<DeckDisclosure title={({waiting_model:'위키 모델 연결 대기',waiting_source:'프로젝트를 선택해 주세요',running:'위키 준비 중',completed:'위키 준비 완료',existing:'기존 위키 유지',attention:'위키 확인 필요',cancelled:'위키 중지됨'})[wikiInitialization.state]||'위키'} icon="bookmark"><WikiInitializationProgress job={wikiInitialization}/>{wikiInitialization.state==='running'&&<CxButton onClick={()=>perform(()=>api('wikiInitialization',{action:'cancel'}))}><Icon name="xClose" size={16}/>중지</CxButton>}{['attention','cancelled'].includes(wikiInitialization.state)&&<CxButton onClick={()=>perform(()=>api('wikiInitialization',{action:'retry'}))}><Icon name="refresh" size={16}/>다시 시도</CxButton>}</DeckDisclosure>}<CxButton className="nubi-settings-row" data-panel-link="mail" onClick={()=>{setPanel(null);setMailPage(true);}}><span className="nubi-settings-row-icon" aria-hidden="true"><Icon name="mail" size={18}/></span><span>사내 메일</span><Icon name="arrowRight" size={16}/></CxButton>{/* OpenWiki only for now (user decision 2026-09-30): search, the Wiki's state, its pages and the task record. */}<form className="nubi-search" role="search" onSubmit={e=>{e.preventDefault();perform(async()=>{const run=++searchRun.current;setSearch(null);setWikiSearch(null);const args={query,taskId:taskId||undefined},results=await Promise.allSettled([api('search',args),api('wikiQuery',args)]);if(run!==searchRun.current||!mounted.current)return;if(results[0].status==='fulfilled')setSearch(results[0].value);if(results[1].status==='fulfilled')setWikiSearch(results[1].value);if(results.some(result=>result.status==='rejected'))setError('일부 검색을 완료하지 못했어요. 확인된 결과를 표시합니다.');});}}><CxInput value={query} onChange={e=>setQuery(e.target.value)} placeholder="파일 내용과 위키 검색" aria-label="프로젝트 검색"/><ActionButton action="search" label="검색" type="submit" disabled={!query.trim()||busy}/></form>{wikiSearch&&<WikiEvidence packet={wikiSearch} onOpen={openLibraryPath}/>}{search&&<section className="nubi-code-results" aria-label="코드 검색 결과"><h3><Icon name="code" size={16}/>코드 {search.results.length}개{search.truncated?' (일부 파일만 확인)':''}</h3>{search.results.map((hit,i)=><CxButton className="nubi-search-result" key={i} onClick={()=>openLibraryPath(hit.path)}><Icon name="file" size={16}/><span className="nubi-result-head"><DriftLabel as="strong">{hit.path}</DriftLabel><span className="nubi-pill nubi-pill-mono">{hit.line}행</span></span><code className="nubi-code-excerpt">{hit.excerpt}</code></CxButton>)}</section>}{project&&<WikiUpdate key={project.projectId} api={api} openPath={openLibraryPath} initialization={wikiInitialization} onApplied={refresh}/>}<DeckDisclosure title={project?.wikiFiles.length?`위키 ${project.wikiFiles.length}개`:'위키 문서'} icon="bookmark">{project?.wikiFiles.slice(0,50).map(file=><CxButton className="nubi-file-link" key={file} onClick={()=>openLibraryPath(file)}><Icon name="file" size={14}/><DriftLabel>{file}</DriftLabel></CxButton>)}{!project?.wikiFiles.length&&<p className="nubi-muted">아직 위키 문서가 없어요.</p>}</DeckDisclosure>{task&&<section className="nubi-knowledge-record"><div><h2>작업을 위키에 남기기</h2><DeckStatus>{({none:'아직 기록 없음',matching:'기록과 일치',outdated:'갱신 필요',edited:'문서 직접 수정됨',missing:'문서 확인 필요'})[knowledge?.state]||'확인 중'}</DeckStatus></div><p className="nubi-muted">요청과 실행 결과를 새 버전으로 저장합니다.</p><div className="nubi-task-actions"><CxButton variant="primary" disabled={busy||running} onClick={()=>perform(async()=>{const value=await api('recordKnowledge',{taskId});await refresh();setKnowledge(await api('knowledgeStatus',{taskId}));showNotice(value.noChange?'기록이 이미 최신이에요.':'위키에 새 기록을 남겼어요.');})}><Icon name="save" size={16}/>{knowledge?.record?'기록 갱신':'위키에 기록'}</CxButton>{knowledge?.record&&<ActionButton action="openExternal" label="기록 열기" onClick={()=>openLibraryPath(knowledge.record.path)}/>}<ActionButton action="refresh" label="다시 확인" disabled={busy} onClick={()=>perform(async()=>setKnowledge(await api('knowledgeStatus',{taskId})))}/></div>{knowledge?.sources?.some(source=>source.state!=='matching')&&<p className="nubi-muted">원본이 바뀌었거나 읽을 수 없어요. 기록에 함께 표시합니다.</p>}</section>}</div>;}
}
