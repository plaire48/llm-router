import React,{useEffect,useRef,useState} from 'react';
import {ActionButton,CxButton,CxInput,CxTextarea,CxSelect,CxCheckbox,CxNotice,Icon} from '@e2e/cx-design-system';
import {DeckField, DeckGuidance,DeckSectionLabel} from './DeckSurfaces.jsx';
import {ERROR_TEXT} from '../core.js';
const states={scheduled:'예약됨',running:'실행 중',launching:'시작 확인 중',unknown:'실행 결과 미확인',missed:'예약 시간 지남',context_changed:'대화와 연결 확인 필요',waiting:'다른 작업으로 중단',awaiting_user:'승인 대기',failed:'중단됨',paused:'일시 중지',blocked:'조직 정책으로 제한'};
const resumable=new Set(['waiting','context_changed','missed','paused','blocked','done','failed']);
const stopReasons={expired:'시간 제한으로 종료',tab_closed:'녹화 탭이 닫혀 종료',step_limit:'100단계에 도달해 종료',navigation:'다른 사이트로 이동해 종료'};
const siteName=url=>{try{return new URL(url).hostname;}catch{return '현재 사이트';}};
const actionCount=steps=>(steps||[]).filter(step=>step.kind!=='navigate').length;
const stepName=step=>step.kind==='navigate'?`사이트 열기: ${siteName(step.url)}`:`${step.kind==='input'?'입력 항목':'클릭'}: ${step.label||'이름 없는 항목'}`;
function RecordingStep({step}) {
  return <li><Icon name={step.kind==='navigate'?'linkExternal':step.kind==='input'?'pencil':'arrowRight'} size={16}/><span>{stepName(step)}</span></li>;
}

export function BrowserRoutinesSettings({rpc,disabled,onBusy,onRecordingStart,scheduleTemplate,onScheduleTemplateApplied}) {
  const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState(''),[scheduleFeedback,setScheduleFeedback]=useState(''),[replaceConfirm,setReplaceConfirm]=useState(false);
  const mounted=useRef(false),refreshVersion=useRef(0),draftId=useRef(null),section=useRef(null),guide=useRef(null),positioned=useRef(false),savedList=useRef(null);
  const [workflow,setWorkflow]=useState({name:'',prompt:''});
  const [scheduleDraft,setScheduleDraft]=useState({name:'',prompt:'',url:'',when:'',repeat:'once'}),[fieldErrors,setFieldErrors]=useState({}),[rescheduleId,setRescheduleId]=useState(null);
  const scheduleSection=useRef(null),scheduleForm=useRef(null);
  function editSchedule(field,value){setScheduleDraft(current=>({...current,[field]:value}));setScheduleFeedback('');setFieldErrors(current=>{const next={...current};delete next[field];return next;});}
  const refresh=async()=>{
    const version=++refreshVersion.current;
    try{const value=await rpc('GET_BROWSER_ROUTINES');if(mounted.current&&version===refreshVersion.current){
      if(draftId.current!==value.draft?.id){draftId.current=value.draft?.id||null;setWorkflow({name:'',prompt:''});setReplaceConfirm(false);}
      setData(value);setError('');}}
    catch(e){if(mounted.current&&version===refreshVersion.current)setError('작업 설정을 읽지 못했습니다.');throw e;}
  };
  useEffect(()=>{
    mounted.current=true;let timer;
    const queue=()=>{clearTimeout(timer);timer=setTimeout(()=>{void refresh().catch(()=>{});},80);};
    const changed=(changes,area)=>{if(area==='managed'||area==='local'&&['browserRoutines','browserRecordingDraft','browserTransfers'].some(key=>key in changes)||area==='session'&&'browserRecording' in changes)queue();};
    chrome.storage.onChanged.addListener(changed);
    chrome.permissions.onAdded?.addListener(queue);chrome.permissions.onRemoved?.addListener(queue);
    void refresh().catch(()=>{});
    return()=>{mounted.current=false;refreshVersion.current++;clearTimeout(timer);chrome.storage.onChanged.removeListener(changed);chrome.permissions.onAdded?.removeListener(queue);chrome.permissions.onRemoved?.removeListener(queue);};
  },[rpc]);
  useEffect(()=>{if(data?.recording||data?.draft){section.current.open=true;if(data.draft&&!positioned.current){positioned.current=true;requestAnimationFrame(()=>guide.current?.scrollIntoView({block:'start',behavior:'auto'}));}}},[data?.recording?.tabId,data?.draft?.id]);
  useEffect(()=>{
    if(!scheduleTemplate||!data)return;
    setScheduleDraft({name:scheduleTemplate.name,prompt:scheduleTemplate.prompt,url:scheduleTemplate.url,when:'',repeat:'once'});
    setFieldErrors({});setScheduleFeedback('');setRescheduleId(null);
    section.current.open=true;scheduleSection.current.open=true;
    requestAnimationFrame(()=>{scheduleForm.current?.elements.namedItem(scheduleTemplate.url?'when':'url')?.focus();scheduleSection.current?.scrollIntoView({block:'start'});});
    onScheduleTemplateApplied?.();
  },[scheduleTemplate?.id,!!data]);
  async function perform(fn){if(busy)return false;setBusy(true);onBusy(true);setError('');setFeedback('');try{await fn();await refresh();return true;}catch(e){setError(ERROR_TEXT[e.message]||'처리하지 못했습니다. 입력과 연결을 확인해 주세요.');return false;}finally{setBusy(false);onBusy(false);}}
  async function startRecording(replaceDraftId){if(await perform(()=>rpc('START_BROWSER_RECORDING',replaceDraftId?{replaceDraftId}:{}))){setReplaceConfirm(false);onRecordingStart?.();}}
  async function saveRecording(){if(!data?.draft||!workflow.name.trim()||!workflow.prompt.trim())return;
    if(await perform(()=>rpc('SAVE_BROWSER_WORKFLOW',{draftId:data.draft.id,...workflow}))){setFeedback('작업을 저장했습니다. 아래에서 다시 실행할 수 있어요.');if(savedList.current)savedList.current.open=true;}}
  function permission(kind,enabled){
    // Chrome permission requests must begin synchronously in this user gesture.
    const request=enabled?chrome.permissions.request({permissions:[kind]}):Promise.resolve(true);
    perform(async()=>{if(!await request)throw new Error(kind==='downloads'?'download_permission':'notification_permission');if(kind==='notifications')await rpc('SET_BROWSER_NOTIFICATIONS',{enabled});else if(!enabled)await chrome.permissions.remove({permissions:[kind]});});
  }
  function prepareReschedule(job){
    setScheduleDraft({name:job.name,prompt:job.prompt,url:job.url,when:'',repeat:job.repeat});setFieldErrors({});setScheduleFeedback('');setRescheduleId(job.id);
    scheduleSection.current.open=true;
    requestAnimationFrame(()=>{scheduleForm.current?.elements.namedItem('when')?.focus();scheduleSection.current?.scrollIntoView({block:'start'});});
  }
  function schedule(event){
    event.preventDefault();if(disabled||busy)return;
    const form=event.currentTarget,{name,prompt,url,when,repeat}=scheduleDraft,errors={};
    for(const [field,message] of [['name','예약 이름을 입력해 주세요.'],['prompt','실행할 요청을 입력해 주세요.']]){
      if(!scheduleDraft[field].trim()||!form.elements.namedItem(field).checkValidity())errors[field]=message;
    }
    let origin;
    try{const parsed=new URL(url);if(!form.elements.namedItem('url').checkValidity()||!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error();origin=parsed.origin;}
    catch{errors.url='http:// 또는 https:// 주소를 입력해 주세요.';}
    const timestamp=new Date(when).getTime(),now=Date.now();
    // Match validateJob's host boundary before asking Chrome for site access.
    if(!form.elements.namedItem('when').checkValidity()||!Number.isFinite(timestamp))errors.when='실행 시각을 입력해 주세요.';
    else if(timestamp<now+30000||timestamp>now+366*86400000)errors.when='30초 이후부터 366일 이내로 선택해 주세요.';
    if(Object.keys(errors).length){setFieldErrors(current=>({...current,...errors}));form.elements.namedItem(Object.keys(errors)[0]).focus();return;}
    // Remain synchronous with the submit gesture: no async validation before permission.
    const access=chrome.permissions.request({origins:[origin+'/*']});
    void perform(async()=>{if(!await access)throw new Error('page_permission');await rpc(rescheduleId?'CHANGE_BROWSER_ROUTINE':'SAVE_BROWSER_ROUTINE',{
      ...(rescheduleId?{id:rescheduleId,action:'reschedule'}:{}),name,prompt,url,when:timestamp,repeat
    });}).then(ok=>{if(ok){setScheduleFeedback(rescheduleId?'다시 예약했습니다.':'예약했습니다.');setRescheduleId(null);setScheduleDraft({name:'',prompt:'',url:'',when:'',repeat:'once'});}});
  }
  const locked=disabled||busy;
  return <details ref={section} className="integration-settings"><summary><DeckSectionLabel icon="list">녹화와 예약</DeckSectionLabel></summary><div className="integration-content">
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    {!data?<>{!error&&<p role="status">설정을 읽고 있습니다.</p>}{error&&<ActionButton action="refresh" iconOnly label="작업 설정 다시 읽기" onClick={()=>void refresh().catch(()=>{})}/>}</>:<>
      <section ref={guide} className="routine-guide" aria-label="작업 녹화">
        <ol className="routine-flow" aria-label="녹화 순서">
          {[['workflow','사이트 작업'],['eye','기록 확인'],['save','저장']].map(([icon,label],index)=><li key={icon} aria-current={(data.recording&&index===0||data.draft&&index===1)?'step':undefined}><Icon name={icon} size={18}/><span>{label}</span>{index<2&&<Icon name="chevronRight" size={14}/>}</li>)}
        </ol>
        {data.recording?<>
          <div className="routine-recording-meta" role="status"><strong>녹화 중</strong><span>{siteName(data.recording.steps?.[0]?.url)}</span><span>클릭과 입력 {actionCount(data.recording.steps)}개</span></div>
          <p className="reply-note">사이트에서 작업을 마치면 여기서 확인해 주세요.</p>
          <CxButton variant="primary" disabled={locked} onClick={()=>perform(()=>rpc('STOP_BROWSER_RECORDING'))}><Icon name="check" size={18}/>녹화 끝내고 확인</CxButton>
        </>:data.draft?<>
          <div className="routine-recording-meta" role="status"><span><strong>기록 확인</strong> {actionCount(data.draft.steps)}개 동작</span>{stopReasons[data.draft.stopReason]&&<span>{stopReasons[data.draft.stopReason]}</span>}</div>
          <ol role="list" className="routine-step-list">{data.draft.steps.slice(0,3).map((step,i)=><RecordingStep key={i} step={step}/>)}</ol>
          {data.draft.steps.length>3&&<details className="deck-subsection routine-more"><summary>나머지 {data.draft.steps.length-3}단계 보기</summary><ol role="list" className="routine-step-list">{data.draft.steps.slice(3).map((step,i)=><RecordingStep key={i+3} step={step}/>)}</ol></details>}
          <DeckField icon="tag" label="저장할 이름" required><CxInput value={workflow.name} maxLength={80} disabled={locked} onChange={e=>setWorkflow(current=>({...current,name:e.target.value}))}/></DeckField>
          <DeckField icon="taskList" label="다시 할 일" required hint="누비가 끝내야 할 일을 한 문장으로 적어주세요."><CxTextarea rows={3} value={workflow.prompt} maxLength={16000} disabled={locked} placeholder="예: 보고서 초안을 열고 날짜를 바꿔줘" onChange={e=>setWorkflow(current=>({...current,prompt:e.target.value}))}/></DeckField>
          <div className="routine-guide-actions routine-draft-actions"><ActionButton action="save" iconOnly label="이 작업 저장" disabled={locked||!workflow.name.trim()||!workflow.prompt.trim()} onClick={saveRecording}/>{!replaceConfirm&&<ActionButton action="redo" iconOnly label="다시 녹화" disabled={locked} onClick={()=>setReplaceConfirm(true)}/>}</div>
          {replaceConfirm&&<div className="routine-replace" role="group" aria-label="녹화 초안 교체 확인"><p>새 녹화를 끝내면 이 초안이 사라집니다.</p><div className="routine-guide-actions"><CxButton disabled={locked} onClick={()=>setReplaceConfirm(false)}>초안 유지</CxButton><CxButton disabled={locked} onClick={()=>startRecording(data.draft.id)}>초안 버리고 다시 녹화</CxButton></div></div>}
        </>:<>
          <DeckGuidance lead={<>녹화를 켠 뒤 <strong>사이트에서 작업</strong>하세요.</>}>입력값은 저장하지 않습니다.</DeckGuidance>
          <CxButton variant="primary" disabled={locked} onClick={()=>startRecording()}><Icon name="workflow" size={18}/>녹화 시작</CxButton>
        </>}
        {feedback&&<p role="status" className="routine-feedback">{feedback}</p>}
      </section>
      {!!data.workflows.length&&<details ref={savedList} className="deck-subsection routine-saved"><summary>저장한 작업 {data.workflows.length}개</summary><div className="advanced-content">{data.workflows.map(item=><div className="connection-row" key={item.id}><span className="integration-name" title={item.name}>{item.name}</span><div className="integration-actions"><CxButton aria-label={`${item.name} 실행`} disabled={locked} onClick={()=>perform(()=>rpc('RUN_BROWSER_WORKFLOW',{id:item.id}))}><Icon name="play" size={18}/>실행</CxButton><ActionButton action="delete" iconOnly label={`${item.name} 삭제`} disabled={locked} onClick={()=>perform(()=>rpc('DELETE_BROWSER_WORKFLOW',{id:item.id}))}/></div></div>)}</div></details>}
      <CxCheckbox label="다운로드 상태 추적 허용" checked={data.downloadsAllowed} disabled={locked} onChange={event=>permission('downloads',event.target.checked)}/>
      <CxCheckbox label="작업 결과 알림 받기" checked={data.notifications&&data.notificationsAllowed} disabled={locked} onChange={event=>permission('notifications',event.target.checked)}/>
      {!!data.transfers?.length&&<details className="deck-subsection"><summary>다운로드 기록</summary>{data.transfers.map(item=><p className="reply-note" key={item.id}>{item.filename||'파일'}<br/>{({complete:'Chrome 전송 완료',in_progress:'다운로드 중',interrupted:'중단됨',unknown:'결과 미확인',blocked:'정책 제한',unavailable:'기록 없음'})[item.status]||item.status} {item.bytesReceived??0} / {item.totalBytes??'?'} bytes</p>)}<ActionButton action="refresh" iconOnly label="상태 새로고침" disabled={locked} onClick={()=>perform(refresh)}/></details>}
      <details ref={scheduleSection} className="deck-subsection"><summary>작업 예약</summary><form ref={scheduleForm} className="advanced-content" aria-label="작업 예약" noValidate onSubmit={schedule}>
        <DeckGuidance icon="clock" lead={<><strong>Chrome이 열려 있어야</strong> 실행됩니다.</>}>제출과 업로드는 채팅에서 승인합니다.</DeckGuidance>
        {rescheduleId&&<p role="status" className="reply-note">기존 예약을 확인했습니다. 새 시각을 선택해 다시 예약하세요.</p>}
        {scheduleFeedback&&<p role="status" className="routine-feedback">{scheduleFeedback}</p>}
        <details className="deck-subsection"><summary>실행 조건</summary><ul className="routine-conditions"><li>현재 대화, 계정과 모델로 실행합니다.</li><li>다른 작업 중이거나 연결이 바뀌면 확인을 기다립니다.</li><li>중단되거나 시간이 지난 예약은 자동 재시작하지 않습니다. 결과 확인 후 새 시각으로 예약하세요.</li></ul></details>
        <DeckField icon="tag" label="예약 이름" required error={fieldErrors.name}><CxInput name="name" value={scheduleDraft.name} maxLength={80} disabled={locked} onChange={e=>editSchedule('name',e.target.value)}/></DeckField>
        <DeckField icon="taskList" label="실행할 요청" required error={fieldErrors.prompt}><CxTextarea name="prompt" rows={3} value={scheduleDraft.prompt} maxLength={16000} disabled={locked} onChange={e=>editSchedule('prompt',e.target.value)}/></DeckField>
        <DeckField icon="linkExternal" label="시작 페이지" required error={fieldErrors.url}><CxInput name="url" type="url" value={scheduleDraft.url} disabled={locked} onChange={e=>editSchedule('url',e.target.value)}/></DeckField>
        <DeckField icon="clock" label="실행 시각 (이 기기의 시간)" required hint="30초 이후부터 366일 이내" error={fieldErrors.when}><CxInput name="when" type="datetime-local" value={scheduleDraft.when} disabled={locked} onChange={e=>editSchedule('when',e.target.value)}/></DeckField>
        <DeckField icon="refresh" label="반복" hint={['monthly','yearly'].includes(scheduleDraft.repeat)?'월말과 윤년에는 그달 마지막 날에 실행합니다.':undefined}><CxSelect value={scheduleDraft.repeat} disabled={locked} onChange={e=>editSchedule('repeat',e.target.value)}><option value="once">한 번</option><option value="daily">24시간마다</option><option value="weekly">7일마다</option><option value="monthly">매달 같은 날짜</option><option value="yearly">매년 같은 날짜</option></CxSelect></DeckField>
        <CxButton type="submit" disabled={locked}><Icon name="clock" size={18}/>{rescheduleId?'다시 예약':'이 조건으로 예약'}</CxButton>
        {data.jobs.map(job=><div className="connection-row" key={job.id}><span>{job.name}<small className="reply-note"> {job.status==='done'?(job.verified?'결과 확인됨':'응답 도착'):states[job.status]||job.status}<br/>{new Date(job.when).toLocaleString()}</small></span><div className="integration-actions">{resumable.has(job.status)&&<CxButton aria-label={`${job.name} 다시 예약`} disabled={locked} onClick={()=>prepareReschedule(job)}>다시 예약</CxButton>}<CxButton aria-label={`${job.name} 일시 중지`} title="예약 일시 중지" disabled={locked||job.status!=='scheduled'} onClick={()=>perform(()=>rpc('CHANGE_BROWSER_ROUTINE',{id:job.id,action:'pause'}))}>일시 중지</CxButton><ActionButton action="delete" iconOnly label={`${job.name} 예약 삭제`} disabled={locked||['running','launching'].includes(job.status)} onClick={()=>perform(()=>rpc('CHANGE_BROWSER_ROUTINE',{id:job.id,action:'delete'}))}/></div></div>)}
      </form></details>
      <details className="deck-subsection"><summary>조직 정책</summary><p className="reply-note">{Object.keys(data.policy).length?'관리자가 설정한 제한이 적용됩니다.':'적용된 조직 정책이 없습니다.'}</p>{Object.entries(data.policy).map(([key,value])=><p className="reply-note" key={key}>{({AutomationEnabled:'브라우저 작업',UploadsEnabled:'파일 업로드',DownloadsEnabled:'다운로드 도구',RecordingEnabled:'절차 녹화',SchedulingEnabled:'작업 예약',AllowedOrigins:'허용 사이트',BlockedOrigins:'차단 사이트',invalid:'정책 오류'})[key]||key}: {key==='invalid'?'확인 필요':Array.isArray(value)?value.join(', '):value===true?'허용':value===false?'차단':String(value)}</p>)}</details>
    </>}
  </div></details>;
}
