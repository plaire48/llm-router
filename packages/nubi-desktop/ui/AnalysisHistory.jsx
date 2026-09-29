import {AnalysisReviewProgress} from './AnalysisReviewProgress.jsx';
import {mergeRoleHistory} from './analysis-history-state.mjs';
import React, {useEffect, useRef, useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {DocumentAnalysisProgress} from './DocumentAnalysisProgress.jsx';

const labels = {analysis_research:'문서와 소스 조사',analysis_review:'독립 검토',analysis_recovery:'실패 원인 확인',analysis_page:'화면 근거 분석'};
const sourceLabels={read_process_output:'실행 기록',read_computer_result:'앱 동작 결과',observe_computer:'앱 화면',read_source:'소스 원문',wiki_query:'Wiki 조회',analyze_documents:'문서 분석',read_document_analysis:'저장된 문서 분석'};
const states = {complete:'응답 정리됨',partial:'일부 확인',interrupted:'분석 중단됨',cancelled:'분석 중지됨',blocked:'확인 필요',failed:'분석 중단됨'};
const key = record => `${record.kind}:${record.id}`;
const count = value => Number.isFinite(value) ? Math.max(0,Math.floor(value)).toLocaleString('ko-KR') : '0';

function RoleProgress({analysis,taskRunning}) {
  const [expanded,setExpanded]=useState(taskRunning&&analysis.state==='running');
  const running=taskRunning&&analysis.state==='running';
  const workers=analysis.workers||[];
  const received=workers.filter(worker=>worker.status==='done').length;
  const open=expanded??running;
  const status=worker=>worker.status==='done'?({partial:'일부 확인',blocked:'확인 필요'}[worker.analysis?.outcome]||'응답 수신'):worker.status==='cancelled'?'중지':worker.status==='error'?'실패':!running?'응답 미확인':worker.status==='queued'?'대기':worker.analysis?.phase==='reading'?'근거 읽는 중':'분석 중';
  return <section className="nubi-document-progress" aria-label="역할별 분석 진행">
    <div className="nubi-document-progress-heading" role="status"><Icon name="layers" size={18}/><strong>{running?'역할을 나눠 확인하고 있어요':states[analysis.state]||'응답 미확인'}</strong><span>응답 {received}/{workers.length}</span></div>
    <details open={open} onToggle={event=>{if(event.target===event.currentTarget&&event.currentTarget.open!==open)setExpanded(event.currentTarget.open);}}>
      <summary>분담과 결과 <span>{workers.length}개</span><Icon name="chevronDown" size={14}/></summary>
      <ol>{workers.map(worker=><li key={worker.id} data-tool={worker.tool} data-status={worker.status}>
        <div className="nubi-document-worker-heading"><strong>{labels[worker.tool]||'하위 분석'}</strong><span>{status(worker)}</span></div>
        {worker.analysis?.task&&<p className="nubi-document-question">{worker.analysis.task}</p>}
        {worker.analysis?.summary&&<p>{worker.analysis.summary}</p>}
        {worker.analysis?.delivered&&<small>결과 수집됨</small>}
        {(worker.analysis?.uncertainties?.length>0||worker.analysis?.nextStep||worker.analysis?.error)&&<div className="nubi-document-attention" aria-label="남은 확인"><strong>남은 확인</strong>
          {worker.analysis?.uncertainties?.length>0&&<ul>{worker.analysis.uncertainties.map((text,index)=><li key={index}>{text}</li>)}</ul>}
          {worker.analysis?.nextStep&&<p>{worker.analysis.nextStep}</p>}
          {worker.analysis?.error&&<p>분석 응답을 받지 못했어요.</p>}
        </div>}
        {worker.analysis?.doneWhen&&<small>확인할 결과: {worker.analysis.doneWhen}</small>}
        {!!worker.analysis?.sources?.length&&<details><summary>연결된 근거 {worker.analysis.sources.length}개</summary><ul>{worker.analysis.sources.map(source=><li key={source.id}><span>{source.path||sourceLabels[source.tool]||source.tool||source.id}</span>{source.read&&<small>원문 열람</small>}{source.hasImage&&<small>{source.imageRead?'화면 캡처 열람':'화면 캡처 제공됨'}</small>}{source.historical&&<small>이전 기록</small>}</li>)}</ul></details>}
        <details><summary>분석 상세</summary>
          <small>모델 호출 {count(worker.analysis?.calls)}회 / 근거 읽기 {count(worker.analysis?.reads)}회</small>
          {worker.analysis?.error&&<p>진단 코드: <code>{worker.analysis.error}</code></p>}
        </details>
      </li>)}</ol>
    </details>
  </section>;
}

function Record({record,running}) {
  return record.kind==='review'?<AnalysisReviewProgress review={record} running={running}/>:record.kind==='document'?<DocumentAnalysisProgress analysis={record} taskRunning={running}/>:<RoleProgress analysis={record} taskRunning={running}/>;
}

/** Read-only history. Request generations prevent stale pages crossing tasks or unmounts. */
export function AnalysisHistory({api,task}) {
  const [records,setRecords]=useState([]),[next,setNext]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(false);
  const generation=useRef(0),busy=useRef(false),failedCursor=useRef(undefined),paged=useRef(false);
  const running=task.state==='running';
  const recordsRef=useRef(records);recordsRef.current=records;
  async function fetchPage(before) {
    if(busy.current)return;
    busy.current=true;setLoading(true);const request=++generation.current;
    try {
      const result=await api('analysisHistory',{taskId:task.id,limit:10,refresh:[...recordsRef.current.filter(record=>record.state==='running'),...recordsRef.current.filter(record=>record.kind==='roles'),...recordsRef.current].filter((record,index,all)=>all.findIndex(other=>key(other)===key(record))===index).slice(0,20).map(({kind,id})=>({kind,id})),...(before?{before}:{})});
      if(request!==generation.current)return;
      if(!Array.isArray(result?.records))throw Error('analysis_history_invalid');
      setRecords(previous=>{
        const fresh=new Map([...(result.updates||[]),...result.records].map(record=>[key(record),record]));
        return before?[...previous.map(record=>fresh.get(key(record))||record),...result.records.filter(record=>!previous.some(old=>key(old)===key(record)))]:[...result.records,...previous.filter(record=>!result.records.some(other=>key(other)===key(record))).map(record=>fresh.get(key(record))||record)];
      });
      // A refreshed first page must not reset an already expanded page cursor.
      if(before||!paged.current)setNext(result.next||null);
      if(before)paged.current=true;setError(false);failedCursor.current=undefined;
    } catch {if(request===generation.current){setError(true);failedCursor.current=before;}}
    finally {if(request===generation.current){busy.current=false;setLoading(false);}}
  }
  useEffect(()=>{
    fetchPage();
    const refreshVisible=()=>{if(!document.hidden)void fetchPage();};
    const timer=running?setInterval(refreshVisible,1200):null;
    if(running)document.addEventListener('visibilitychange',refreshVisible);
    return()=>{if(timer)clearInterval(timer);document.removeEventListener('visibilitychange',refreshVisible);generation.current++;busy.current=false;};
  },[api,task.id,task.state]);
  const merged=mergeRoleHistory(records,task);
  if(task.documentAnalysis){const index=merged.findIndex(record=>record.kind==='document'&&record.id===task.documentAnalysis.id);const snapshot={...task.documentAnalysis,kind:'document'};if(index<0)merged.unshift(snapshot);else if(running||!snapshot.updatedAt||snapshot.updatedAt>=merged[index].updatedAt)merged[index]=snapshot;}
  if(!merged.length&&!error)return null;
  const current=running?merged.filter(record=>record.state==='running'):[];
  if(!current.length&&merged.length)current.push(merged[0]);
  const earlier=merged.filter(record=>!current.includes(record));
  return <section className="nubi-analysis-history" aria-label="분석 과정과 이력">
    {current.map(record=><Record key={key(record)} record={record} running={running}/>)}
    {(earlier.length>0||next)&&<details className="nubi-analysis-older"><summary>이전 분석 {earlier.length?`${earlier.length}개`:''}<Icon name="chevronDown" size={14}/></summary>
      {earlier.map(record=><Record key={key(record)} record={record} running={running}/>)}
      {next&&<CxButton disabled={loading} onClick={()=>fetchPage(next)}>이전 분석 더 보기</CxButton>}
    </details>}
    {error&&<div role="status" className="nubi-analysis-history-error"><p>분석 이력을 불러오지 못했어요. 표시된 기록은 유지합니다.</p><CxButton disabled={loading} onClick={()=>fetchPage(failedCursor.current)}>다시 불러오기</CxButton></div>}
  </section>;
}
