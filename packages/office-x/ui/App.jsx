import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {CxButton,ActionButton,Icon,DetailPanel,CxInput,CxNotice} from '@e2e/cx-design-system';
import {NubiLogin,NubiComposerInput,NubiComposerBar} from '../vendor/nubi/extensions/aipro-chat/src/NubiSurfaces.jsx';
import {ModelPicker,ModelSelection} from '../vendor/nubi/extensions/aipro-chat/src/ChatControls.jsx';
import {NubiLogo} from '../vendor/nubi/extensions/aipro-chat/src/AgentMark.jsx';
import {ReasoningPicker} from '../vendor/nubi/packages/nubi-desktop/ui/ReasoningPicker.jsx';
import {ResponseTime} from '../vendor/nubi/packages/nubi-desktop/ui/ResponseTime.jsx';
import {useConversationScroll} from '../vendor/nubi/packages/nubi-desktop/ui/useConversationScroll.js';
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
import './office.css';
import {officeApps} from './office-apps.js';
import {useGreeting} from './useGreeting.js';
const fresh=()=>({id:crypto.randomUUID(),title:'새 대화',messages:[]});
const toolNames={read_selection:'선택 범위 읽기',read_range:'시트 범위 읽기',read_surrounding:'주변 표 읽기',read_sheet_context:'시트 구조 확인',set_formula:'수식 변경안 확인',calculate_and_read:'계산 결과 검증',replace_text:'문장 변경안 확인',replace_blocks:'문단 변경안 확인',read_outline:'문서 개요 읽기'};
function App(){
  const greeting=useGreeting();
  const [host,setHost]=useState('excel');
  const textHost=host!=='excel';
  const app=officeApps[host]||officeApps.excel;
  const [version,setVersion]=useState('0.4.0');
  const [provider,setProvider]=useState({}),[ready,setReady]=useState(false),[error,setError]=useState(''),[dialog,setDialog]=useState(null),[lost,setLost]=useState(false);
  const [conversations,setConversations]=useState(()=>[fresh()]),[index,setIndex]=useState(0),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false);
  const [target,setTarget]=useState('작업할 부분을 선택하세요'),[status,setStatus]=useState(''),[review,setReview]=useState(null),[loading,setLoading]=useState(false);
  const composerInput=useRef(null),[controlBusy,setControlBusy]=useState(false);
  useLayoutEffect(()=>{const field=composerInput.current;if(!field)return;field.style.height='auto';field.style.height=Math.min(180,field.scrollHeight)+'px';},[draft,provider.connected]);
  const active=conversations[index],current=useRef(active.id),run=useRef(null),started=useRef(0);current.current=active.id;
  const data=modelData(provider),scroll=useConversationScroll(provider.connected||active.messages.length?active.id:'login',active.messages.filter(m=>m.role==='user').length);
  const updateReply=patch=>setConversations(rows=>rows.map(c=>c.id!==current.current?c:{...c,messages:c.messages.map((m,i)=>i===c.messages.length-1&&m.role==='assistant'?{...m,...patch}:m)}));
  useEffect(()=>{
    const unsubscribe=subscribe(m=>{
      if(m.type==='host'){setHost(m.app);setVersion(m.version||'0.4.0');return;}
      if(m.type==='provider_state'){setProvider(m.state);setReady(!m.state.initializing);return;}
      if(m.type==='host_error'){setError(m.error);if(m.operation==='ready')setLost(true);if(!m.id&&!run.current){setBusy(false);updateReply({failed:true,text:m.error});}return;}
      if(m.type==='disconnected'){setLost(true);setProvider({});setReady(false);setBusy(false);setReview(null);updateReply({failed:true,text:'Agent 연결이 끊겼습니다. 문서 변경 결과를 확인해 주세요.'});return;}
      if(m.type==='view'){setTarget(m.target||'작업할 부분을 선택하세요');setStatus(m.status);setBusy(m.running);return;}
      if(m.type==='started'){run.current=m.runId;updateReply({target:m.target});return;}
      if(m.type==='review_closed'){setReview(null);return;}
      if(m.runId!==run.current)return;
      if(m.type==='text')updateReply({text:m.data});
      if(m.type==='phase')setStatus(({requesting:'응답 준비 중',thinking:'요청 검토 중',responding:'답변 작성 중','tool-input':'문서 작업 준비 중','tool-running':'문서 도구 실행 중'})[m.data.kind]||'작업 중');
      if(m.type==='tool')setStatus(toolNames[m.name||m.data]||'문서 도구 실행 중');
      if(m.type==='review')setReview(m);
      if(m.type==='receipt')updateReply({receipt:m.receipt});
      if(m.type==='usage')updateReply({usage:m.data});
      if(m.type==='done'||m.type==='error'){
        setBusy(false);setReview(null);updateReply({... (m.result?.text?{text:m.result.text}:{}),failed:m.type==='error',cancelled:!!m.result?.cancelled,incomplete:!!(m.result?.turnLimit||m.result?.truncated),finished:true,
          timing:{durationMs:performance.now()-started.current}});run.current=null;
      }
    });
    if(available)send({type:'ready'});return unsubscribe;
  },[]);
  async function action(method,input){setError('');try{return await command(method,input);}catch(e){setError(e.message);throw e;}}
  function login(id){if(id==='fabrix'){setDialog('fabrix');return;}void action('login',id).catch(()=>{});}
  function demo(){
    if(busy)return;setError('');setBusy(true);started.current=performance.now();
    setConversations(rows=>rows.map(c=>c.id!==active.id?c:{...c,title:'문서 도구 확인',messages:[...c.messages,{role:'user',text:textHost?'선택한 텍스트 읽기 (모델 전송 없음)':'C1:E4 수식 도구 확인 (모델 전송 없음)'},{role:'assistant',text:'',model:'문서 도구 확인',timing:{elapsedMs:0}}]}));
    try{send({type:'demo',conversationId:active.id});}catch(e){setBusy(false);setError(e.message);}
  }
  function submit(){
    if(busy||controlBusy||!ready||!provider.connected||provider.pending||!draft.trim())return;
    const text=draft.trim();setError('');started.current=performance.now();setBusy(true);
    setConversations(rows=>rows.map(c=>c.id!==active.id?c:{...c,title:c.messages.length?c.title:text.slice(0,32),messages:[...c.messages,{role:'user',text,at:new Date().toISOString()},{role:'assistant',text:'',model:provider.models?.find(m=>m.id===provider.model)?.label||provider.model,timing:{elapsedMs:0,startedAt:new Date().toISOString()}}]}));
    try{send({type:'start',conversationId:active.id,request:text});setDraft('');}catch(e){setBusy(false);setError(e.message);}
  }
  function newChat(){if(busy)return;const next=fresh();setConversations(rows=>[...rows.slice(-19),next]);setIndex(Math.min(conversations.length,19));setDialog(null);setDraft('');}
  async function refresh(input){setLoading(true);try{await action('refreshModels',input||{});}finally{setLoading(false);}}
  async function reasoningApi(method,{input}) {
    if(method!=='provider'||busy||input.expectedProvider!==provider.provider||input.expectedModel!==provider.model)throw Error('reasoning_changed');
    setControlBusy(true);try{return await action('reasoning',input.effort);}finally{setControlBusy(false);}
  }
  return <div className="desktop-shell nubi-desktop-host office-host"><main className="office-shell nubi-workbench" data-workspace-screen={provider.connected||active.messages.length?'conversation':'welcome'}><div className="nubi-workbench-content office-content">
    <header className="topbar"><NubiLogo title="누비 Agent" size={28}/><div className="header-actions">
      <ActionButton action="add" label="새 대화" iconOnly disabled={busy} onClick={newChat}/>
      <ActionButton action="history" label="대화 이력" iconOnly disabled={busy} onClick={()=>setDialog('history')}/>
      <CxButton aria-label="연결 설정" title={`연결 설정 / ${app.name} / 누비 Agent ${version}`} disabled={busy||!ready} onClick={()=>setDialog('models')}><Icon name="sliders" size={20}/></CxButton>
    </div></header>
    {!available&&<CxNotice tone="warning">미리보기 화면입니다. Windows Office에서 실행하세요.</CxNotice>}
    {lost&&<CxButton onClick={()=>{setLost(false);setError('');send({type:'ready'});}}>Agent 다시 연결</CxButton>}
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    {providerLoginError(provider)&&<CxNotice tone="danger">{providerLoginError(provider)}</CxNotice>}
    {!provider.connected&&!active.messages.length?<div className="login-scroll"><NubiLogin providerLabels={labels} intro={{title:greeting,description:'사용할 모델을 연결하세요.'}} pending={data.pending} checkingProvider={!ready&&available&&!lost?'aipro':null} onLogin={login} onCancel={()=>void action('cancelLogin').catch(()=>{})}>
      <details className="connection-help"><summary>연결 안내</summary><p>{app.name} / 누비 Agent {version}</p><p>Claude 연결에는 Claude Code가 필요합니다.</p><p>인증 정보는 Windows와 각 서비스의 인증 도구에서 관리합니다.</p><CxButton disabled={!available||busy} onClick={demo}>모델 없이 도구 확인</CxButton></details>
      {provider.pending&&<details><summary>연결 진행 보기</summary><pre>{providerLoginDiagnostics(provider)}</pre></details>}
    </NubiLogin></div>:<>
      <div className="document-context"><Icon name={app.icon} size={18}/><span title={target}>{target}</span><ActionButton action="refresh" label="선택 범위 확인" iconOnly disabled={busy} onClick={()=>send({type:'inspect'})}/></div>
      <div className="conversation" ref={scroll.viewport} tabIndex={0} aria-label="대화 내용" onScroll={scroll.onScroll} onFocusCapture={scroll.onFocusCapture}><div className="nubi-task office-task" ref={scroll.content}>
        {!active.messages.length&&<div className="empty-chat"><h1>어떤 작업을 할까요?</h1><div className="office-suggestions">{app.suggestions.map(([label,prompt])=><CxButton key={label} onClick={()=>setDraft(prompt)}>{label}</CxButton>)}</div></div>}
        {active.messages.map((m,i)=><article key={i} className={'message '+m.role+' '+(m.role==='user'?'message-user nubi-request':'message-assistant')}>
          <div className={m.role==='user'?'visually-hidden':'message-label answer-model'}>{m.role==='user'?'나':displayLabel(m.model)||'누비'}</div>
          {m.target&&<div className="message-source">{m.target}</div>}
          <div className={"message-text message-body"+(m.role==='user'?' nubi-user-bubble':'')}><Markdown remarkPlugins={[remarkGfm]} components={{a:({children})=><span>{children}</span>,img:()=>null}}>{m.text||(m.failed?'응답을 완료하지 못했습니다. 연결과 문서 결과를 확인해 주세요.':m.cancelled?'작업을 중지했습니다.':busy?'요청을 확인하고 있어요.':'응답이 없습니다.')}</Markdown></div>
          {m.receipt&&<div className="receipt" data-status={m.receipt.status}><strong>{m.receipt.status==='verified'?(m.receipt.cells?'수식 검증 완료':'문장 변경 확인'):m.receipt.status==='rejected'?'변경 안 함':'변경 결과 확인 필요'}</strong><div className="receipt-meta">{m.receipt.status!=='rejected'&&<><span>{m.receipt.cells?`${m.receipt.cells.length}개 셀`:`${m.receipt.count||0}개 문단`}</span><span>저장 전</span></>}</div></div>}
          {(m.failed||m.incomplete)&&<p className="muted">응답을 마치지 못했습니다. 문서 결과를 확인하세요.</p>}
          {m.cancelled&&<p className="muted">중지했습니다. 적용된 변경은 유지됩니다.</p>}
          {m.role==='assistant'&&<footer className="message-actions"><ResponseTime label="" timing={m.timing} live={busy&&i===active.messages.length-1}/>{m.text&&<ActionButton action="copy" label="답변 복사" iconOnly onClick={()=>navigator.clipboard.writeText(m.text).catch(()=>setError('답변을 선택해서 복사해 주세요.'))}/>}</footer>}
        </article>)}
      </div></div>
      {scroll.away&&<CxButton className="latest" onClick={scroll.followLatest}>최근 답변으로 이동</CxButton>}
      {busy&&<div className="run-status" role="status"><span className="status-spinner"/>{status}</div>}
      {review&&<section className="review" aria-label="문서 변경 승인"><strong>{review.plan.before?'문단을 바꿀까요?':'수식을 적용할까요?'}</strong><p>{review.target}</p>{review.plan.before?<div className="review-text">{review.plan.operations?.length?review.plan.operations.map(op=>{const block=review.plan.before.blocks.find(b=>b.id===op.blockId);return <div className="review-block" key={op.blockId}><strong>{block?.label||op.blockId}</strong><dl><dt>변경 전</dt><dd>{block?.text}</dd><dt>변경 후</dt><dd>{op.text}</dd></dl></div>;}):<dl><dt>변경 전</dt><dd>{review.plan.before.text}</dd><dt>변경 후</dt><dd>{review.plan.replacement}</dd></dl>}</div>:<div className="review-table"><table><thead><tr><th>셀</th><th>입력할 수식</th></tr></thead><tbody>{review.plan.operations.map(op=><tr key={op.address}><td>{op.address}</td><td><code>{op.formula}</code></td></tr>)}</tbody></table></div>}<div className="review-actions"><CxButton onClick={()=>send({type:'approve',runId:review.runId,planId:review.planId,approved:false})}>적용 안 함</CxButton><CxButton variant="primary" onClick={()=>send({type:'approve',runId:review.runId,planId:review.planId,approved:true})}>변경 적용</CxButton></div></section>}
      <div className="office-composer-dock"><section className="composer nubi-compose-card" aria-label="메시지 작성"><div className="nubi-composer-surface">
        <div className="nubi-composer-input"><NubiComposerInput rows={1} inputRef={composerInput} value={draft} maxLength={8000} disabled={busy} placeholder={app.placeholder} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&e.keyCode!==229){e.preventDefault();submit();}}}/></div>
        <NubiComposerBar leading={<><ModelPicker data={data} providerLabels={labels} disabled={busy||controlBusy||!ready} onOpen={()=>setDialog('models')} onRefresh={()=>refresh().catch(()=>{})}/>{provider.connected&&provider.reasoningOptions?.length>0&&<ReasoningPicker api={reasoningApi} provider={provider} disabled={busy||controlBusy||!!provider.pending}/>}</>} tools={busy?<CxButton className="nubi-composer-stop" data-icon-only aria-label="중지" title="작업 중지" onClick={()=>send({type:'cancel'})}><span className="stop-symbol" aria-hidden="true"/></CxButton>:<CxButton type="submit" data-icon-only aria-label="보내기" title="보내기" variant="primary" disabled={!draft.trim()||!provider.connected||!!provider.pending||!ready||controlBusy} onClick={submit}><Icon name="arrowUp" size={18}/></CxButton>}/>
      </div></section></div>
    </>}
    {dialog==='models'&&<ModelSelection data={data} loading={loading} disabled={busy} providerLabels={labels} showProviderNames showActionLabels selectWhileLoading onClose={()=>setDialog(null)} onLogin={login} onCancelLogin={()=>action('cancelLogin')} onProviderSelect={id=>action('select',id)} onLogout={id=>action('disconnect',id)} onRefresh={input=>refresh(input).catch(()=>{})} onSelect={async(id,p)=>{try{await action('select',p);await action('model',id);return true;}catch{return false;}}}/> }
    {dialog==='history'&&<DetailPanel title="대화 이력" variant="modal" hideHelp onClose={()=>setDialog(null)}><p className="muted">창을 닫으면 대화가 지워집니다.</p><CxButton onClick={newChat}>새 대화</CxButton>{conversations.map((c,i)=><CxButton className="history-row" key={c.id} aria-pressed={index===i} onClick={()=>{setIndex(i);setDialog(null);setDraft('');}}>{c.title}</CxButton>)}</DetailPanel>}
    {dialog==='fabrix'&&<Fabrix onClose={()=>setDialog(null)} onConnect={async values=>{await action('connect',{provider:'fabrix',...values});setDialog(null);}}/>}
  </div></main></div>;
}
function Fabrix({onClose,onConnect}){
  const [values,setValues]=useState({endpoint:'',clientKey:'',token:''}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <DetailPanel title="FabriX 연결" variant="modal" hideHelp onClose={busy?undefined:onClose}><form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onConnect(values);}catch(e){setError(e.message);}finally{setBusy(false);}}}>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}{[['endpoint','서버 주소','url'],['clientKey','클라이언트 키','password'],['token','접속 토큰','password']].map(([key,label,type])=><label className="connection-field" key={key}>{label}<CxInput required type={type} autoComplete="off" value={values[key]} onChange={e=>setValues({...values,[key]:e.target.value})}/></label>)}<CxButton type="submit" variant="primary" busy={busy}>연결</CxButton></form></DetailPanel>;
}
createRoot(document.getElementById('root')).render(<App/>);
