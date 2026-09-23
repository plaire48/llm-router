import {A2AInbox} from './A2AInbox.jsx';
import {visionModelFor} from '../model-routing.js';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {CxAppShell, CxButton, CxNotice, DetailPanel, ActionButton, Icon, notifyToast} from '@e2e/cx-design-system';
import {ERROR_TEXT, MODEL_CATALOG_VERSION, PAGE_ORIGINS, PROVIDER_LABELS} from '../core.js';
import {fetchModels} from './api.js';
import {ContextMeter, ModelPicker, ModelSelection} from './ChatControls.jsx';
import {providerSession} from '../provider-sessions.js';
import {UsagePanel} from './UsagePanel.jsx';
import {ConversationHistory} from './ConversationHistory.jsx';
import {HelpContent} from './HelpContent.jsx';
import {DeckSectionLabel} from './DeckSurfaces.jsx';
import {AgentTabs} from './AgentTabs.jsx';
import {Welcome} from './Welcome.jsx';
import {NubiHeaderActions, NubiLogin, NubiComposerInput, NubiComposerBar} from './NubiSurfaces.jsx';
import {AgentMark, NubiLogo} from './AgentMark.jsx';
import {FabrixConnection} from './FabrixConnection.jsx';
import {ProjectConnection} from './ProjectConnection.jsx';
import {WikiFolderSettings} from './WikiFolderSettings.jsx';
import {CopyButton} from './CopyButton.jsx';
import {MessageBody} from './MessageBody.jsx';
import {ActionApproval} from './ActionApproval.jsx';
import {prepareFiles} from './document-parser.js';
import {AttachmentList, AttachmentPicker} from './Attachments.jsx';
import {clipboardAttachments} from '../attachments.js';
import {CaptureGallery} from './CaptureGallery.jsx';
import {AmbientScene, useIdleExpression, useMotionPreference} from './Atmosphere.jsx';
import {allSkills, browserTools, automaticSkillTools, taskSkillId} from '../skills.js';
import {skillLibrary, skillCatalog, skillLibraryTools} from '../skill-library.js';
import {SkillPicker, FillReview} from './Skills.jsx';
import {AgentTrace} from './AgentTrace.jsx';
import {taskProgress} from '../task-plan.js';
import {TaskPlan} from './TaskPlan.jsx';
import {createStateSync} from '../state-sync.js';

const clientId = crypto.randomUUID();
const manifest = chrome.runtime.getManifest();
const displayVersion = manifest.version_name || manifest.version;
async function rpc(type, value = {}) {
  const response = await chrome.runtime.sendMessage({type, ...value, clientId});
  if (!response?.ok) throw new Error(response?.error || 'storage_failed');
  return response.data;
}
const errorText = code => ERROR_TEXT[code] || '처리하지 못했습니다. 다시 시도하세요.';

export default function App() {
  const [a2aOpen,setA2AOpen]=useState(false);
  const motion = useMotionPreference();
  const [data, setData] = useState(null), [settingsOpen, setSettingsOpen] = useState(['#settings', '#settings-wiki'].includes(location.hash));
  const [stateStatus, setStateStatus] = useState({paused: false, reload: false});
  const stateSync = useRef(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpReturnFocus = useRef(false);
  const [draft, setDraft] = useState(''), [error, setError] = useState('');
  const [attachmentBusy, setAttachmentBusy] = useState(false), [fileDrag, setFileDrag] = useState(false);
  const [connectingPage, setConnectingPage] = useState(false);
  const pageAction = useRef(false);
  const [starting, setStarting] = useState(false);
  const working = starting || !!data?.busy;
  const partial = data?.agentRun?.partial || '';
  const replyPhase = data?.agentRun?.phase || 'waiting';
  const fillReview = data?.agentRun?.fillReview;
  const [usageOpen, setUsageOpen] = useState(false);
  const [welcomeAnimated, setWelcomeAnimated] = useState(false);
  const [fabrixInitial, setFabrixInitial] = useState(null);
  const [projectOpen, setProjectOpen] = useState(false), [projectBusy, setProjectBusy] = useState(false);
  const [wikiSectionOpen, setWikiSectionOpen] = useState(location.hash === '#settings-wiki');
  const [wikiServerOpen, setWikiServerOpen] = useState(false);
  const projectReturnSettings = useRef(false), projectReturnFocus = useRef(false);
  const [modelsOpen, setModelsOpen] = useState(false), [modelProvider, setModelProvider] = useState('aipro');
  const fabrixReturn = useRef(false), loginRequested = useRef(null), accountPicker = useRef(false);
  const trace = data?.agentRun?.trace || [];
  const [historyOpen, setHistoryOpen] = useState(false), [showLogin, setShowLogin] = useState(false), [switching, setSwitching] = useState(false);
  const historyComposerFocus = useRef(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const switchingRef = useRef(false);
  const [modelsLoading, setModelsLoading] = useState(false), [away, setAway] = useState(false);
  const initialized = useRef(false), draftTimer = useRef(null);
  const lastAuth = useRef(null), list = useRef(null), textarea = useRef(null);
  const catalogAbort = useRef(null), catalogVersion = useRef(0), followReply = useRef(true);
  const validAuth = data?.auth.present && !data.auth.expired && !data.auth.rejected;
  const resting = useIdleExpression(working || !!data?.busy || !!data?.pending);
  const latestReply = data?.chat.messages.findLast(message => message.role === 'assistant');
  const mascotMood = working || data?.busy || data?.pending ? 'working' : resting === 'sleep' ? 'sleep' : !showLogin && latestReply?.state === 'error' && latestReply.error !== 'cancelled' ? 'sad' : validAuth && latestReply?.error !== 'cancelled' ? 'done' : 'idle';
  const brand = <CxButton className="brand-home" aria-label="누비 새 채팅" title="새 채팅" disabled={!data || working || switching || !!data?.busy || !!data?.pending || accountBusy}
    onClick={() => changeConversation('NEW_CHAT').then(() => requestAnimationFrame(() => textarea.current?.focus())).catch(e => setError(errorText(e.message)))}><NubiLogo mood={mascotMood}/></CxButton>;

  const refresh = () => stateSync.current?.refresh();
  const applyState = next => {
    const authenticated = next.auth.present && !next.auth.expired && !next.auth.rejected;
    if (lastAuth.current === false && authenticated) {setSettingsOpen(false); setShowLogin(false); setError('');}
    if (loginRequested.current?.provider === next.auth.provider && authenticated && !next.pending && next.auth.receivedAt !== loginRequested.current.receivedAt) {
      loginRequested.current = null; setModelsOpen(false); setShowLogin(false); setError('');
    }
    lastAuth.current = authenticated;
    setData(next);
    if (initialized.current !== next.chat.sessionId) {
      clearTimeout(draftTimer.current); setDraft(next.chat.draft || ''); initialized.current = next.chat.sessionId;
      followReply.current = true; setAway(false);
    }
  };
  useEffect(() => {
    const sync = createStateSync({read: () => rpc('GET_STATE'), onData: applyState, onStatus: setStateStatus, visible: () => !document.hidden});
    stateSync.current = sync; void sync.refresh();
    const changed = (_changes, area) => {if (['session', 'local'].includes(area)) sync.invalidate();};
    const visible = () => {if (!document.hidden) sync.invalidate();};
    chrome.storage.onChanged.addListener(changed);
    document.addEventListener('visibilitychange', visible);
    return () => {sync.dispose(); stateSync.current = null; chrome.storage.onChanged.removeListener(changed); document.removeEventListener('visibilitychange', visible); clearTimeout(draftTimer.current); catalogAbort.current?.abort();};
  }, []);
  useEffect(() => {
    if (followReply.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [partial, data?.chat.messages]);
  useEffect(() => {
    if (historyOpen || switching || !historyComposerFocus.current) return;
    // Wait for the dialog's inert layer and focus restoration to finish.
    const frame = requestAnimationFrame(() => {textarea.current?.focus(); historyComposerFocus.current = false;});
    return () => cancelAnimationFrame(frame);
  }, [historyOpen, switching]);
  useLayoutEffect(() => {
    if (textarea.current) {textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 180)}px`;}
  }, [draft, validAuth]);
  useEffect(() => {
    if (settingsOpen && !helpOpen && helpReturnFocus.current) {
      helpReturnFocus.current = false;
      const trigger = document.querySelector('.settings-dialog [data-action="help"]');
      trigger?.focus();
      // On return, Escape exits settings even if focus has opened the icon tooltip.
      const dismiss = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation(); setSettingsOpen(false); setError('');
      };
      trigger?.addEventListener('keydown', dismiss);
      return () => trigger?.removeEventListener('keydown', dismiss);
    }
  }, [settingsOpen, helpOpen]);
  useEffect(() => {
    if (settingsOpen && projectReturnFocus.current) {
      projectReturnFocus.current = false;
      const trigger = document.querySelector('.wiki-server-settings [aria-label="프로젝트 연결"]');
      trigger?.focus();
      const dismiss = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation(); setSettingsOpen(false); setError('');
      };
      trigger?.addEventListener('keydown', dismiss);
      return () => trigger?.removeEventListener('keydown', dismiss);
    }
  }, [settingsOpen]);
  useEffect(() => {
    if (validAuth) loadModels(data.auth.receivedAt);
    return () => {catalogVersion.current++; catalogAbort.current?.abort();};
  }, [validAuth, data?.auth.receivedAt]);

  async function loadModels(credentialReceivedAt, force = false, feedback = force) {
    const version = ++catalogVersion.current;
    catalogAbort.current?.abort();
    try {
      const latest = await rpc('GET_STATE');
      if (version !== catalogVersion.current || latest.auth.receivedAt !== credentialReceivedAt) return false;
      if (!force && latest.catalog?.requestVersion === MODEL_CATALOG_VERSION && Date.now() - latest.catalog.fetchedAt < 300000) {setModelsLoading(false); return !latest.catalog.error;}
      const abort = new AbortController(); catalogAbort.current = abort;
      setModelsLoading(true);
      const timeout = setTimeout(() => abort.abort('timeout'), 12000);
      try {
        const {payload, status} = await fetchModels(credentialReceivedAt, abort.signal);
        if (version === catalogVersion.current) {
          const saved = await rpc('SAVE_MODELS', {credentialReceivedAt, payload, status});
          if (feedback && saved?.catalog?.models?.length && !saved.catalog.error) notifyToast('모델 목록을 불러왔습니다.');
          return !!saved?.catalog && !saved.catalog.error;
        }
      } catch (e) {
        if (version === catalogVersion.current) await rpc('SAVE_MODELS', {credentialReceivedAt, error: e.message, status: e.status});
        return false;
      } finally {clearTimeout(timeout);}
    } catch (e) {if (version === catalogVersion.current) setError(errorText(e.message)); return false;}
    finally {if (version === catalogVersion.current) {setModelsLoading(false); await refresh();}}
  }
  async function action(type, value = {}) {
    const pageChange = type === 'CONNECT_PAGE' || type === 'DISCONNECT_PAGE';
    if (pageChange && pageAction.current) return false;
    if (pageChange) {pageAction.current = true; setConnectingPage(true);}
    setError('');
    try {
      if (type === 'CONNECT_PAGE' && !await chrome.permissions.request({origins: PAGE_ORIGINS})) throw new Error('page_permission');
      await rpc(type, value); await refresh();
      const feedback = {CONNECT_PAGE: '페이지를 연결했습니다.', DISCONNECT_PAGE: '페이지 연결을 해제했습니다.', SAVE_SKILL: '스킬을 저장했습니다.', DELETE_SKILL: '스킬을 삭제했습니다.', LOGOUT: '연결을 해제했습니다.', NEW_CHAT: '새 대화를 시작했습니다.'};
      if (type === 'SELECT_MODEL' && value.name !== data.settings.modelId) notifyToast('모델을 적용했습니다.');
      else if (type === 'SELECT_SKILL' && value.id !== data.activeSkillId) notifyToast(value.id ? '스킬을 적용했습니다.' : '스킬 선택을 해제했습니다.');
      else if (feedback[type]) notifyToast(feedback[type]);
      return true;
    }
    catch (e) {setError(errorText(e.message)); return false;}
    finally {if (pageChange) {pageAction.current = false; setConnectingPage(false);}}
  }
  async function disconnectProject() {
    if (working || switching || data.busy || data.pending || accountBusy || projectBusy) return;
    setProjectBusy(true); setError('');
    try {await rpc('PROJECT_DISCONNECT'); await refresh(); notifyToast('프로젝트 연결을 해제했습니다.');}
    catch (cause) {setError(errorText(cause.message));}
    finally {setProjectBusy(false);}
  }
  function openServerProject(fromSettings = false) {
    projectReturnSettings.current = fromSettings;
    if (fromSettings) {setSettingsOpen(false); setWikiSectionOpen(true); setWikiServerOpen(true);}
    setProjectOpen(true);
  }
  function closeServerProject() {
    setProjectOpen(false);
    if (projectReturnSettings.current) {projectReturnSettings.current = false; projectReturnFocus.current = true; setSettingsOpen(true);}
  }
  function openModels(provider = data.activeProvider, fromSettings = false) {accountPicker.current = fromSettings; setModelProvider(provider); setModelsOpen(true); setError('');}
  function closeModels() {
    setModelsOpen(false);
    if (accountPicker.current) {
      accountPicker.current = false;
      requestAnimationFrame(() => document.querySelector('.cx-kit-topbar [data-action="more"]')?.focus());
    }
  }
  async function flushDraft() {
    clearTimeout(draftTimer.current);
    await rpc('DRAFT', {value: draft, provider: data.activeProvider, conversationId: data.chat.sessionId});
  }
  async function disconnectProvider(provider) {
    if (accountBusy || projectBusy || working || switching || data.busy || data.pending) throw new Error('busy');
    setAccountBusy(true); clearTimeout(draftTimer.current);
    try {
      await flushDraft();
      await rpc('LOGOUT', {provider}); loginRequested.current = null;
      setShowLogin(false); await refresh(); notifyToast(`${PROVIDER_LABELS[provider]} 연결을 해제했습니다.`);
    }
    finally {setAccountBusy(false);}
  }
  async function accountAction() {
    try {if (data.auth.present) await disconnectProvider(data.activeProvider); setSettingsOpen(false); openModels(data.activeProvider, true);}
    catch (cause) {setError(errorText(cause.message));}
  }
  function updateDraft(value) {
    setDraft(value); clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => rpc('DRAFT', {value, provider: data.activeProvider, conversationId: data.chat.sessionId}).catch(e => setError(errorText(e.message))), 200);
  }
  async function changeConversation(type, value = {}) {
    if (attachmentBusy || switchingRef.current || working || data.busy || data.pending || projectBusy) throw new Error('busy');
    switchingRef.current = true; setSwitching(true); clearTimeout(draftTimer.current);
    try {
      if (draft !== data.chat.draft) await rpc('DRAFT', {value: draft, provider: data.activeProvider, conversationId: data.chat.sessionId});
      await rpc(type, {...value, conversationId: data.chat.sessionId});
      setShowLogin(false); setError(''); await refresh();
      if (type === 'NEW_CHAT') notifyToast('새 대화를 시작했습니다.');
      if (type === 'RENAME_CONVERSATION') notifyToast('대화 이름을 변경했습니다.');
      if (type === 'DELETE_CONVERSATION') notifyToast('대화를 삭제했습니다.');
    } finally {switchingRef.current = false; setSwitching(false);}
  }
  async function login(provider) {
    if (working || switchingRef.current || accountBusy || projectBusy || data.busy) throw new Error('busy');
    setSettingsOpen(false); setError('');
    try {
      await flushDraft();
      loginRequested.current = {provider, receivedAt: data.connections?.[provider]?.receivedAt};
      await rpc('START_LOGIN', {provider}); await refresh();
    } catch (cause) {loginRequested.current = null; setError(errorText(cause.message)); throw cause;}
  }
  async function openFabrix(fromPicker = false) {
    try {
      await flushDraft();
      const {credential} = providerSession(await chrome.storage.session.get(['credential', 'providerSessions']), 'fabrix');
      setFabrixInitial({...data.fabrixConnection, ...(credential?.provider === 'fabrix' ? credential : {})});
      fabrixReturn.current = fromPicker === true; setModelsOpen(false); setSettingsOpen(false);
    } catch {setError(errorText('storage_failed'));}
  }
  async function attachInputFiles(files, source = 'user-file') {
    if (attachmentBusy || working || switchingRef.current || data.busy || data.pending) return;
    setAttachmentBusy(true); setError('');
    try {await addFiles(await prepareFiles(files, data.chat.draftAttachments?.length || 0, source));}
    catch (error) {setError(errorText(error.message));}
    finally {setAttachmentBusy(false);}
  }
  function pasteFiles(event) {
    const files = clipboardAttachments(event.clipboardData);
    if (!files) return;
    event.preventDefault(); void attachInputFiles(files, 'user-paste');
  }
  async function addFiles(files) {
    setError('');
    await rpc('ATTACH_FILES', {files, conversationId: data.chat.sessionId, provider: data.activeProvider});
    await refresh();
  }
  async function removeFile(id) {
    try {
      setError(''); await rpc('REMOVE_ATTACHMENT', {id, conversationId: data.chat.sessionId, provider: data.activeProvider}); await refresh();
    } catch (error) {setError(errorText(error.message));}
  }
  async function send(retry = false, compact = false, resume = false, choice = null, draftEdit = null) {
    const command = !draftEdit && !choice && !retry && draft.trim() === '/compact';
    compact = compact || command || (retry && !resume && data.chat.messages.at(-1)?.contextOnly === true);
    if (!validAuth || attachmentBusy || switchingRef.current || working || data.busy || data.pending || accountBusy || projectBusy || (!retry && !compact && !draft.trim() && !data.chat.draftAttachments?.length && !choice && !draftEdit)) return;
    textarea.current?.focus();
    clearTimeout(draftTimer.current); setError(''); setStarting(true); followReply.current = true; setAway(false);
    try {
      const resumeTask = retry && data.chat.task?.status === 'paused' ? data.chat.task : null;
      const skill = data.skills?.find(item => item.id === taskSkillId(resumeTask, data.activeSkillId));
      // Permission prompts require the user's send gesture, not a worker event.
      if (!compact && (!skill || skill.needsPage || skill.allowFill || data.page) && !(data.project?.status === 'connected' && data.project?.kind !== 'folder' && !skill && !data.page)) {
        const granted = await chrome.permissions.request({origins: PAGE_ORIGINS}).catch(() => false);
        if (!granted && !automaticSkillTools(skill)) throw new Error('page_permission');
      }
      if (compact) await rpc('DRAFT', {value: command ? '' : draft, provider: data.activeProvider, conversationId: data.chat.sessionId});
      if (choice || draftEdit) await flushDraft();
      await rpc('START_AGENT', {text: draft, retry, compact, resume, choice, draftEdit, conversationId: data.chat.sessionId});
      if ((!retry && !compact && !choice && !draftEdit) || command) setDraft('');
      await refresh();
      return true;
    } catch (e) {setError(errorText(e.message)); return false;}
    finally {setStarting(false); if (document.activeElement?.closest('.composer')) textarea.current?.focus();}
  }
  async function stop() {
    const requestId = data.agentRun?.requestId || data.chat.messages.findLast(message => message.state === 'pending')?.id;
    if (!requestId) return;
    try {await rpc('CANCEL_BROWSER', {requestId, conversationId: data.chat.sessionId}); await refresh();}
    catch (cause) {setError(errorText(cause.message));}
  }
  async function resolveFill(approved) {
    try {await rpc('RESOLVE_FILL', {requestId: data.agentRun.requestId, conversationId: data.chat.sessionId, planId: fillReview.planId, approved}); await refresh();}
    catch (cause) {setError(errorText(cause.message));}
  }
  async function diagnosticText() {
      const latest = await rpc('GET_STATE');
      const diagnostic = {product: 'nubi', version: displayVersion, extensionVersion: manifest.version, provider: latest.auth.provider, loginRoute: latest.settings.loginRoute, credentialMode: latest.auth.mode || latest.settings.mode, credentialReceived: latest.auth.present, credentialExpired: latest.auth.expired, apiAccepted: !!latest.auth.verifiedAt, modelsLoaded: latest.catalog?.models?.length ?? null, modelsError: latest.catalog?.error, modelsDiagnostics: latest.catalog?.diagnostics, stage: latest.report.stage, events: latest.events, authTrace: latest.authTrace};
      return JSON.stringify(diagnostic, null, 2);
  }
  const headerActions = <NubiHeaderActions
    history={{'aria-expanded':historyOpen,onClick:()=>setHistoryOpen(true)}}
    expand={validAuth && {onClick:()=>action('OPEN_TAB')}}
    usage={{'aria-expanded':usageOpen,onClick:()=>setUsageOpen(true)}}
    settings={{'aria-expanded':settingsOpen,onClick:()=>{setHelpOpen(false);setSettingsOpen(true);}}}/>;
  const stateRecovery = stateStatus.paused && <CxNotice tone="warning"><div className="connection-row state-recovery"><span>{data ? '진행 상태를 확인할 수 없습니다.' : '화면을 불러오지 못했습니다.'}</span><ActionButton action="refresh" iconOnly label={stateStatus.reload ? '확장 화면 다시 열기' : '진행 상태 다시 확인'} onClick={() => stateStatus.reload ? location.reload() : stateSync.current?.resume()}/></div></CxNotice>;
  if (!data) return <CxAppShell brand={brand}>{stateRecovery || <span className="status-spinner loading" role="status" aria-label="불러오는 중"/>}</CxAppShell>;
  const loginError = error || (data.auth.expired ? '로그인이 만료되었습니다.' : data.auth.rejected ? '다시 로그인해 주세요.' : data.report.error && data.report.error !== 'login_closed' ? errorText(data.report.error) : '');
  const isEmpty = !data.chat.messages.length;
  const showChat = validAuth || (!showLogin && !isEmpty);
  const noModels = data.catalog?.models?.length === 0 && !data.catalog.error;
  const selectedModel = data.catalog?.models?.find(model => model.name === data.settings.modelId) || {name: data.settings.modelId};
  const draftAttachments = data.chat.draftAttachments || [];
  const visionModel = visionModelFor(data.activeProvider, selectedModel, data.catalog?.models);
  const imageBlocked = draftAttachments.some(file => file.kind === 'image') && !visionModel;
  const selectedSkill = data.skills?.find(skill => skill.id === data.activeSkillId);
  const effectiveSkill = selectedSkill || allSkills().find(skill => skill.id === 'browser-agent');
  const serverProject = data.wikiFolder ? null : data.serverProject;
  const workflowLibrary = skillLibrary(data.skills?.filter(item => item.id.startsWith('custom-')), {selectedSkillId: selectedSkill?.id, project: data.project});
  const promptContext = {draftAttachments, memory: data.chat.memory, skill: effectiveSkill, autoConnect: automaticSkillTools(selectedSkill), project: data.project, pageId: data.page?.id, page: data.page ? {title: data.page.title, url: data.page.url} : null, skillCatalog: skillCatalog(workflowLibrary), tools: [...browserTools(data.page, effectiveSkill, selectedModel.name, {autoConnect: automaticSkillTools(selectedSkill), vision: !!visionModel, visionModel, project: data.project}), ...skillLibraryTools(workflowLibrary)]};
  const phaseText = {planning: '작업 계획 세우는 중', validating: '요청사항 확인 중', compacting: '대화 정리 중', acting: '브라우저 작업 중', waiting: '응답 기다리는 중', thinking: '생각 중', responding: '답변 작성 중', reading: '페이지 읽는 중', inspecting: '구조 확인 중', storage: '저장 정보 확인 중', verifying: '결과 확인 중', reviewing: '입력 확인 대기', applying: '페이지에 입력 중'};
  const progressFor = message => message.progress || (data.chat.task?.requestId === message.id ? taskProgress(data.chat.task) : null);
  const traceFor = message => message.state === 'pending' ? message.trace || (data.agentRun ? trace : data.chat.task?.requestId === message.id ? data.chat.task.steps : []) : message.trace;
  return <CxAppShell brand={brand} actions={headerActions}>
    {(!showChat || isEmpty) && <AmbientScene/>}
    {!showChat ? <NubiLogin mood={data.pending ? 'working' : loginError ? 'sad' : resting} error={loginError} pending={data.pending} onLogin={provider=>provider==='fabrix' ? openFabrix() : login(provider).catch(()=>{})} onCancel={()=>action('CANCEL_LOGIN')}/> : <section className={`chat-page${isEmpty ? ' is-empty' : ''}`}>
      {stateRecovery}
      {(error || (!validAuth && loginError)) && !settingsOpen && <CxNotice tone="danger">{error || loginError}</CxNotice>}
      <div className="conversation-wrap"><div className="conversation" ref={list} aria-label="대화 내용" aria-busy={working} onScroll={e => {const el = e.currentTarget; followReply.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; setAway(!followReply.current);}}>
        <div className="conversation-content">
        {isEmpty && <Welcome animate={!welcomeAnimated && !draft && !motion.paused} onComplete={setWelcomeAnimated} mood={resting}/>}
        {data.chat.messages.map((message, index) => <article className={`message message-${message.role}`} data-state={message.state} key={message.id} aria-label={message.role === 'user' ? '내 메시지' : '누비 답변'}>
          {message.role === 'assistant' && <div className="answer-model" title={message.modelName || (data.activeProvider === 'fabrix' ? 'FabriX' : message.modelId) || '누비'}><AgentMark size={26} mood={message.error === 'cancelled' ? 'still' : message.state === 'pending' ? 'working' : message.state}/><span>{message.modelName || (data.activeProvider === 'fabrix' ? 'FabriX' : message.modelId) || '누비'}</span></div>}
          {message.role === 'assistant' && <><TaskPlan progress={progressFor(message)} trace={traceFor(message)} phase={message.state === 'pending' && working ? replyPhase : undefined} question={message.question}/><AgentTrace steps={traceFor(message)} captures={message.captures} question={message.question} live={message.state === 'pending'} completed={message.state === 'done' && !message.question}/></>}
          <MessageBody role={message.role} content={message.state === 'pending' && working ? partial : message.displayContent || message.content}/>
          {message.role === 'user' && <AttachmentList files={message.attachments}/>}
          {message.role === 'assistant' && <CaptureGallery captures={message.captures?.filter(capture => capture.source !== 'browser-tab' || message.question?.options?.some(option => option.id === capture.id))} question={message.question?.kind === 'approval' ? null : message.question}
            disabled={!validAuth || working || switching || data.busy || !!data.pending || index !== data.chat.messages.length - 1 || message.state !== 'done'}
            onChoose={choice => send(false, false, false, choice)} onDraft={value => rpc('QUESTION_DRAFT', {questionId: message.question.id, value, provider: data.activeProvider, conversationId: data.chat.sessionId})}/>}
          {message.question?.kind === 'approval' && <ActionApproval question={message.question}
            disabled={working || switching || data.busy || !!data.pending || index !== data.chat.messages.length - 1 || message.state !== 'done'}
            canApprove={validAuth} onApprove={() => send(false, false, false, {questionId: message.question.id, optionId: 'approve'})}
            onReject={() => action('REJECT_APPROVAL', {questionId: message.question.id, conversationId: data.chat.sessionId})}
            onRead={() => rpc('READ_APPROVAL_DRAFT', {questionId: message.question.id, conversationId: data.chat.sessionId})}
            onEdit={fields => send(false, false, false, null, {questionId: message.question.id, fields})}/>}
          {message.captureError && <CxNotice tone="danger">{errorText(message.captureError)}</CxNotice>}
          {message.state === 'pending' && !progressFor(message) && <span className="reply-status" role="status"><span className="status-spinner" aria-hidden="true"/>{!working ? '다른 창에서 답변 생성 중' : phaseText[replyPhase]}</span>}
          {message.finishReason === 'length' && <p className="reply-note">출력 한도에 도달했습니다. “이어서”라고 요청하세요.</p>}
          {message.error && <CxNotice tone="danger">{errorText(message.error)}</CxNotice>}
          {message.role === 'assistant' && <div className="message-actions">{message.content && <CopyButton text={message.content} label={`${index + 1}번째 메시지 복사`} successMessage="답변을 복사했습니다."/>}{message.error && (index === data.chat.messages.length - 1 || data.chat.task?.status === 'paused' && data.chat.task.requestId === message.requestId) && <ActionButton action="refresh" label={data.chat.task?.status === 'paused' && !message.contextOnly ? '작업 이어가기' : '재시도'} disabled={!validAuth || working || switching || data.busy} onClick={() => send(true, !!message.contextOnly, !message.contextOnly && data.chat.task?.status === 'paused')}/>}</div>}
        </article>)}
        </div>
      </div>{away && !isEmpty && <CxButton className="jump-latest" aria-label="최신 답변으로 이동" title="최신 답변으로 이동" onClick={() => {followReply.current = true; setAway(false); list.current.scrollTop = list.current.scrollHeight;}}><Icon name="arrowDown" size={18}/></CxButton>}</div>
      {!validAuth ? <div className="conversation-reconnect"><span>{PROVIDER_LABELS[data.activeProvider]} 연결 필요</span><ActionButton action="login" iconOnly className="icon-commit" label={data.pending ? '연결 중' : '연결과 모델 선택'} title={`${PROVIDER_LABELS[data.activeProvider]}로 대화 이어가기`} busy={!!data.pending} onClick={() => openModels()}/>{data.pending && <ActionButton action="cancel" label="로그인 취소" onClick={() => action('CANCEL_LOGIN')}/>}</div> : <form className="composer" data-file-drag={fileDrag || undefined}
          onDragOver={event => {if ([...event.dataTransfer.types].includes('Files')) {event.preventDefault(); setFileDrag(true);}}}
          onDragLeave={event => {if (!event.currentTarget.contains(event.relatedTarget)) setFileDrag(false);}}
          onDrop={event => {const files = [...event.dataTransfer.files]; if (files.length) {event.preventDefault(); setFileDrag(false); void attachInputFiles(files);}}} onFocus={() => setWelcomeAnimated(true)} onSubmit={e => {e.preventDefault(); send();}}>
        {(selectedSkill || data.page || serverProject) && <div className="composer-context">
          {selectedSkill && <span className="context-chip"><Icon name="layers" size={14}/><span>{selectedSkill.name}</span><ActionButton action="close" label="스킬 선택 해제" disabled={data.busy} onClick={() => action('SELECT_SKILL', {id: ''})}/></span>}
          {data.page && <span className="context-chip" title={`${data.page.url}\n이 페이지의 텍스트와 구조를 ${PROVIDER_LABELS[data.auth.provider] || 'AI Pro'}에서 사용합니다.`}>{data.workspace && !data.workspace.closed ? <ActionButton action="openExternal" label="누비 작업 창 열기" onClick={() => action('SHOW_BROWSER_WORKSPACE')}/> : <Icon name="link" size={14}/>}<span>{data.page.title}</span><ActionButton action="close" label="페이지 연결 해제" disabled={data.busy || connectingPage} onClick={() => action('DISCONNECT_PAGE')}/></span>}
          {serverProject && <span className="context-chip project-context-chip" title={serverProject.status === 'expired' ? '프로젝트 연결 만료' : '질문에 필요한 문서와 코드를 확인합니다.'}><Icon name="code" size={14}/><button type="button" className="project-chip-name" aria-label={`${serverProject.name} 프로젝트 연결 보기`} disabled={working || switching || data.busy || !!data.pending || accountBusy || projectBusy} onClick={() => openServerProject()}>{serverProject.name}</button><ActionButton action="close" label="프로젝트 연결 해제" disabled={working || switching || data.busy || !!data.pending || accountBusy || projectBusy} onClick={disconnectProject}/></span>}
        </div>}
        <AttachmentList files={draftAttachments} disabled={working || data.busy || attachmentBusy} onRemove={removeFile}/>
        {draftAttachments.some(file => file.kind === 'document') && <p className="attachment-document-note">문서는 텍스트만 전달됩니다.</p>}
        {imageBlocked && <div className="attachment-model-hint" role="status"><p>이미지 지원 모델을 선택해주세요.</p><CxButton aria-label="이미지 지원 모델 선택" title="모델 변경" onClick={() => openModels()}><Icon name="layers" size={20}/></CxButton></div>}
        <NubiComposerInput inputRef={textarea} onPaste={pasteFiles} value={draft} maxLength={16000} rows={2} placeholder="무엇이든 물어보세요" title={'Enter 전송\nShift + Enter 줄바꿈'} onChange={e => updateDraft(e.target.value)} onKeyDown={e => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {e.preventDefault(); send();}}}/>
        <NubiComposerBar leading={<><AttachmentPicker loading={attachmentBusy} disabled={working || switching || data.busy || !!data.pending || accountBusy || projectBusy} count={draftAttachments.length} onAdd={addFiles} onBusy={setAttachmentBusy} onError={setError}/><CxButton className="composer-icon" aria-label="현재 페이지 연결" aria-pressed={!!data.page} title={data.page ? '페이지 연결 해제' : '현재 페이지 연결'} disabled={data.busy} busy={connectingPage} onClick={() => action(data.page ? 'DISCONNECT_PAGE' : 'CONNECT_PAGE')}>{!connectingPage && <Icon name="link" size={20}/>}</CxButton>{serverProject && <CxButton className="composer-icon" aria-label="프로젝트 연결" title="프로젝트 연결" aria-haspopup="dialog" aria-expanded={projectOpen} data-active={serverProject?.status === 'connected'} disabled={working || switching || data.busy || !!data.pending || accountBusy || projectBusy} onClick={() => openServerProject()}><Icon name="code" size={20}/></CxButton>}<SkillPicker data={data} action={action}/><ModelPicker data={data} loading={modelsLoading} disabled={working || switching || data.busy || !!data.pending} open={modelsOpen} onOpen={() => openModels()} onRefresh={() => loadModels(data.auth.receivedAt, true)}/></>} tools={<><ContextMeter messages={data.chat.messages} draft={draft} model={selectedModel} busy={data.busy || working} partial={partial} promptContext={promptContext} memory={data.chat.memory} stats={data.chat.contextStats} task={data.chat.task} onCompact={() => send(false, true)}/>{working ? <CxButton aria-label="중지" title="중지" onClick={stop}><span className="stop-symbol" aria-hidden="true"/></CxButton> : <CxButton type="submit" variant="primary" aria-label="전송" title={noModels ? errorText('models_empty') : '전송'} disabled={(!draft.trim() && !draftAttachments.length) || imageBlocked || attachmentBusy || switching || data.busy || !!data.pending || accountBusy || projectBusy || noModels}><Icon name="arrowUp" size={20}/></CxButton>}</>}/>
      </form>}
    </section>}
    {modelsOpen && <ModelSelection data={data} initialProvider={modelProvider} loading={modelsLoading} disabled={working || switching || data.busy || accountBusy} onProviderSelect={provider => provider === data.activeProvider ? Promise.resolve() : changeConversation('SELECT_PROVIDER', {provider})} onSelect={name => action('SELECT_MODEL', {name})} onRefresh={options => loadModels(data.auth.receivedAt, true, !options?.silent)} onLogin={provider => provider === 'fabrix' ? openFabrix(true) : login(provider)} onLogout={disconnectProvider} onCancelLogin={() => {loginRequested.current = null; return action('CANCEL_LOGIN');}} onClose={closeModels}/>}
    {historyOpen && <ConversationHistory conversations={data.conversations || []} disabled={working || switching || data.busy || !!data.pending} onAction={changeConversation} onClose={options => {historyComposerFocus.current = !!options?.focusComposer; setHistoryOpen(false);}}/>}
    {usageOpen && <UsagePanel data={data} rpc={rpc} onClose={() => setUsageOpen(false)}/>}
    {a2aOpen&&<A2AInbox role="browser" disabled={working||switching||data.busy} call={input=>rpc('A2A',{...input,conversationId:data.chat.sessionId})} beforeConnect={origin=>chrome.permissions.request({origins:[origin+'/*']})} onImport={async text=>{clearTimeout(draftTimer.current);await rpc('DRAFT',{value:text,conversationId:data.chat.sessionId,provider:data.activeProvider});setDraft(text);await refresh();}} onClose={()=>setA2AOpen(false)}/>}
    {projectOpen && <ProjectConnection project={data.serverProject} rpc={rpc} disabled={working || switching || data.busy || !!data.pending || accountBusy} onBusy={setProjectBusy} onClose={closeServerProject} onChanged={async () => {await refresh(); closeServerProject();}}/>}
    {fabrixInitial && <FabrixConnection initial={fabrixInitial} rpc={rpc} onClose={() => {setFabrixInitial(null); if (fabrixReturn.current) openModels('fabrix');}} onConnected={async () => {await refresh(); setFabrixInitial(null); setModelsOpen(false); setShowLogin(false);}}/>}
    {settingsOpen && <DetailPanel className={`deck-dialog settings-dialog${helpOpen ? ' help-dialog' : ''}`} title={helpOpen ? '도움말' : '설정'} variant="modal" footer={!helpOpen && <span className="settings-version" aria-label={`버전 ${displayVersion}`}>{displayVersion}</span>} busy={projectBusy || accountBusy} hideHelp={helpOpen || projectBusy || accountBusy} onHelp={() => {if (!projectBusy && !accountBusy) setHelpOpen(true);}} onClose={() => {if (projectBusy || accountBusy) return; if (helpOpen) {helpReturnFocus.current = true; setHelpOpen(false);} else {setSettingsOpen(false); setError('');}}}>
      {helpOpen ? <HelpContent/> : <div className="settings-fields">
        {error && <CxNotice tone="danger">{error}</CxNotice>}
        <div className="connection-row settings-account-row"><DeckSectionLabel icon="user">{data.auth.present ? PROVIDER_LABELS[data.auth.provider] : '계정'}</DeckSectionLabel><ActionButton action={data.auth.present ? 'logout' : 'login'} iconOnly className="account-action" label={data.auth.present ? '로그아웃' : '로그인'} title={data.auth.present ? `${PROVIDER_LABELS[data.auth.provider]} 로그아웃` : '연결과 모델 선택'} busy={accountBusy || !!data.pending} disabled={working || switching || data.busy || projectBusy} onClick={accountAction}/></div>
        <div className="workspace-settings"><AgentTabs items={[{key:'window',label:'누비 작업 창'},{key:'current',label:'현재 탭'}]} active={data.browserWorkMode || 'window'} onChange={mode => action('SET_BROWSER_WORK_MODE',{mode})} label="브라우저 작업 위치" idPrefix="workspace-mode" disabled={working || switching || data.busy || projectBusy}/></div>
        <CxButton className="settings-shortcut" aria-haspopup="dialog" disabled={working||switching||data.busy||projectBusy} onClick={()=>{setSettingsOpen(false);setA2AOpen(true);}}><DeckSectionLabel icon="workflow">누비 작업 연결</DeckSectionLabel><Icon name="chevronRight" size={16}/></CxButton>
        <WikiFolderSettings folder={data.wikiFolder} statusError={data.wikiFolderError} serverProject={data.serverProject} rpc={rpc} clientId={clientId} disabled={working || switching || data.busy || !!data.pending || accountBusy} initialOpen={wikiSectionOpen} initialServerOpen={wikiServerOpen} onBusy={setProjectBusy} onChanged={refresh} onServerOpen={() => openServerProject(true)}/>
        <details className="diagnostics"><summary><DeckSectionLabel icon="link">연결 진단</DeckSectionLabel></summary><div className="advanced-content"><div className="connection-row"><span>{validAuth ? `${PROVIDER_LABELS[data.auth.provider] || 'AI Pro'} 연결됨` : '로그인 필요'}</span><div className="diagnostic-actions">{data.auth.provider === 'fabrix' && <ActionButton action="edit" label="FabriX 연결 편집" disabled={data.busy} onClick={openFabrix}/>}<CopyButton getText={diagnosticText} label="진단 복사" successMessage="진단을 복사했습니다."/></div></div><p className="reply-note">{data.auth.verifiedAt ? '응답 확인 완료' : '아직 응답을 확인하지 못했습니다.'}</p><pre aria-label="진단 이벤트">{data.events.length ? data.events.map(e => `${e.time.slice(11,19)}  ${e.event}${e.transport ? ` (${e.transport}/${e.field})` : ''}${e.status ? ` HTTP ${e.status}` : ''}${e.reason ? ` / ${e.reason}` : ''}${e.event === 'models_received' ? ` 수신 ${e.received} / 표시 ${e.usable}` : ''}`).join('\n') : '기록 없음'}</pre>{data.catalog?.error && <p>{errorText(data.catalog.error)}</p>}</div></details>
        <details className="storage-help"><summary><DeckSectionLabel icon="save" tone="teal">데이터 보관</DeckSectionLabel></summary><p>대화와 이미지는 이 브라우저에 저장됩니다.</p><p>로그인 정보는 브라우저를 종료하면 삭제됩니다.</p></details>
      </div>}
    </DetailPanel>}
    {fillReview && <FillReview plan={fillReview} onResolve={resolveFill}/> }
  </CxAppShell>;
}
