import React,{useState} from 'react';
import {CxButton,CxInput,CxNotice} from '@e2e/cx-design-system';
import {OfficeDialog} from './OfficeDialog.jsx';
export function Services({state,call,onClose}){
 const [search,setSearch]=useState({provider:state.search?.provider||'parallel',apiKey:''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <OfficeDialog icon="search" title="웹 검색 연결" className="office-form deck-dialog nubi-decision-dialog" busy={busy} onClose={onClose} footer={<><CxButton disabled={busy} onClick={onClose}>취소</CxButton><CxButton form="office-search-form" type="submit" variant="primary" busy={busy}>저장</CxButton></>}><form id="office-search-form" className="services-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await call('configure',{search});onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}}>
  <p className="muted">검색 출처를 함께 확인합니다.</p>{error&&<CxNotice tone="danger">{error}</CxNotice>}
  <fieldset><legend>웹 검색</legend><label>검색 서비스<select aria-label="검색 서비스" value={search.provider} onChange={e=>setSearch({provider:e.target.value,apiKey:''})}>{(state.searchProviders||[{id:'parallel',label:'Parallel'}]).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>API 키<CxInput type="password" autoComplete="off" value={search.apiKey} placeholder={search.provider==='parallel'?'키 없이 검색 가능':'저장된 키 유지'} onChange={e=>setSearch({...search,apiKey:e.target.value})}/></label></fieldset>

  <CxButton className="form-secondary-action" disabled={busy} onClick={async()=>{setBusy(true);try{await call('clear');onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}}>연결 정보 지우기</CxButton>
 </form></OfficeDialog>;
}
