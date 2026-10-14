import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {CxButton,ActionButton,Icon,CxInput,CxNotice} from '@e2e/cx-design-system';
import {NubiLogin,NubiComposerInput,NubiComposerBar} from '../vendor/nubi/extensions/aipro-chat/src/NubiSurfaces.jsx';
import {ModelPicker,ContextMeter} from '../vendor/nubi/extensions/aipro-chat/src/ChatControls.jsx';
import {NubiLogo} from '../vendor/nubi/extensions/aipro-chat/src/AgentMark.jsx';
import {ReasoningPicker} from '../vendor/nubi/packages/nubi-desktop/ui/ReasoningPicker.jsx';
import {ResponseTime} from '../vendor/nubi/packages/nubi-desktop/ui/ResponseTime.jsx';
import {useOfficeConversationScroll} from './useOfficeConversationScroll.js';
import {providerLoginError,providerLoginDiagnostics} from '../vendor/nubi/packages/nubi-desktop/ui/provider-login-state.mjs';
import {available,send,command,subscribe} from './bridge.js';
import {labels,modelData,displayLabel} from './provider-view.js';
import '@e2e/cx-design-system/styles.css';
import '@e2e/cx-design-system/fonts.css';
import '../vendor/nubi/extensions/aipro-chat/design/agent-deck.css';
import '../vendor/nubi/extensions/aipro-chat/src/app.css';
import '../vendor/nubi/packages/nubi-desktop/design/workspace-identity.css';
import '../vendor/nubi/packages/nubi-desktop/electron-app/ios-tokens.css';
import '../vendor/nubi/packages/nubi-desktop/design/workspace-typography.css';
import '../vendor/nubi/packages/nubi-desktop/design/workspace-density.css';
import '../vendor/nubi/packages/nubi-desktop/design/workspace-dialogs.css';
import './office-tokens.css';
import './office.css';
import {officeApps} from './office-apps.js';
import {useGreeting} from './useGreeting.js';
import {ModelForm} from './ModelForm.jsx';
import {meterInfo,estimateTokens} from '../runtime-src/context-policy.mjs';
import './office-context.css';
import {OfficeDialog} from './OfficeDialog.jsx';
import './office-dialog.css';
import {outcome,inferDocumentTarget,toolFailure,documentInputFailure} from './run-outcome.js';
const fresh=()=>({id:crypto.randomUUID(),title:'새 대화',messages:[]});
const toolNames={export_markdown:'Markdown 추출 및 저장',generate_deck:'발표자료 작성',regenerate_slide:'슬라이드 다시 작성',render_document:'문서 화면 확인',rollback_document:'문서 복원',checkpoint_document:'복원 지점 저장',apply_slide_ops:'발표자료 편집',convert_document:'문서 변환',inspect_office_members:'지원 기능 확인',inspect_office:'문서 구조와 내용 읽기',execute_office_operations:'문서 수정 및 확인',create_document:'새 문서 만들기',save_document:'문서 저장',load_office_guide:'작업 방법 확인',read_selection:'선택 범위 읽기',read_cells:'셀 내용 읽기',read_worksheets:'시트 목록 읽기',add_worksheet:'시트 추가 및 확인',rename_worksheet:'시트 이름 변경 및 확인',merge_cells:'셀 병합 및 확인',format_cells:'셀 서식 변경 및 확인',read_range:'시트 범위 읽기',read_surrounding:'주변 표 읽기',read_sheet_context:'시트 구조 확인',write_cells:'셀 입력',set_formula:'수식 변경안 확인',calculate_and_read:'계산 결과 검증',replace_text:'문장 변경안 확인',replace_blocks:'문단 변경안 확인',read_outline:'문서 개요 읽기'};
function App(){
  const greeting=useGreeting();
  const [host,setHost]=useState('excel');
  const textHost=host!=='excel';
  const app=officeApps[host]||officeApps.excel;
  const [version,setVersion]=useState('0.8.14');
  const [contextRecords,setContextRecords]=useState({}),[contextBusy,setContextBusy]=useState(false),[contextNotice,setContextNotice]=useState(''),[checkpoints,setCheckpoints]=useState([]),[pendingRequest,setPendingRequest]=useState(''),[question,setQuestion]=useState(null),[questionAnswers,setQuestionAnswers]=useState({}),[catalogProblem,setCatalogProblem]=useState(null);
  const [provider,setProvider]=useState({}),[ready,setReady]=useState(false),[error,setError]=useState(''),[dialog,setDialog]=useState(null),[lost,setLost]=useState(false),[diagnostics,setDiagnostics]=useState(null);
  const [conversations,setConversations]=useState(()=>[fresh()]),[index,setIndex]=useState(0),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false);
  const [target,setTarget]=useState('현재 문서에서 작업합니다'),[status,setStatus]=useState(''),[review,setReview]=useState(null),[loading,setLoading]=useState(false);
  const composerInput=useRef(null),[controlBusy,setControlBusy]=useState(false),[loginProvider,setLoginProvider]=useState(null);
  useLayoutEffect(()=>{const field=composerInput.current;if(!field)return;field.style.height='auto';field.style.height=Math.min(180,field.scrollHeight)+'px';},[draft,provider.connected]);
  const active=conversations[index],current=useRef(active.id),run=useRef(null),started=useRef(0);current.current=active.id;
  const data=modelData(provider),scroll=useOfficeConversationScroll(provider.connected||active.messages.length?active.id:'login',active.messages.filter(m=>m.role==='user').length);
  const updateReply=patch=>setConversations(rows=>rows.map(c=>c.id!==current.current?c:{...c,messages:c.messages.map((m,i)=>i===c.messages.length-1&&m.role==='assistant'?{...m,...patch}:m)}));
  useEffect(()=>{
    const unsubscribe=subscribe(m=>{
      if(m.type==='handoff'){const request=typeof m.request==='string'?m.request:'';const id=m.conversationId||crypto.randomUUID();started.current=performance.now();current.current=id;run.current=m.runId||null;setHost(m.app||'excel');setTarget(m.target||'현재 문서에서 작업합니다');setBusy(!!m.running);setConversations([{id,title:request.slice(0,32)||'문서 작업',messages:request?[{role:'user',text:request},{role:'assistant',text:typeof m.text==='string'?m.text:'',target:m.target,model:m.model||'누비'}]:[]}]);setIndex(0);return;}
      if(m.type==='connection_storage_warning'){setError('보관한 일부 연결 설정을 읽지 못했습니다. 로그인은 다시 진행할 수 있습니다.');return;}
      if(m.type==='context_state'){setContextRecords(rows=>({...rows,[m.conversationId]:m}));return;}
      if(m.type==='context_compacting'){setContextBusy(!!m.active);return;}
      if(m.type==='checkpoint_list'){setCheckpoints(m.checkpoints);setDialog('checkpoints');return;}
      if(m.type==='host'){setHost(m.app);setVersion(m.version||'0.8.14');return;}
      if(m.type==='provider_state'){setProvider(m.state);setReady(!m.state.initializing);return;}
      if(m.type==='host_error'){setError(m.error);setDiagnostics(m.diagnostics||null);if(m.operation==='ready')setLost(true);if(!m.id&&(['start','demo','rollback'].includes(m.operation)||!run.current)){setBusy(false);setReview(null);setQuestion(null);run.current=null;updateReply({failed:true,text:m.error});}return;}
      if(m.type==='disconnected'){setLost(true);setProvider({});setReady(false);setBusy(false);setReview(null);updateReply({failed:true,text:'Agent 연결이 끊겼습니다. 문서 변경 결과를 확인해 주세요.'});return;}
      if(m.type==='view'){setTarget(m.target||'현재 문서에서 작업합니다');setStatus(m.status);setBusy(!!m.running);if(!m.running){setReview(null);setQuestion(null);}return;}
      if(m.type==='started'){run.current=m.runId;updateReply({target:m.target});return;}
      if(m.type==='question'){if(m.runId!==run.current)return;setQuestion(m);setQuestionAnswers({});return;}if(m.type==='question_closed'){setQuestion(null);return;}
      if(m.type==='write_recovery_resumed'){if(m.runId!==run.current)return;setConversations(rows=>rows.map(c=>c.id!==current.current?c:{...c,messages:c.messages.map((r,i)=>i===c.messages.length-1?{...r,receipt:r.receipt?{...r.receipt,recoveryReviewed:true}:r.receipt,receipts:(r.receipts||[]).map(x=>({...x,recoveryReviewed:true}))}:r)}));return;}
      if(m.type==='review_closed'){setReview(null);return;}
      if(m.runId!==run.current)return;
      if(m.type==='text')updateReply({text:m.data});
      if(m.type==='phase')setStatus(({requesting:'응답 준비 중',thinking:'요청 검토 중',responding:'답변 작성 중','tool-input':'문서 작업 준비 중','tool-running':'문서 도구 실행 중'})[m.data.kind]||'작업 중');
      if(m.type==='tool')setStatus(toolNames[m.name||m.data]||'문서 도구 실행 중');
      if(m.type==='review')setReview(m);
      if(m.type==='tool_executed'){const fault=toolFailure(m.data);if(fault)setConversations(rows=>rows.map(c=>c.id!==current.current?c:{...c,messages:c.messages.map((reply,i)=>i===c.messages.length-1&&reply.role==='assistant'?{...reply,toolFaults:[...(reply.toolFaults||[]),fault].slice(-20)}:reply)}));return;}
      if(m.type==='receipt')setConversations(rows=>rows.map(c=>c.id!==current.current?c:{...c,messages:c.messages.map((reply,i)=>i===c.messages.length-1&&reply.role==='assistant'?{...reply,receipt:m.receipt,receipts:[...(reply.receipts||[]),m.receipt]}:reply)}));
      if(m.type==='sources')updateReply({sources:m.data.items});
      if(m.type==='artifacts')updateReply({artifacts:m.data.items});
      if(m.type==='generation_progress')setStatus(({style:'발표자료 스타일 준비',plan:'페이지 구성 준비',pages:'슬라이드 작성',audit:'레이아웃 확인',convert:'문서 변환',markdown_read:'문서 전체 읽기',markdown_prepare:'문서 변환 엔진 준비',markdown_analyze:'PDF 구조와 OCR 분석',markdown_convert:'Markdown 변환',markdown_verify:'추출 내용 확인',markdown_save:'Markdown 저장 확인'})[m.data.stage]+(m.data.total?` ${m.data.done}/${m.data.total}`:''));
      if(m.type==='recovery'){setStatus(m.data.stage==='awaiting_user'?'확인을 기다리고 있습니다':m.data.stage==='resumed'?'남은 작업을 이어갑니다':m.data.stage==='adjusting'?'다른 작업 방법을 확인하고 있습니다':m.data.stage==='reporting'?'확인된 결과와 남은 작업을 정리합니다':'이어서 요청할 수 있습니다');return;}
      if(m.type==='usage')updateReply({usage:m.data});
      if(m.type==='done'||m.type==='error'){
        setBusy(false);setReview(null);updateReply({... (m.result?.text?{text:m.result.text}:{}),failed:m.type==='error',errorCode:m.error,cancelled:!!m.result?.cancelled,incomplete:!!(m.result?.turnLimit||m.result?.truncated),recovery:m.result?.recovery,finished:true,
          timing:{durationMs:performance.now()-started.current}});run.current=null;
      }
    });
    if(available){send({type:'ready'});requestAnimationFrame(()=>send({type:'ui_rendered'}));}return unsubscribe;
  },[]);
  useEffect(()=>{if(ready||!available)return;const timer=setTimeout(()=>{setLost(true);setError('Agent 연결을 확인해주세요. 다시 연결할 수 있습니다.');},15000);return()=>clearTimeout(timer);},[ready]);
  async function action(method,input,{silent=false}={}){if(!silent){setError('');setDiagnostics(null);}try{return await command(method,input);}catch(e){if(!silent){setError(e.message);setDiagnostics({operation:e.method||method,code:e.code||'command_failed',provider:labels[input]?input:labels[input?.provider]?input.provider:provider.provider});}throw e;}}
  async function login(id){if(!ready||controlBusy||provider.authBusy||provider.pending)return;if(id==='fabrix'){setDialog('fabrix');return;}setLoginProvider(id);setControlBusy(true);try{return await action('login',id);}catch{return false;}finally{setControlBusy(false);setLoginProvider(null);}}
  function demo(){
    if(busy)return;setError('');setBusy(true);started.current=performance.now();
    setConversations(rows=>rows.map(c=>c.id!==active.id?c:{...c,title:'문서 도구 확인',messages:[...c.messages,{role:'user',text:textHost?'선택한 텍스트 읽기 (모델 전송 없음)':'C1:E4 수식 도구 확인 (모델 전송 없음)'},{role:'assistant',text:'',model:'문서 도구 확인',timing:{elapsedMs:0}}]}));
    try{send({type:'demo',conversationId:active.id});}catch(e){setBusy(false);setError(e.message);}
  }
  function submit(chosenTarget){
    if(busy||controlBusy||contextBusy||!ready||!provider.connected||provider.authBusy||provider.pending||!provider.model||!(provider.models||[]).some(m=>m.id===provider.model)||!draft.trim())return;
    const text=pendingRequest||draft.trim(),documentTarget=typeof chosenTarget==='string'?chosenTarget:inferDocumentTarget(text);if(documentTarget===null){setPendingRequest(text);setDialog('target');return;}setPendingRequest('');setDialog(null);setError('');setContextNotice('');started.current=performance.now();setBusy(true);
    setConversations(rows=>rows.map(c=>c.id!==active.id?c:{...c,title:c.messages.length?c.title:text.slice(0,32),messages:[...c.messages,{role:'user',text,at:new Date().toISOString()},{role:'assistant',text:'',model:provider.models?.find(m=>m.id===provider.model)?.label||provider.model,timing:{elapsedMs:0,startedAt:new Date().toISOString()}}]}));
    try{send({type:'start',conversationId:active.id,request:text,documentTarget});setDraft('');}catch(e){setBusy(false);setError(e.message);}
  }
  async function refresh(input={}){setLoading(true);try{await action('refreshModels',input,{silent:!!input.silent});setCatalogProblem(null);}catch(e){if(input.silent)setCatalogProblem({provider:input.provider||provider.provider,message:e.message});throw e;}finally{setLoading(false);}}
  async function reasoningApi(method,{input}) {
    if(method!=='provider'||busy||input.expectedProvider!==provider.provider||input.expectedModel!==provider.model)throw Error('reasoning_changed');
    setControlBusy(true);try{return await action('reasoning',input.effort);}finally{setControlBusy(false);}
  }
  const textReview=review?.plan?.before&&!Array.isArray(review.plan.before.cells);
  const catalogModel=(provider.models||[]).find(m=>m.id===provider.model)||{id:provider.model};
  const contextRecord=contextRecords[active.id],fallbackUsage={model:provider.model,kind:'estimated',used:active.messages.length?estimateTokens(JSON.stringify(active.messages.map(m=>({role:m.role,text:m.text||''})))):0};
  const meter=meterInfo(contextRecord?.usage?.kind==='measured'||contextRecord?.messages>0||['request_pending','response_usage_missing','compaction'].includes(contextRecord?.usage?.reason)?contextRecord.usage:fallbackUsage,catalogModel,draft);
  const remainingPercent=meter.remaining!==null&&meter.capacity?`${Math.max(0,Math.round(meter.remaining/meter.capacity*100))}% 남음`:'한도 미제공';
  useEffect(()=>{if(!ready||!provider.model||busy)return;let valid=true;command('status',{conversationId:active.id},'context').then(state=>{if(valid)setContextRecords(rows=>({...rows,[active.id]:state}));}).catch(()=>{});return()=>{valid=false;};},[ready,active.id,provider.model,busy]);
  async function compactContext(){if(busy||contextBusy||controlBusy||!provider.connected)return;setContextBusy(true);setContextNotice('');try{const result=await command('compact',{conversationId:active.id,messages:active.messages.filter(m=>['user','assistant'].includes(m.role)).slice(-20).map(m=>({role:m.role,text:(m.text||'').slice(0,16000)}))},'context');setContextRecords(rows=>({...rows,[active.id]:result}));setContextNotice(result.status==='compacted'?'대화를 요약했습니다. 화면의 대화는 그대로 남습니다.':result.reason==='not_enough_history'?'요약할 이전 대화가 아직 부족합니다.':'요약을 완료하지 못해 원래 문맥을 유지했습니다. 계속 요청할 수 있습니다.');}catch(e){setContextNotice(e.code==='cancelled'?'요약을 취소했습니다. 원래 문맥은 유지됩니다.':'요약을 완료하지 못해 원래 문맥을 유지했습니다. 계속 요청할 수 있습니다.');}finally{setContextBusy(false);}}
  return <div className="desktop-shell nubi-desktop-host office-host"><main className="office-shell nubi-workbench" data-workspace-screen={provider.connected||active.messages.length?'conversation':'welcome'}><div className="nubi-workbench-content office-content">
    <header className="topbar"><NubiLogo title="누비 Agent" size={28}/><div className="header-actions">
      <CxButton aria-label="연결 설정" title={`모델 선택 / ${app.name} / 누비 Agent ${version}`} disabled={!available} onClick={()=>setDialog('models')}><Icon name="sliders" size={18}/><span>모델</span></CxButton>
      <CxButton aria-label="문서 복원" disabled={busy||contextBusy} onClick={()=>send({type:'checkpoints'})}><Icon name="clockRewind" size={18}/><span>복원</span></CxButton>
    </div></header>
    {!available&&<CxNotice tone="warning">미리보기 화면입니다. Windows Office에서 실행하세요.</CxNotice>}
    {lost&&<CxButton onClick={()=>{setLost(false);setError('');send({type:'ready'});}}>Agent 다시 연결</CxButton>}
    {error&&<CxNotice tone="danger"><span>{error}</span>{diagnostics&&<CxButton onClick={()=>navigator.clipboard.writeText(JSON.stringify(diagnostics,null,2)).catch(()=>{})}>오류 정보 복사</CxButton>}</CxNotice>}
    {providerLoginError(provider)&&<CxNotice tone="danger">{providerLoginError(provider)}</CxNotice>}
    {!provider.connected&&!active.messages.length?<div className="login-scroll"><NubiLogin providerLabels={labels} intro={{title:greeting,description:'사용할 모델을 연결하세요.'}} pending={data.pending} checkingProvider={!ready?'initializing':controlBusy||provider.authBusy?loginProvider||'initializing':null} onLogin={login} onCancel={()=>void action('cancelLogin').catch(()=>{})}>
      <details className="connection-help"><summary>연결 안내</summary><p>{app.name} / 누비 Agent {version}</p><p>Claude 연결에는 Claude Code가 필요합니다.</p><p>인증 정보는 Windows와 각 서비스의 인증 도구에서 관리합니다.</p><CxButton disabled={!available||busy} onClick={demo}>모델 없이 도구 확인</CxButton></details>
      {provider.pending&&<details><summary>연결 진행 보기</summary><pre>{providerLoginDiagnostics(provider)}</pre></details>}
      {!ready&&<p role="status" className="muted">Agent 준비 중</p>}
    </NubiLogin></div>:<>
      <div className="document-context"><Icon name={app.icon} size={18}/><span title={target}>{target}</span><ActionButton action="refresh" label="선택 범위 확인" iconOnly disabled={busy} onClick={()=>send({type:'inspect'})}/></div>
      <div className="conversation" ref={scroll.viewport} tabIndex={0} aria-label="대화 내용" onScroll={scroll.onScroll} onFocusCapture={scroll.onFocusCapture}><div className="nubi-task office-task" ref={scroll.content}>
        {!active.messages.length&&<div className="empty-chat"><h1>어떤 작업을 할까요?</h1><div className="office-suggestions">{app.suggestions.map(([label,prompt])=><CxButton key={label} onClick={()=>setDraft(prompt)}>{label}</CxButton>)}</div></div>}
        {active.messages.map((m,i)=>{const result=outcome(m);return <article key={i} className={'message '+m.role+' '+(m.role==='user'?'message-user nubi-request':'message-assistant')}>
          <div className={m.role==='user'?'visually-hidden':'visually-hidden answer-model'}>{m.role==='user'?'나':displayLabel(m.model)||'누비'}</div>
          {m.target&&<div className="message-source">{m.target}</div>}
          <div className={"message-text message-body"+(m.role==='user'?' nubi-user-bubble':'')}><Markdown remarkPlugins={[remarkGfm]} components={{a:({href,children})=><button className="source-link" onClick={()=>send({type:'open_source',url:href})}>{children}</button>,img:()=>null}}>{result.text||(busy?'요청을 확인하고 있어요.':'응답이 없습니다.')}</Markdown></div>
          {m.receipt&&(m.receipt.status!=='partial'||m.finished&&!m.receipt.recoveryReviewed&&!question)&&<div className="receipt" data-status={m.receipt.status}><strong>{m.receipt.status==='verified'?(['save_document','save_markdown'].includes(m.receipt.kind)?'저장 확인':m.receipt.kind==='create_document'?'새 문서 생성 확인':m.receipt.kind==='office_operations'?'문서 변경 확인':m.receipt.cells?'수식 검증 완료':'문장 변경 확인'):m.receipt.status==='rejected'?'변경 안 함':m.receipt.kind==='save_markdown'?'저장됨 / 추출 확인 필요':'변경 결과 확인 필요'}</strong><div className="receipt-meta">{m.receipt.status!=='rejected'&&<><span>{m.receipt.document|| (m.receipt.kind==='office_operations'?(Number.isInteger(m.receipt.count)?`${m.receipt.count}개 작업`:'문서 변경'):m.receipt.kind==='create_document'?`${m.receipt.count}개 구성`:m.receipt.cells?`${m.receipt.cells.length}개 셀`:`${m.receipt.count||0}개 문단`)}</span><span>{m.receipt.saved?'저장됨':'저장 전'}</span></>}</div>{m.receipt.kind==='save_markdown'&&<div className="receipt-export">{m.receipt.destination&&<p>{m.receipt.destination}</p>}{m.receipt.warnings?.length>0&&<p>{m.receipt.warnings[0]}</p>}</div>}</div>}

          {m.sources?.length>0&&<div className="source-list">{m.sources.slice(0,8).map((source,j)=><button className="source-link" key={j} onClick={()=>send({type:'open_source',url:source.url||source.sourceUrl})}>{source.title||source.source||'출처 '+(j+1)}</button>)}</div>}
          {m.artifacts?.length>0&&<div className="artifact-grid">{m.artifacts.map(a=><figure key={a.artifactId}>{a.preview&&<img src={a.preview} alt={a.name}/>}<figcaption>{a.name}</figcaption></figure>)}</div>}

          {m.finished&&!busy&&!question&&(m.failed||m.recovery||m.receipt?.status==='partial'&&!m.receipt.recoveryReviewed)&&<CxNotice tone={m.recovery?'warning':result.tone}>{m.recovery?'남은 작업을 이어서 요청할 수 있습니다.':result.notice}{m.receipt?.kind!=='save_markdown'&&<CxButton disabled={busy} onClick={()=>{send({type:'inspect'});setDraft((active.messages.findLast(row=>row.role==='user')?.text||'')+'\n실제 값을 확인하고 남은 작업을 이어서 처리해줘');requestAnimationFrame(scroll.followLatest);}}>문서 확인 후 이어서 요청</CxButton>}</CxNotice>}
          {(m.toolFaults?.length>0||m.receipt?.checkpoint?.available===false||m.receipt?.status==='partial')&&<details className="tool-errors"><summary>작업 상세</summary>{m.receipt?.checkpoint?.available===false&&<p>복원 사본 없음</p>}{m.receipt?.status==='partial'&&<p>이전 변경은 자동 검증되지 않았습니다.{m.receipt.recoveryReviewed?' 사용자 확인 후 남은 작업을 이어갔습니다.':''}</p>}{m.receipt?.nativeCode&&<p>{m.receipt.failedMember} {m.receipt.nativeCode}</p>}{m.toolFaults?.length>0&&<>{documentInputFailure(m.toolFaults.at(-1))?<p>{documentInputFailure(m.toolFaults.at(-1))}</p>:<p>{toolNames[m.toolFaults.at(-1).tool]||'문서 작업'} / <strong>{m.toolFaults.at(-1).member||'Office'}</strong> {m.toolFaults.at(-1).nativeCode}</p>}<p>{m.toolFaults.at(-1).code}</p><CxButton onClick={()=>navigator.clipboard.writeText(JSON.stringify({app:host,version,failures:m.toolFaults},null,2)).catch(()=>setError('오류 정보를 복사하지 못했습니다.'))}>문서 작업 오류 복사</CxButton></>}</details>}
          {m.incomplete&&!m.failed&&!m.recovery&&<p className="muted">응답을 마치지 못했습니다. 문서 결과를 확인하세요.</p>}
          {m.cancelled&&<p className="muted">중지했습니다. 적용된 변경은 유지됩니다.</p>}
          {m.role==='assistant'&&<footer className="message-actions"><ResponseTime label="" timing={m.timing} live={busy&&i===active.messages.length-1}/>{m.text&&<ActionButton action="copy" label="답변 복사" iconOnly onClick={()=>navigator.clipboard.writeText(m.text).catch(()=>setError('답변을 선택해서 복사해 주세요.'))}/>}</footer>}
        </article>;})}
      {question?.kind==='write_recovery'&&<section className="review office-recovery-form" aria-label="문서 상태 확인" role="status"><strong>문서 상태를 확인해 주세요</strong><p>{question.detail}</p><div className="review-actions">{question.questions[0].options.map(option=><CxButton key={option} variant={option==='현재 상태에서 이어가기'?'primary':undefined} disabled={!!questionAnswers.submitted} onClick={()=>{setQuestionAnswers({submitted:true});send({type:'answer_question',runId:question.runId,questionId:question.questionId,answers:{writeRecovery:option}});}}>{option}</CxButton>)}</div></section>}
      {question&&question.kind!=='write_recovery'&&<section className="review office-question-form" aria-label="작업 질문"><form onSubmit={e=>{e.preventDefault();send({type:'answer_question',runId:question.runId,questionId:question.questionId,answers:questionAnswers});}}>{question.questions.map(q=><fieldset key={q.id}><legend>{q.question}</legend>{q.options?.map(option=><label className="question-choice" key={option}><input type="radio" name={q.id} checked={questionAnswers[q.id]===option} onChange={()=>setQuestionAnswers({...questionAnswers,[q.id]:option})}/>{option}</label>)}<label>직접 입력<CxInput value={q.options?.includes(questionAnswers[q.id])?'':questionAnswers[q.id]||''} required={!q.options?.length} onChange={e=>setQuestionAnswers({...questionAnswers,[q.id]:e.target.value})}/></label></fieldset>)}<CxButton type="submit" variant="primary" disabled={question.questions.some(q=>!questionAnswers[q.id]?.trim())}>계속</CxButton></form></section>}
      {review&&<section className="review" aria-label="문서 변경 승인"><strong>{review.plan.name==='save_markdown'?'Markdown을 저장할까요?':review.plan.kind==='create_document'?'새 문서를 만들까요?':['office_operations','file_operation'].includes(review.plan.kind)?'문서에 적용할까요?':textReview?'문단을 바꿀까요?':'수식을 적용할까요?'}</strong><p>{review.target}</p>{review.checkpoint?.available===false&&<p className="muted">복원 사본 없이 적용됩니다.</p>}{review.plan.kind==='file_operation'?<div className="review-text"><p>{review.plan.summary}</p>{review.plan.warnings?.length>0&&<p>{review.plan.warnings[0]}</p>}</div>:review.plan.kind==='create_document'?<div className="review-text"><strong>{review.plan.content.title}</strong>{(review.plan.content.paragraphs||review.plan.content.slides||review.plan.content.sheets||[]).map((part,i)=><div className="review-block" key={i}><strong>{part.title||part.name||''}</strong><p>{part.text||part.body?.join('\n')}</p>{part.rows&&<div className="review-table"><table><tbody>{part.rows.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c}>{cell}</td>)}</tr>)}</tbody></table></div>}</div>)}</div>:review.plan.kind==='office_operations'?<div className="review-text"><p>{review.plan.summary}</p><details><summary>변경 내용 확인</summary>{review.plan.steps.map((step,i)=><div className="review-block" key={i}><strong>{step.target}.{step.member}</strong><pre>{JSON.stringify(step.action==='set'?step.value:step.args,null,2)}</pre></div>)}</details></div>:textReview?<div className="review-text">{review.plan.operations?.length?review.plan.operations.map(op=>{const block=review.plan.before.blocks.find(b=>b.id===op.blockId);return <div className="review-block" key={op.blockId}><strong>{block?.label||op.blockId}</strong><dl><dt>변경 전</dt><dd>{block?.text}</dd><dt>변경 후</dt><dd>{op.text}</dd></dl></div>;}):<dl><dt>변경 전</dt><dd>{review.plan.before.text}</dd><dt>변경 후</dt><dd>{review.plan.replacement}</dd></dl>}</div>:<div className="review-table"><table><thead><tr><th>셀</th><th>입력할 수식</th></tr></thead><tbody>{review.plan.operations.map(op=><tr key={op.address}><td>{op.address}</td><td><code>{op.formula}</code></td></tr>)}</tbody></table></div>}<div className="review-actions"><CxButton onClick={()=>send({type:'approve',runId:review.runId,planId:review.planId,approved:false})}>{review.plan.name==='save_markdown'?'저장 안 함':'적용 안 함'}</CxButton><CxButton variant="primary" onClick={()=>send({type:'approve',runId:review.runId,planId:review.planId,approved:true})}>{review.plan.name==='save_markdown'?'저장':review.checkpoint?.available===false?"복원 사본 없이 적용":"변경 적용"}</CxButton></div></section>}
      {contextNotice&&<p className="office-context-notice" role="status">{contextNotice}</p>}
      </div></div>
      {scroll.away&&<CxButton className="latest" onClick={scroll.followLatest}>최근 답변으로 이동</CxButton>}
      {busy&&!contextBusy&&!question&&!review&&<div className="run-status" role="status"><span className="status-spinner"/>{status}</div>}
      {contextBusy&&<div className="office-context-status" role="status"><span>대화 요약 중</span><CxButton onClick={()=>busy?send({type:'cancel'}):command('cancel',{conversationId:active.id},'context').catch(()=>{})}>취소</CxButton></div>}
      <div className="office-composer-dock"><section className="composer nubi-compose-card" aria-label="메시지 작성"><div className="nubi-composer-surface">
<div className="nubi-composer-input"><NubiComposerInput rows={1} inputRef={composerInput} value={draft} maxLength={8000} placeholder={app.placeholder} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();submit();}}}/></div>
        <NubiComposerBar leading={<><ModelPicker data={data} providerLabels={labels} disabled={busy||controlBusy||contextBusy||!ready} onOpen={()=>setDialog('models')} onRefresh={()=>refresh().catch(()=>{})}/>{provider.connected&&provider.reasoningOptions?.length>0&&<ReasoningPicker api={reasoningApi} provider={provider} disabled={busy||controlBusy||contextBusy||!!provider.pending}/>}</>} tools={<><ContextMeter messages={active.messages.map(m=>({role:m.role,content:m.text||''}))} draft={draft} model={{...catalogModel,name:catalogModel.id,displayName:catalogModel.label}} busy={busy||controlBusy||contextBusy} usageInfo={meter} stats={contextRecord?.stats} onCompact={compactContext}/>{busy?<CxButton className="nubi-composer-stop" data-icon-only aria-label="중지" title="작업 중지" onClick={()=>send({type:'cancel'})}><span className="stop-symbol" aria-hidden="true"/></CxButton>:<CxButton type="submit" data-icon-only aria-label="보내기" title="보내기" variant="primary" disabled={!draft.trim()||!provider.connected||!!provider.pending||!ready||controlBusy||contextBusy||!!provider.authBusy||!provider.model||!(provider.models||[]).some(m=>m.id===provider.model)} onClick={submit}><Icon name="arrowUp" size={18}/></CxButton>}</>}/>
      </div></section><div className="office-context-caption" aria-label="문맥 사용량"><span>{meter.used===null?'사용량 미제공':`${meter.kind==='estimated'?'≈ ':''}${meter.used.toLocaleString()} 토큰`}</span><span>{remainingPercent}</span></div></div>
    </>}
    {dialog==='target'&&<OfficeDialog icon="file" title="어디에 만들까요?" className="office-form deck-dialog nubi-decision-dialog" onClose={()=>{setDialog(null);setPendingRequest('');}}><p>현재 문서를 수정하거나 새 문서를 열어 작성합니다.</p><div className="target-choices"><CxButton onClick={()=>submit('current')}><strong>현재 문서</strong><span>지금 열린 문서에 적용</span></CxButton><CxButton onClick={()=>submit('new')}><strong>새 문서</strong><span>새 창에서 작성하고 Agent 이어가기</span></CxButton></div></OfficeDialog>}
    {dialog==='checkpoints'&&<OfficeDialog icon="clockRewind" title="문서 복원" className="office-form deck-dialog nubi-decision-dialog" onClose={()=>setDialog(null)}><p className="form-help">복원할 시점을 선택하세요. 새 창에 복원됩니다.</p>{checkpoints.length?checkpoints.map(c=><CxButton className="checkpoint-row" key={c.id} onClick={()=>{setDialog(null);started.current=performance.now();setBusy(true);setConversations(rows=>rows.map(row=>row.id===active.id?{...row,messages:[...row.messages,{role:'user',text:'문서 복원: '+c.label},{role:'assistant',text:''}]}:row));send({type:'rollback',checkpointId:c.id,conversationId:active.id});}}><strong>{c.label}</strong><span>{c.document}</span></CxButton>):<p className="muted">아직 복원 지점이 없습니다.</p>}</OfficeDialog>}
    {dialog==='models'&&<ModelForm data={data} loading={loading} connectingProvider={loginProvider} connectionError={error} catalogProblem={catalogProblem} disabled={busy||contextBusy||!ready||controlBusy||!!provider.authBusy} providerLabels={labels} onClose={()=>setDialog(null)} onLogin={login} onCancelLogin={()=>action('cancelLogin')} onLogout={id=>action('disconnect',id)} onRefresh={input=>refresh(input).catch(()=>{})} onSelect={async(id,p)=>{try{await action('select',p);await action('model',id);return true;}catch{return false;}}}/> }
    {dialog==='fabrix'&&<Fabrix onClose={()=>setDialog(null)} onConnect={async values=>{await action('connect',{provider:'fabrix',...values});setDialog(null);}}/>}
  </div></main></div>;
}
function Fabrix({onClose,onConnect}){
  const [values,setValues]=useState({endpoint:'',clientKey:'',token:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <OfficeDialog icon="sliders" title="FabriX 연결" className="office-form deck-dialog nubi-decision-dialog" busy={busy} onClose={onClose} footer={<><CxButton disabled={busy} onClick={onClose}>취소</CxButton><CxButton type="submit" form="office-fabrix-form" variant="primary" busy={busy}>연결</CxButton></>}><form id="office-fabrix-form" className="office-connection-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onConnect(values);}catch(e){setError(e.message);}finally{setBusy(false);}}}>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}{[['endpoint','서버 주소','url'],['clientKey','클라이언트 키','password'],['token','접속 토큰','password']].map(([key,label,type])=><label className="connection-field" key={key}>{label}<CxInput required type={type} autoComplete="off" value={values[key]} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}</form></OfficeDialog>;
}
class ScreenBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){if(available)send({type:'ui_fault',stage:'render'});}
  render(){return this.state.failed?<main className="office-recovery"><strong>Agent 화면을 다시 열어주세요</strong><p>진행한 문서 변경은 유지됩니다.</p><button onClick={()=>location.reload()}>화면 다시 열기</button></main>:this.props.children;}
}
createRoot(document.getElementById('root')).render(<ScreenBoundary><App/></ScreenBoundary>);
window.addEventListener('error',()=>{if(available)send({type:'ui_fault',stage:'script'});});
window.addEventListener('unhandledrejection',()=>{if(available)send({type:'ui_fault',stage:'message'});});
