import React,{useState,useRef} from 'react';
import {CxButton,CxSelect,CxInput,CxNotice,ActionButton} from '@e2e/cx-design-system';
import {DeckDisclosure,DeckStatus} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {batchView} from './computer-batch-view.mjs';
import './computer-use.css';

const verbs={invoke:'누르기',click:'클릭',hover:'마우스 올리기',set_value:'입력',select:'선택',toggle_on:'체크 켜기',toggle_off:'체크 끄기',expand:'펼치기',collapse:'접기',pointer_click:'마우스로 클릭',pointer_double_click:'더블 클릭',pointer_right_click:'오른쪽 클릭',drag:'드래그',batch:'묶음 입력'};
const states={proposed:'승인 대기',starting:'실행 중',observed:'결과 확인',stale:'대상 변경됨',attention:'확인 필요',rejected:'실행하지 않음',acknowledged:'사용자 확인됨'};
const errors={computer_connection_changed:'연결 요청이 바뀌었어요. 현재 요청을 다시 확인해 주세요.',computer_connection_pending:'대화에서 연결할 앱을 선택해 주세요.',computer_document_required:'이 작업에서 확인한 문서 분석을 연결해 주세요.',computer_document_stale:'분석 근거가 바뀌었어요. 최신 문서로 다시 확인해 주세요.',computer_virtual_only:'사용자 커서를 움직이는 동작은 지원하지 않습니다. 앱이 제공하는 버튼이나 입력 기능을 사용해 주세요.',computer_binding_required:'먼저 확인할 창을 연결해 주세요.',computer_app_invalid:'로컬 Windows 실행 파일의 전체 경로를 확인해 주세요.',computer_app_changed:'실행 파일이 바뀌었어요. 앱을 다시 등록해 주세요.',computer_app_limit:'등록한 앱이 많아요. 사용하지 않는 앱을 해제해 주세요.',computer_app_required:'이 작업에서 사용할 앱을 먼저 등록해 주세요.',computer_review_required:'대기 중인 동작이나 미확정 결과를 먼저 확인해 주세요.',computer_busy:'진행 중인 작업을 마친 뒤 다시 확인해 주세요.',computer_unavailable:'Windows 실행기 연결이 필요해요.',computer_binary_changed:'실행기 파일이 바뀌었어요. 설치 설정을 확인해 주세요.',computer_command_failed:'앱을 확인하지 못했어요. 창이 열려 있는지 확인해 주세요.',computer_contract:'실행기 응답 형식을 지원하지 않아요. 연결 버전을 확인해 주세요.',computer_target_changed:'창이나 대상이 바뀌었어요. 다시 연결해 주세요.',computer_cancelled:'중지한 작업입니다. 새 요청에서 연결해 주세요.'};

// The overlay marks an observed element center. It is not an OS cursor recording.
export function ActionPreview({image,action='click',pointer={x:0.5,y:0.5},demo=false,physical=false,label='예정 동작',caption,children}){
  const [replay,setReplay]=useState(0),[motion,setMotion]=useState(true),[loaded,setLoaded]=useState(false);
  const valid=pointer&&[pointer.x,pointer.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1);
  return <figure className="nubi-action-preview" aria-label={demo?'커서 표시 예시':'컴퓨터 동작 미리보기'}>
    <div className="nubi-action-preview-head"><span>{label} <strong>{verbs[action]}</strong></span>{demo&&<span className="nubi-inline"><CxButton aria-label="커서 모션" aria-pressed={motion} onClick={()=>setMotion(!motion)}>{motion?'모션 끄기':'모션 켜기'}</CxButton><ActionButton action="refresh" label="다시 보기" onClick={()=>setReplay(v=>v+1)}/></span>}</div>
    <div className="nubi-action-stage" data-motion={motion?'on':'off'} style={image?{width:Math.min(560,image.width*2,280*image.width/image.height),maxWidth:'100%',marginInline:'auto'}:undefined}>
      {image?<img key={image.data.slice(-80)} src={'data:image/png;base64,'+image.data} width={image.width} height={image.height} alt="관찰한 대상 영역" onLoad={()=>setLoaded(true)} onError={()=>setLoaded(false)}/>:children}
      {valid&&(demo||loaded)&&<div key={replay} className={'nubi-action-pointer is-'+action} style={{left:`${pointer.x*100}%`,top:`${pointer.y*100}%`}} aria-hidden="true">
        <span className="nubi-action-halo" data-demo={demo?'true':'false'}/>
        <svg viewBox="-2 -2 34 38"><path d="M1 1Q-1 0 0 4L10 29Q12 33 14 29L17 20L26 17Q30 15 26 13L4 1Q2 0 1 1Z"/></svg>
      </div>}
    </div>
    <figcaption>{caption?caption:demo?'표시 예시입니다. 실제 앱을 조작하지 않습니다.':pointer?(physical?'실제 마우스가 이동할 대상 위치입니다. 실행 전 미리보기입니다.':'표시는 대상의 중심입니다. 누비의 가상 커서이며 사용자 마우스를 움직이지 않습니다.'):'실행 직후 캡처입니다. 업무 결과는 별도로 확인해 주세요.'}</figcaption>
  </figure>;
}

export function CursorExample(){
  const [action,setAction]=useState('click');
  return <div className="nubi-cursor-example"><div className="nubi-inline" role="group" aria-label="동작 예시 선택">{['click','hover','set_value'].map(v=><CxButton key={v} aria-pressed={action===v} onClick={()=>setAction(v)}>{verbs[v]}</CxButton>)}</div>
    <ActionPreview action={action} pointer={{x:action==='hover'?0.4:action==='set_value'?0.6:0.5,y:0.5}} demo label="표시 예시"><div className="nubi-cursor-example-surface"><span>{action==='set_value'?'요청 내용을 입력하세요':'결과 확인'}</span></div></ActionPreview>
  </div>;
}

function ActionCard({action,api,disabled,run}){
  const [artifacts,setArtifacts]=useState(null),[after,setAfter]=useState(false),[pointerRunning,setPointerRunning]=useState(false),[stopRequested,setStopRequested]=useState(false),[stopError,setStopError]=useState(false);
  const physical=action.inputMode==='shared_pointer';
  const pointerActive=physical&&(pointerRunning||action.state==='starting');
  async function approve(){setPointerRunning(physical);try{await run(()=>api('computer',{method:'decide',taskId:action.taskId,id:action.id,fingerprint:action.fingerprint,decision:'approve',pointerConsent:physical}));}finally{setPointerRunning(false);}}
  async function stop(){setStopError(false);try{await api('stopAgent',{taskId:action.taskId});setStopRequested(true);}catch{setStopError(true);}}
  if(action.action==='launch')return <LaunchCard action={action} api={api} disabled={disabled} run={run}/>;
  if(action.action==='batch')return <BatchCard action={action} api={api} disabled={disabled} run={run}/>;
  return <section className="nubi-recovery-card" aria-label="컴퓨터 동작 승인">
    <div className="nubi-inline"><strong>{verbs[action.action]}: {action.target.element.name||action.target.element.type}</strong><DeckStatus>{states[action.state]||'확인 필요'}</DeckStatus></div>
    <p>{action.reason}</p>
    {action.repeats&&action.state==='proposed'&&<CxNotice tone="info">같은 동작을 앞서 {action.repeats.times}번 실행했지만 창에서 달라진 것을 확인하지 못했습니다.</CxNotice>}
    {physical&&action.pointerFallback?.eligible&&action.state==='proposed'&&<p className="nubi-muted">앱의 기본 조작이 지원되지 않아 마우스 제어를 요청합니다.</p>}
    {physical&&<CxNotice tone="info">{pointerActive?'실제 마우스 조작 중입니다. 잠시 마우스와 키보드 사용을 멈춰 주세요.':action.state==='proposed'?'승인하면 사용자 마우스가 움직입니다. 이 동작 한 번만 허용합니다.':'사용자 마우스 제어 요청 기록입니다. 실제 결과를 확인해 주세요.'}</CxNotice>}
    {action.destination&&<p className="nubi-muted">{action.target.element.name||action.selector} → {action.destination.element.name||action.destinationSelector}</p>}
    {pointerActive&&<div role="status"><CxButton disabled={stopRequested} onClick={stop}>{stopRequested?'중지 요청됨':'작업 중지'}</CxButton><p className="nubi-muted">이미 시작한 짧은 동작은 끝날 수 있습니다. 이후 단계는 진행하지 않습니다.</p>{stopError&&<p>중지 요청을 보내지 못했습니다. 다시 시도해 주세요.</p>}</div>}
    {!!action.wikiEvidence?.length&&<details><summary>OpenWiki-SDS 근거 {action.wikiEvidence.length}개</summary>{action.wikiEvidence.map(row=><p className="nubi-muted" key={row.evidenceId}>{row.path}:{row.start} {row.freshness==='source_matched'?'참조 버전 일치':'검증되지 않은 참고 정보'}</p>)}</details>}
    {action.documentEvidence&&<details><summary>문서 분석 근거 {action.documentEvidence.sources?.length||0}개</summary>{action.documentEvidence.sources?.map(row=><p className="nubi-muted" key={row.path}><strong>{row.path}</strong> / {Number(row.characters||0).toLocaleString('ko-KR')}자</p>)}<p className="nubi-muted">{action.documentEvidence.status==='partial'?'일부만 확인한 분석입니다. 미열람 구간과 결과를 확인해 주세요.':'분석은 참고 근거입니다. 앱의 실제 결과는 별도로 확인합니다.'}</p></details>}
    <p className="nubi-muted">{action.identity.windowTitle} ({action.identity.processName})</p>
    {action.action==='set_value'&&<pre>{action.value||'(빈 값)'}</pre>}
    {!artifacts?<CxButton disabled={disabled} onClick={()=>run(async()=>setArtifacts(await api('computer',{method:'artifact',taskId:action.taskId,id:action.id})))}>대상 위치 보기</CxButton>:<>
      {artifacts.after&&<CxButton aria-pressed={after} onClick={()=>setAfter(!after)}>{after?'동작 전 보기':'동작 후 보기'}</CxButton>}
      <ActionPreview key={after?'after':'before'} image={after?artifacts.after:artifacts.before} action={action.action} physical={physical} pointer={after?null:action.pointer} label={after?'동작 후 화면':action.state==='proposed'?'예정 동작':'동작 전 대상'}/>
      {!after&&artifacts.destinationBefore&&<ActionPreview image={artifacts.destinationBefore} action="drag" physical label="도착 위치"/>}
    </>}
    {action.state==='proposed'?<div className="nubi-inline">
      <CxButton variant="primary" disabled={disabled||(physical&&(!artifacts?.before||(action.action==='drag'&&!artifacts?.destinationBefore)))} onClick={approve}>{physical?'마우스 제어 승인':'승인하고 실행'}</CxButton>
      <CxButton disabled={disabled} onClick={()=>run(()=>api('computer',{method:'decide',taskId:action.taskId,id:action.id,fingerprint:action.fingerprint,decision:'reject'}))}>실행하지 않기</CxButton>
    </div>:<p className="nubi-muted">{action.state==='observed'?(action.verification==='value_matched'?'입력값이 일치합니다. 업무 결과는 별도로 확인해 주세요.':action.verification==='state_matched'?(action.execution==='already_at_target'?'이미 요청한 상태여서 다시 조작하지 않았습니다.':'요청한 설정 상태를 확인했습니다. 업무 결과는 별도로 확인해 주세요.'):'동작 후 화면을 받았습니다. 업무 결과를 확인해 주세요.'):action.state==='stale'?(action.error==='computer_document_stale'?'문서 분석의 원본이 바뀌어 실행하지 않았습니다. 최신 문서로 다시 확인해 주세요.':action.error==='wiki_evidence_stale'?'OpenWiki-SDS 근거가 바뀌어 실행하지 않았습니다. 최신 근거로 다시 제안해 주세요.':'대상이 바뀌어 실행하지 않았습니다. 현재 화면으로 다시 제안해 주세요.'):action.state==='attention'?'실제 앱의 결과를 확인해 주세요. 같은 동작을 자동으로 반복하지 않습니다.':action.state==='acknowledged'?'사용자가 결과를 확인했습니다. 업무 성공 판정과는 별개입니다.':action.state==='rejected'?'이 동작은 실행하지 않았습니다.':'실행 결과를 기다립니다.'}</p>}
    {action.state==='attention'&&<CxButton disabled={disabled} onClick={()=>run(()=>api('computer',{method:'decide',taskId:action.taskId,id:action.id,fingerprint:action.fingerprint,decision:'acknowledge'}))}>실제 결과를 확인했어요</CxButton>}
    <ResultReview action={action} api={api} disabled={disabled} run={run}/>
  </section>;
}

// One approval for several inputs. Every step stays visible: the user approves what the card shows.
function BatchCard({action,api,disabled,run}){
  const [artifacts,setArtifacts]=useState(null),[after,setAfter]=useState(false),view=batchView(action,verbs);
  const decide=decision=>run(()=>api('computer',{method:'decide',taskId:action.taskId,id:action.id,fingerprint:action.fingerprint,decision}));
  return <section className="nubi-recovery-card" aria-label="컴퓨터 동작 묶음 승인">
    <div className="nubi-inline"><strong>{view.title}</strong><DeckStatus>{states[action.state]||'확인 필요'}</DeckStatus></div>
    <p>{action.reason}</p>
    <ol className="nubi-batch-steps">{view.steps.map(step=><li key={step.index}><span>{step.label}</span>{step.value!==undefined&&<pre>{step.value||'(빈 값)'}</pre>}{step.result&&<small role="status">{step.result}</small>}</li>)}</ol>
    {!!action.wikiEvidence?.length&&<details><summary>OpenWiki-SDS 근거 {action.wikiEvidence.length}개</summary>{action.wikiEvidence.map(row=><p className="nubi-muted" key={row.evidenceId}>{row.path}:{row.start} {row.freshness==='source_matched'?'참조 버전 일치':'검증되지 않은 참고 정보'}</p>)}</details>}
    {action.documentEvidence&&<details><summary>문서 분석 근거 {action.documentEvidence.sources?.length||0}개</summary>{action.documentEvidence.sources?.map(row=><p className="nubi-muted" key={row.path}><strong>{row.path}</strong> / {Number(row.characters||0).toLocaleString('ko-KR')}자</p>)}</details>}
    <p className="nubi-muted">{action.identity.windowTitle} ({action.identity.processName})</p>
    {!artifacts?<CxButton disabled={disabled} onClick={()=>run(async()=>setArtifacts(await api('computer',{method:'artifact',taskId:action.taskId,id:action.id})))}>창 화면 보기</CxButton>:<>
      {artifacts.after&&<CxButton aria-pressed={after} onClick={()=>setAfter(!after)}>{after?'실행 전 보기':'실행 후 보기'}</CxButton>}
      <ActionPreview key={after?'after':'before'} image={after?artifacts.after:artifacts.before} action="batch" pointer={null} label={after?'실행 후 화면':'실행 전 화면'} caption={after?'마지막 단계 직후의 창입니다. 업무 결과는 별도로 확인해 주세요.':'제안할 때의 창입니다. 입력 위치는 위 단계 목록의 컨트롤입니다.'}/>
    </>}
    <p className="nubi-muted">{view.summary}</p>
    {action.state==='proposed'&&<div className="nubi-inline">
      <CxButton variant="primary" disabled={disabled} onClick={()=>decide('approve')}>모두 승인하고 실행</CxButton>
      <CxButton disabled={disabled} onClick={()=>decide('reject')}>실행하지 않기</CxButton>
    </div>}
    {action.state==='attention'&&<CxButton disabled={disabled} onClick={()=>decide('acknowledge')}>실제 결과를 확인했어요</CxButton>}
    <ResultReview action={action} api={api} disabled={disabled} run={run}/>
  </section>;
}

function ResultReview({action,api,disabled,run}){
  if(action.state!=='observed')return null;
  return <div className="nubi-computer-review">
    {action.review?.state==='finished'?<p className="nubi-muted">분석 결과는 대화에서 확인하세요. 다음 동작은 별도로 승인합니다.</p>:<CxButton disabled={disabled||action.review?.state==='running'} onClick={()=>run(()=>api('computer',{method:'review_result',taskId:action.taskId,id:action.id,fingerprint:action.fingerprint}))}>{action.review?.state==='running'?'결과 분석 중':'결과 분석하고 이어가기'}</CxButton>}
    {action.review?.state==='unavailable'&&<p className="nubi-muted">동작 기록은 보존했습니다. 모델 연결을 확인한 뒤 다시 분석해 주세요.</p>}
    {action.review?.state==='interrupted'&&<p className="nubi-muted">분석이 중단되었습니다. 앱을 다시 조작하지 않고 기록부터 확인합니다.</p>}
  </div>;
}

function LaunchCard({action,api,disabled,run}){
  const decide=decision=>run(()=>api('computer',{method:'decide',taskId:action.taskId,id:action.id,fingerprint:action.fingerprint,decision}));
  return <section className="nubi-recovery-card" aria-label="프로그램 실행 승인">
    <div className="nubi-inline"><strong>앱 실행: {action.app.name}</strong><DeckStatus>{states[action.state]||'확인 필요'}</DeckStatus></div>
    <p>{action.reason}</p><p className="nubi-muted" style={{overflowWrap:'anywhere'}}>{action.app.path}</p>
    {action.state==='proposed'?<><p className="nubi-muted">이 프로그램을 한 번 실행합니다. 창의 내용은 연결한 뒤 모델에 전달됩니다.</p><div className="nubi-inline"><CxButton variant="primary" disabled={disabled} onClick={()=>decide('approve')}>승인하고 실행</CxButton><CxButton disabled={disabled} onClick={()=>decide('reject')}>실행하지 않기</CxButton></div></>:<p className="nubi-muted">{action.verification==='window_observed'?'실행한 프로세스의 창을 확인했습니다. 연결할 창을 선택해 주세요.':action.state==='attention'?'실행 결과를 확인해야 합니다. 다시 실행하지 않고 열린 창만 조회합니다.':action.error==='computer_app_running'?'같은 이름의 앱이 열려 있습니다. 열린 앱 찾기에서 확인해 주세요.':action.state==='stale'?'등록이나 파일이 바뀌었거나 승인이 만료되어 실행하지 않았습니다.':action.state==='rejected'?'이 프로그램은 실행하지 않았습니다.':action.state==='acknowledged'?'사용자가 실제 결과를 확인했습니다.':'실행 결과를 기다립니다.'}</p>}
    {(action.windows||[]).map(w=><CxButton key={w.hwnd} disabled={disabled} onClick={()=>run(()=>api('computer',{method:'bind',taskId:action.taskId,window:w.hwnd,expectedIdentity:w.identity}))}>{w.title} 연결</CxButton>)}
    {['attention','observed'].includes(action.state)&&action.pid&&<CxButton disabled={disabled} onClick={()=>run(()=>api('computer',{method:'refresh_launch',taskId:action.taskId,id:action.id}))}>열린 창 다시 확인</CxButton>}
    {action.state==='attention'&&<CxButton disabled={disabled} onClick={()=>decide('acknowledge')}>실제 결과를 확인했어요</CxButton>}
    <ResultReview action={action} api={api} disabled={disabled} run={run}/>
  </section>;
}

export function ComputerUse({taskId,state,api,refresh,disabled,showControls=true,showActions=true,expanded=false}){
  const [windows,setWindows]=useState([]),[searched,setSearched]=useState(false),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[appPath,setAppPath]=useState('');
  const lock=useRef(false),binding=state?.binding?.taskId===taskId?state.binding:null;
  async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(errors[e.message]||'작업을 마치지 못했어요. 현재 앱과 실행 기록을 확인해 주세요.');}finally{lock.current=false;setBusy(false);}}
  const blocked=disabled||busy;
  const Controls=expanded?'section':DeckDisclosure;
  return <>
    {!showControls&&error&&<CxNotice tone="danger">{error}</CxNotice>}
    {showActions&&(state?.actions||[]).filter(v=>v.taskId===taskId).map(action=><ActionCard key={action.id+action.state} action={action} api={api} run={run} disabled={blocked}/>)}
    {showActions&&(state?.checks||[]).filter(v=>v.taskId===taskId).slice(0,3).map(v=><p key={v.id} className="nubi-muted" role="status">{v.name||v.selector}: {v.verification==='value_matched'?'예상한 값과 일치합니다.':'예상한 값과 다릅니다.'} 저장이나 제출 여부는 별도로 확인합니다.</p>)}
    {showControls&&<Controls title={expanded?undefined:binding?'컴퓨터 연결: '+binding.processName:'컴퓨터로 확인'}>
      {error&&<CxNotice tone="danger">{error}</CxNotice>}
      {state?.availability?.available?<>
        <p className="nubi-muted">창의 내용과 이미지를 모델에 전달합니다. 창이 앞으로 나올 수 있으며, 조작은 별도로 승인합니다.</p>
        {binding?<div className="nubi-inline"><span>{binding.windowTitle}</span><CxButton disabled={blocked} onClick={()=>run(()=>api('computer',{method:'unbind',taskId}))}>연결 해제</CxButton></div>:<>
          <CxButton disabled={blocked} onClick={()=>run(async()=>{const value=await api('computer',{method:'windows',taskId});setWindows(value.windows);setSelected('');setSearched(true);})}>열린 앱 찾기</CxButton>
          {searched&&!windows.length&&<p className="nubi-muted">연결할 창을 찾지 못했어요. 앱을 연 뒤 다시 찾아 주세요.</p>}
          {windows.length>0&&<div className="nubi-inline"><CxSelect aria-label="연결할 앱" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">앱을 선택하세요</option>{windows.map(w=><option key={w.hwnd} value={w.hwnd}>{w.title} ({w.processName})</option>)}</CxSelect><CxButton disabled={blocked||!selected} onClick={()=>run(()=>api('computer',{method:'bind',taskId,window:Number(selected),expectedIdentity:windows.find(w=>String(w.hwnd)===selected)?.identity}))}>이 창 연결</CxButton></div>}
        </>}
        <DeckDisclosure title="프로그램 실행">
          <p className="nubi-muted">이 작업에서 사용할 Windows 실행 파일을 등록하세요. 등록만으로 실행되지는 않습니다.</p>
          <CxButton disabled={blocked} onClick={()=>run(()=>api('chooseComputerApp',{taskId}))}>앱 파일 선택</CxButton>
          <label htmlFor={'nubi-app-path-'+taskId}>실행 파일 (.exe)</label><CxInput id={'nubi-app-path-'+taskId} value={appPath} onChange={e=>setAppPath(e.target.value)} placeholder={'C:\\Program Files\\앱\\app.exe'} disabled={blocked}/>
          <CxButton disabled={blocked||!appPath.trim()} onClick={()=>run(async()=>{await api('computer',{method:'register_app',taskId,file:appPath.trim()});setAppPath('');})}>앱 등록</CxButton>
          {(state?.apps||[]).filter(v=>v.taskId===taskId).map(app=><div className="nubi-inline" key={app.id}><span title={app.path}>{app.name}</span><CxButton disabled={blocked} onClick={()=>run(()=>api('computer',{method:'propose_launch',taskId,appId:app.id}))}>실행 준비</CxButton><CxButton disabled={blocked} aria-label={app.name+' 등록 해제'} onClick={()=>run(()=>api('computer',{method:'remove_app',taskId,appId:app.id}))}>등록 해제</CxButton></div>)}
        </DeckDisclosure>
      </>:<p className="nubi-muted">{state?.availability?.reason==='windows_required'?'앱 조작은 Windows 실행 환경에서 연결할 수 있어요.':'앱 조작을 사용하려면 Windows 실행기를 연결해야 해요.'}</p>}
      <DeckDisclosure title="동작 표시 예시"><CursorExample/></DeckDisclosure>
    </Controls>}
  </>;
}
