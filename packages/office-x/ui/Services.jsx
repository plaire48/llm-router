import React,{useState} from 'react';
import {CxButton,CxInput,CxNotice,DetailPanel} from '@e2e/cx-design-system';
export function Services({state,call,onClose}){
 const [search,setSearch]=useState({provider:state.search?.provider||'parallel',apiKey:''});
 const [media,setMedia]=useState({provider:state.media?.provider||'custom',config:{apiKey:'',baseUrl:state.media?.baseUrl||'',imageModel:state.media?.imageModel||'',analysisModel:state.media?.analysisModel||''}});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const providers=state.mediaProviders||[];
 const set=(key,value)=>setMedia(m=>({...m,config:{...m.config,[key]:value}}));
 return <DetailPanel title="검색과 이미지" variant="modal" hideHelp onClose={busy?undefined:onClose}><form className="services-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await call('configure',{search,media});onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}}>
  <p className="muted">이미지 생성은 별도 서비스 연결이 필요합니다.</p>{error&&<CxNotice tone="danger">{error}</CxNotice>}
  <fieldset><legend>웹 검색</legend><label>검색 서비스<select aria-label="검색 서비스" value={search.provider} onChange={e=>setSearch({provider:e.target.value,apiKey:''})}>{(state.searchProviders||[{id:'parallel',label:'Parallel'}]).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><label>API 키<CxInput type="password" autoComplete="off" value={search.apiKey} placeholder={search.provider==='parallel'?'키 없이 검색 가능':'저장된 키 유지'} onChange={e=>setSearch({...search,apiKey:e.target.value})}/></label></fieldset>
  <fieldset><legend>이미지와 미디어</legend><label>서비스<select aria-label="이미지 서비스" value={media.provider} onChange={e=>{const p=providers.find(p=>p.id===e.target.value);setMedia({provider:e.target.value,config:{apiKey:'',baseUrl:p?.defaultBaseUrl||'',imageModel:p?.defaultImageModel||'',analysisModel:p?.defaultAnalysisModel||''}});}}>{providers.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
  {[['baseUrl','서버 주소','url'],['apiKey','API 키','password'],['imageModel','이미지 모델','text'],['analysisModel','분석 모델','text']].map(([key,label,type])=><label key={key}>{label}<CxInput type={type} autoComplete="off" value={media.config[key]} placeholder={key==='apiKey'?'저장된 키 유지':''} onChange={e=>set(key,e.target.value)}/></label>)}
  </fieldset><div className="review-actions"><CxButton disabled={busy} onClick={async()=>{setBusy(true);try{const r=await call('test');setError(r.ok?'연결을 확인했습니다.':r.error||'연결을 확인해 주세요.');}catch(e){setError(e.message);}finally{setBusy(false);}}}>저장된 연결 확인</CxButton><CxButton type="submit" variant="primary" busy={busy}>저장</CxButton></div>
  <CxButton disabled={busy} onClick={async()=>{setBusy(true);try{await call('clear');onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}}>연결 정보 지우기</CxButton>
 </form></DetailPanel>;
}
