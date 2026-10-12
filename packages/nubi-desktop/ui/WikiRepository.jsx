import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,DetailPanel,Icon} from '@e2e/cx-design-system';
import {FolderMark} from './marks.jsx';
import {CxSelect} from './WorkspaceSelect.jsx';
import {WorkspaceCatalogTabs} from './WorkspaceCatalogTabs.jsx';
import {CompanySkillSignIn} from './CompanySkillSignIn.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {SkillPagination,useSkillPagination} from './SkillPagination.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import './wiki-repository.css';
const errors={wiki_share_permission:'nuri 저장소의 쓰기 권한과 위키 관리자를 확인해 주세요.',wiki_share_missing:'nuri 저장소 또는 공유 위키에 접근할 수 없어요.',wiki_share_changed:'다른 변경이 먼저 저장됐어요. 목록을 새로고침해 주세요.',wiki_share_source_changed:'선택한 파일이 바뀌었어요. 폴더를 다시 선택해 주세요.',wiki_share_fields:'이름, 설명, 버전과 관리자 아이디를 확인해 주세요.',wiki_share_version:'기존보다 높은 버전을 입력해 주세요. 예: 1.0.1',wiki_share_empty:'공유할 Markdown 문서를 선택해 주세요.',wiki_share_limit:'문서는 500개, 합계 20MB까지 공유할 수 있어요.',wiki_share_symlink:'바로가기 대신 원본 문서 폴더를 선택해 주세요.',wiki_share_encoding:'UTF-8 Markdown 문서만 공유할 수 있어요.',wiki_share_invalid:'위키 목록 또는 파일 형식을 확인하지 못했어요.',wiki_share_network:'사내망 연결을 확인하고 다시 시도해 주세요.',wiki_share_exists:'같은 버전의 폴더가 이미 있어요. 다른 저장 위치를 선택해 주세요.',wiki_share_stage_expired:'파일 선택이 만료됐어요. 폴더를 다시 선택해 주세요.',wiki_share_unconfirmed:'저장 응답을 확인하지 못했어요. 다시 등록하기 전에 목록을 새로고침해 주세요.',wiki_share_download_unconfirmed:'저장한 파일을 확인하지 못했어요. 다운로드 폴더를 확인해 주세요.',ghes_login_required:'GitHub에 로그인해 주세요.',ghes_session_expired:'GitHub 로그인이 만료됐어요.',ghes_session_changed:'계정이 바뀌었어요. 목록을 다시 열어 주세요.'};
const errorText=e=>errors[e?.message]||'위키를 확인하지 못했어요. 다시 시도해 주세요.';
const date=value=>new Date(value).toLocaleDateString('ko-KR');
const title=(label)=><span className="nubi-panel-title"><span className="nubi-panel-title-icon"><Icon name="bookmark" size={18}/></span>{label}</span>;
export function WikiRepository({api,onSignIn}){
 const [snapshot,setSnapshot]=useState(null),[mode,setMode]=useState('code'),[query,setQuery]=useState(''),[error,setError]=useState(''),[needsLogin,setNeedsLogin]=useState(false),[loading,setLoading]=useState(false),[archived,setArchived]=useState(false),[editor,setEditor]=useState(null),[detail,setDetail]=useState(null),[busy,setBusy]=useState(false);
 const revision=useRef(0),live=useRef(true);
 async function load(){const id=++revision.current;setLoading(true);setError('');setNeedsLogin(false);try{const value=await api('wikiRepository',{action:'list'});if(live.current&&id===revision.current)setSnapshot(value);}catch(e){if(live.current&&id===revision.current){setError(errorText(e));setNeedsLogin(['ghes_login_required','ghes_session_expired'].includes(e.message));}}finally{if(live.current&&id===revision.current)setLoading(false);}}
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;revision.current++;};},[api]);
 const items=(snapshot?.items||[]).filter(item=>item.mode===mode&&!!item.archived===archived&&`${item.title} ${item.description} ${item.createdBy} ${item.managers.join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const pagination=useSkillPagination(items,mode+query+archived);
 async function download(item,version=item.version){if(busy)return;setBusy(true);setError('');try{const value=await api('wikiRepository',{action:'download',id:item.id,version});if(value.saved)notifyWorkspaceToast(`${version} 위키를 저장했어요.`,{success:true});}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function visibility(item){if(busy)return;setBusy(true);setError('');try{const value=await api('wikiRepository',{action:'publish',id:item.id,archive:true,expectedHead:snapshot.head});if(value.saved){setDetail(null);await load();}}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <section className="nubi-wiki-repository" aria-label="공유 위키">
  <header className="nubi-wiki-repo-heading"><div><h2>위키</h2><p>프로젝트와 업무 지식을 공유하세요.</p></div><CxButton className="nubi-wiki-add" variant="secondary" disabled={!snapshot?.canUpload||loading} onClick={()=>setEditor({mode})}><Icon name="plus" size={16}/><span>위키 등록</span></CxButton></header>
  <div className="nubi-wiki-repo-toolbar"><WorkspaceCatalogTabs items={[{key:'code',label:<><Icon name="code" size={16}/>Code</>},{key:'personal',label:<><Icon name="bookmark" size={16}/>Personal</>}]} active={mode} onChange={value=>{setMode(value);setDetail(null);}} label="위키 종류" idPrefix="shared-wiki-mode"/><WorkspaceAction action="refresh" label="위키 새로고침" disabled={loading||busy} onClick={load}/></div>
  <div className="nubi-wiki-repo-search"><Icon name="search" size={18}/><CxInput aria-label="공유 위키 검색" placeholder="이름, 설명, 관리자 검색" value={query} onChange={event=>setQuery(event.target.value)}/><CxButton aria-pressed={archived} title="공유 중단된 위키 보기" onClick={()=>setArchived(!archived)}><Icon name="package" size={16}/><span>보관함</span></CxButton></div>
  {needsLogin&&onSignIn?<CompanySkillSignIn busy={loading} onConnect={onSignIn}/>:error&&<p className="nubi-wiki-repo-error" role="alert">{error}</p>}
  {loading&&<p role="status" className="nubi-muted">위키를 불러오는 중</p>}
  <div className="nubi-wiki-repo-list" aria-busy={loading}>{pagination.items.map(item=><article key={item.id}><button className="nubi-wiki-repo-open" onClick={()=>setDetail(item)}><span className="nubi-wiki-repo-symbol"><Icon name={item.mode==='code'?'code':'bookmark'} size={20}/></span><span className="nubi-wiki-repo-copy"><strong>{item.title}</strong><span>{item.description}</span><small>{item.updatedBy} <span aria-hidden="true">/</span> {date(item.updatedAt)}</small></span><span className="nubi-wiki-version">{item.version}</span></button>{!item.archived&&<WorkspaceAction action="download" label={`${item.title} 다운로드`} disabled={busy} onClick={()=>download(item)}/>}</article>)}</div>
  {!loading&&!error&&!items.length&&<div className="nubi-wiki-repo-empty"><Icon name="bookmark" size={28}/><strong>{query?'일치하는 위키가 없어요.':archived?'보관한 위키가 없어요.':'아직 공유된 위키가 없어요.'}</strong>{!query&&!archived&&<span>{mode==='code'?'프로젝트의 구조와 작업 방법을 공유하세요.':'공유할 문서만 골라 업무 지식을 나누세요.'}</span>}</div>}
  <SkillPagination pagination={pagination} label="공유 위키" busy={loading}/>
  {detail&&<WikiDetail item={detail} api={api} busy={busy} onDownload={version=>download(detail,version)} onClose={()=>setDetail(null)} onEdit={()=>{setEditor(detail);setDetail(null);}} onVisibility={()=>visibility(detail)}/>}
  {editor&&<WikiEditor api={api} item={editor} snapshot={snapshot} onClose={()=>setEditor(null)} onSaved={async()=>{setEditor(null);await load();}}/>}
 </section>;
}
function WikiDetail({item,api,busy,onDownload,onClose,onEdit,onVisibility}){
 const [version,setVersion]=useState(item.version),[manifest,setManifest]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setManifest(null);setError('');if(!item.archived)api('wikiRepository',{action:'detail',id:item.id,version}).then(value=>{if(live)setManifest(value.manifest);}).catch(e=>{if(live)setError(errorText(e));});return()=>{live=false;};},[api,item.id,version]);
 return <DetailPanel variant="modal" className="deck-dialog nubi-panel nubi-wiki-detail" title={title('위키 정보')} onClose={onClose} footer={<>{item.canEdit&&<><CxButton disabled={busy} onClick={onVisibility}>{item.archived?'공유 재개':'공유 중단'}</CxButton><CxButton disabled={busy} onClick={onEdit}><Icon name="plus" size={16}/>새 버전</CxButton></>}{!item.archived&&<CxButton variant="primary" disabled={busy||!manifest} onClick={()=>onDownload(version)}><Icon name="download" size={16}/>다운로드</CxButton>}</>}>
  <div className="nubi-wiki-detail-copy"><h3>{item.title}</h3><p>{item.description}</p></div>
  <dl className="nubi-wiki-metadata"><dt>종류</dt><dd>{item.mode==='code'?'Code':'Personal'}</dd><dt>관리자</dt><dd>{[item.createdBy,...item.managers].filter((x,i,a)=>a.indexOf(x)===i).join(', ')}</dd><dt>업로드</dt><dd>{item.createdBy} / {date(item.createdAt)}</dd><dt>최근 수정</dt><dd>{item.updatedBy} / {date(item.updatedAt)}</dd></dl>
  <label className="nubi-wiki-field">버전<CxSelect aria-label="다운로드할 위키 버전" value={version} onChange={e=>setVersion(e.target.value)} options={[...item.releases].reverse().map(release=>({value:release.version,label:`${release.version} / ${date(release.createdAt)}`}))}/></label>
  {error&&<p role="alert" className="nubi-wiki-repo-error">{error}</p>}
  {manifest&&<details><summary>포함된 문서 {manifest.files.length}개</summary><ul className="nubi-wiki-files">{manifest.files.map(file=><li key={file.path}><Icon name="file" size={16}/><span title={file.path}>{file.path}</span></li>)}</ul></details>}
 </DetailPanel>;
}
function WikiEditor({api,item,snapshot,onClose,onSaved}){
 const [form,setForm]=useState({title:item.title||'',description:item.description||'',mode:item.mode,version:item.id?item.version.split('.').map((part,i)=>i===2?Number(part)+1:part).join('.'):'1.0.0',managers:(item.managers||[]).join(', ')}),[stage,setStage]=useState(null),[selected,setSelected]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(null);
 const lock=useRef(false);
 const change=(key,value)=>setForm(old=>({...old,[key]:value}));
 useEffect(()=>()=>{void api('wikiRepository',{action:'cancel'}).catch(()=>{});},[api]);
 useEffect(()=>{if(!busy)return;let active=true;const timer=setInterval(()=>{void api('wikiRepository',{action:'progress'}).then(value=>{if(active)setProgress(value);}).catch(()=>{});},700);return()=>{active=false;clearInterval(timer);};},[api,busy]);
 async function choose(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const value=await api('wikiRepository',{action:'stage'});if(!value.cancelled){setStage(value);setSelected(form.mode==='code'?value.files.map(file=>file.path):[]);}}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}}
 async function save(event){event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await api('wikiRepository',{action:'publish',id:item.id,expectedHead:snapshot.head,stageId:stage?.id,paths:selected,metadata:{...form,managers:form.managers.split(',').map(x=>x.trim()).filter(Boolean)}});if(result.saved)await onSaved();}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);setProgress(null);}}
 return <DetailPanel variant="modal" className="deck-dialog nubi-panel nubi-wiki-editor" title={title(item.id?'새 위키 버전':'위키 등록')} busy={busy} onClose={()=>{if(!busy)onClose();}} footer={<><CxButton disabled={busy} onClick={onClose}>취소</CxButton><CxButton className="nubi-wiki-submit" type="submit" form="wiki-share-form" variant="primary" disabled={busy||!stage||!selected.length||!form.title.trim()||!form.description.trim()}>{busy?'공유 중':'공유하기'}</CxButton></>}>
  <form id="wiki-share-form" className="nubi-wiki-editor-form" onSubmit={save}>
   <label className="nubi-wiki-field">이름<CxInput value={form.title} maxLength={100} required disabled={busy} onChange={e=>change('title',e.target.value)}/></label>
   <label className="nubi-wiki-field">설명<CxInput value={form.description} maxLength={500} required disabled={busy} placeholder="어떤 업무에 도움이 되는 위키인가요?" onChange={e=>change('description',e.target.value)}/></label>
   <div className="nubi-wiki-field-pair"><label className="nubi-wiki-field">종류<CxSelect disabled={busy||!!item.id} value={form.mode} onChange={e=>{change('mode',e.target.value);setSelected([]);}} options={[{value:'code',label:'Code'},{value:'personal',label:'Personal'}]}/></label><label className="nubi-wiki-field">버전<CxInput value={form.version} required disabled={busy} placeholder="1.0.0" onChange={e=>change('version',e.target.value)}/></label></div>
   <label className="nubi-wiki-field">공동 관리자<CxInput value={form.managers} disabled={busy||!!item.id&&!snapshot.items.find(row=>row.id===item.id)?.canEdit} placeholder="GitHub 아이디, 쉼표로 구분" onChange={e=>change('managers',e.target.value)}/></label>
   <section className="nubi-wiki-upload"><div><strong>공유할 문서</strong><CxButton disabled={busy} onClick={choose}><FolderMark size={16}/>{stage?'다시 선택':'폴더 선택'}</CxButton></div><p>{form.mode==='personal'?'선택한 문서가 저장소 구성원에게 공유됩니다.':'openwiki 폴더에서 공유할 Markdown 문서를 선택하세요.'}</p>
   {stage&&<><label className="nubi-wiki-select-all"><input type="checkbox" disabled={busy} checked={selected.length===stage.files.length} onChange={e=>setSelected(e.target.checked?stage.files.map(file=>file.path):[])}/>전체 선택 <span>{selected.length}개 선택</span></label><div className="nubi-wiki-file-checks">{stage.files.map(file=><label key={file.path}><input type="checkbox" disabled={busy} checked={selected.includes(file.path)} onChange={e=>setSelected(old=>e.target.checked?[...old,file.path]:old.filter(x=>x!==file.path))}/><Icon name="file" size={16}/><span title={file.path}>{file.path}</span></label>)}</div></>}
   </section>
   {busy&&<div role="status" className="nubi-wiki-upload-progress">{progress?.phase==='upload'?<><span>문서 업로드 {progress.completed}/{progress.total}</span><progress max={progress.total} value={progress.completed}/></>:<span>{progress?.phase==='save'?'저장 결과 확인 중':'선택한 내용을 확인하고 있어요.'}</span>}</div>}
   {error&&<p role="alert" className="nubi-wiki-repo-error">{error}</p>}
  </form>
 </DetailPanel>;
}
