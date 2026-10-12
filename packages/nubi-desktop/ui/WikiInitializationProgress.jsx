import {gitErrors} from './git-errors.mjs';
import React, {useEffect, useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {durationLabel} from '../runtime/response-timing.mjs';

const stages={scanning:'파일 목록 확인',reading:'파일 읽기',snapshot:'분석 준비',snapshot_git:'분석 기준 준비',planning:'구성 분석',replanning:'구성 다시 분석',generating:'문서 작성',finalizing:'문서 검토',publishing:'저장 확인'};
const states={waiting_model:'위키 모델 연결 대기',waiting_source:'위키 프로젝트 선택 대기',completed:'위키 준비 완료',existing:'위키 연결됨',attention:'위키 확인 필요',cancelled:'위키 준비 중지됨'};
const errors={wiki_interrupted:'위키 준비가 중간에 멈췄어요. 앱이 종료되었거나 프로젝트가 바뀌었어요. 다시 시도해 주세요.',source_stale:'원본 파일이 바뀌었어요. 최신 파일로 다시 시도해 주세요.',provider_changed:'모델이 바뀌었어요. 선택한 모델로 다시 시도해 주세요.',wiki_git_required:'코드 위키에 필요한 Git 실행기가 없어요. 최신 누비 설치 파일로 복구한 뒤 다시 시도해 주세요.',wiki_source_limit:'파일이 너무 많아요. 더 작은 프로젝트 폴더를 선택해 주세요.',unauthorized:'모델 로그인을 다시 확인해 주세요.',expired_token:'모델 로그인이 만료됐어요. 다시 연결해 주세요.',response_invalid:'모델 응답을 읽지 못했어요. 다시 시도해 주세요.'};
Object.assign(errors,gitErrors,{wiki_permission_denied:'파일 접근이 차단됐어요. 프로젝트와 임시 폴더의 쓰기 권한을 확인해 주세요.',wiki_disk_full:'저장 공간이 부족해요. 공간을 확보한 뒤 다시 시도해 주세요.',wiki_output_conflict:'같은 이름의 위키 파일이 있어 저장하지 않았어요. 기존 문서를 확인해 주세요.',wiki_source_missing:'읽던 파일을 찾지 못했어요. 폴더를 확인한 뒤 다시 시도해 주세요.',wiki_no_sources:'분석할 텍스트 파일이 없어요. 코드나 문서가 있는 폴더를 선택해 주세요.',wiki_empty:'모델이 위키 문서를 만들지 못했어요. 다른 모델을 선택하거나 다시 시도해 주세요.',wiki_snapshot_failed:'분석용 Git 준비에 실패했어요. Git 설정과 보안 프로그램을 확인해 주세요.',wiki_git_timeout:'분석용 Git 준비가 지연됐어요. 다시 시도해 주세요.',model_unavailable:'사용할 모델을 연결해 주세요.',model_missing:'사용할 모델을 선택해 주세요.',context_length_exceeded:'프로젝트가 모델의 처리 범위를 넘었어요. 더 작은 폴더를 선택해 주세요.',rate_limited:'모델의 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.',network_error:'모델 연결이 끊겼어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.',timeout:'모델 응답을 기다리다 멈췄어요. 다시 시도해 주세요.',tls_untrusted:'회사 인증서를 확인하지 못했어요. Windows의 회사 인증서 등록 상태를 확인해 주세요.',tls_expired:'인증서 유효기간을 확인해 주세요. PC 날짜와 서버 인증서가 맞아야 합니다.',tls_hostname:'서버 주소와 인증서가 다릅니다. 모델 연결 주소를 확인해 주세요.',network_dns:'모델 서버 주소를 찾지 못했어요. 사내망이나 VPN을 확인해 주세요.',network_refused:'모델 서버에 연결하지 못했어요. 연결 상태를 확인해 주세요.',forbidden:'이 계정의 모델 접근 권한을 확인해 주세요.',no_credential:'모델 로그인 정보가 없어요. 다시 로그인해 주세요.',output_limit:'모델 출력 한도를 넘어 문서를 끝내지 못했어요. 다시 시도해 주세요.',response_json_invalid:'모델 응답 형식을 읽지 못했어요. 다시 시도해 주세요.',model_failed:'모델 요청이 실패해 문서를 만들지 못했어요. 오류 상세를 확인한 뒤 다시 시도해 주세요.',path_scope:'프로젝트 밖을 가리키는 파일은 읽을 수 없어요.',project_changed:'프로젝트가 바뀌어 준비를 멈췄어요.',write_unconfirmed:'위키 저장 결과를 확인하지 못했어요. 생성된 파일을 확인해 주세요.'});
function elapsed(start,end){
  return durationLabel(Math.max(0,end-start));
}

// Counts come from the runner. A clock is a duration, never a synthetic percent.
export function WikiInitializationProgress({job, inline=false}) {
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(job?.state!=='running')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[job?.id,job?.state]);
  if(!job)return null;
  const running=job.state==='running',start=Date.parse(job.startedAt),end=Date.parse(job.finishedAt);
  const duration=Number.isFinite(start)?elapsed(start,running?now:Number.isFinite(end)?end:now):null;
  const percent=running&&Number.isFinite(job.percent)?Math.max(0,Math.min(100,job.percent)):null;
  const stageSeconds=(now-Date.parse(job.stageStartedAt))/1000;
  const remaining=running&&job.completed>=2&&job.total>job.completed&&stageSeconds>=3?Math.ceil(stageSeconds*(job.total-job.completed)/job.completed):null;
  const title=running?`위키 ${stages[job.stage]||'준비 중'}`:states[job.state]||'위키';
  return <div className={`nubi-wiki-initialization${inline?' is-inline':''}`} data-state={job.state}>
    <div className="nubi-wiki-initialization-line">
      {running?<span className="status-spinner" aria-hidden="true"/>:<Icon name={job.state==='attention'?'alertCircle':'bookmark'} size={14}/>}
      <strong role={running?'status':undefined}>{title}</strong>
      {percent!==null&&<span className="nubi-wiki-percent">현재 단계 {percent}%</span>}
      {running&&duration&&<span className="nubi-wiki-elapsed">진행 {duration}</span>}
      {!running&&job.state==='completed'&&<span className="nubi-wiki-elapsed">{job.pages}개 문서{job.excludedFiles>0?` / 제외 ${job.excludedFiles}개 파일`:''}{job.changedDuringRun>0?` / 생성 중 바뀐 파일 ${job.changedDuringRun}개, 갱신 필요`:''}{job.lastModelError?` / 모델 오류 ${job.lastModelError}`:''}{duration?` / ${duration}`:''}</span>}
    </div>
    {!inline&&running&&percent===null&&<div className="nubi-progress is-indeterminate" role="progressbar" aria-label={title}><span/></div>}
    {!inline&&percent!==null&&<div className="nubi-progress" role="progressbar" aria-label={`${title} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%${job.total>0?` (${job.completed}/${job.total})`:''}`}><span style={{width:`${percent}%`}}/></div>}
    {!inline&&running&&job.total>0&&percent!==null&&<small>{job.completed}/{job.total}{['reading','snapshot','publishing'].includes(job.stage)?'개 파일':'개 문서'}</small>}
    {!inline&&running&&remaining!==null&&<small className="nubi-wiki-eta">현재 단계 약 {elapsed(0,remaining*1000)} 남음</small>}
    {!inline&&job.state==='attention'&&<><small role="alert">{errors[job.error]||`${stages[job.stage]||'위키 준비'} 단계에서 멈췄어요. 아래 오류 코드를 확인해 주세요.`}</small><details className="nubi-wiki-error-detail"><summary>오류 상세</summary><p>{stages[job.stage]||'위키 준비'}{duration?` / 진행 ${duration}`:''}</p><code>{/^[a-z_]{1,80}$/.test(job.error||'')?job.error:'wiki_failed'}</code></details></>}
  </div>;
}
