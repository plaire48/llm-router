import {SkillPagination,useSkillPagination} from './SkillPagination.jsx';
import {WorkspaceActionMenu} from './WorkspaceActionMenu.jsx';
import {ghesMessages} from './ghes-account-state.mjs';
import {createPortal} from 'react-dom';
import React,{useEffect,useRef,useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {CompanySkillSignIn,marketplaceRequiresLogin,marketplaceAuthenticationErrors} from './CompanySkillSignIn.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';

export const marketplaceErrors={...ghesMessages,skill_import_path:'지원하지 않는 파일 경로가 있어 설치하지 않았어요.',skill_import_duplicate:'대소문자 또는 유니코드만 다른 파일 경로가 있어 설치하지 않았어요.',marketplace_auth:'사내 Github SSO로 로그인해 주세요.',marketplace_network:'스킬 목록을 불러오지 못했어요. 다시 시도해 주세요.',marketplace_missing:'스킬 목록이나 저장소를 찾지 못했어요.',marketplace_invalid:'스킬 목록 형식을 확인해 주세요.',marketplace_limit:'스킬의 파일 수나 크기가 지원 범위를 넘었어요.',marketplace_changed:'목록이나 파일이 바뀌었어요. 새로고침한 뒤 다시 선택해 주세요.',marketplace_modified:'직접 수정한 스킬은 보존했어요. 지침과 파일을 확인해 주세요.',marketplace_version:'스킬 버전 정보가 일치하지 않거나 지원하는 버전 형식이 아니에요.',marketplace_version_changed:'같은 버전의 내용이 바뀌었어요. 게시자가 새 버전으로 등록해야 해요.',marketplace_reconcile:'설치 기록과 파일을 확인해야 해요. 자동으로 다시 설치하지 않습니다.',skill_exists:'같은 이름의 스킬이 있어요. 기존 파일을 보존했어요.',agent_busy:'진행 중인 작업을 마친 뒤 다시 시도해 주세요.'};
const stateLabels={installed:'설치됨',modified:'직접 수정됨',missing:'파일 없음',attention:'확인 필요',installing:'확인 필요',removing:'확인 필요',conflict:'이름 중복'};
export function SkillMarketplace({api,taskId,openPath,connectMarketplace,toolbarTarget}){
  const [catalog,setCatalog]=useState(null),[error,setError]=useState(''),[errorCode,setErrorCode]=useState(''),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(null),[options,setOptions]=useState(false),[expanded,setExpanded]=useState(null);
  const [query,setQuery]=useState(''),[operation,setOperation]=useState(null);
  const live=useRef(true),lock=useRef(false);
  function reportError(e){if(!live.current)return;const code=e.message,message=marketplaceErrors[code]||'스킬을 변경하지 못했어요. 목록과 파일을 확인해 주세요.';setErrorCode(code);setError(message);if(!marketplaceAuthenticationErrors.has(code))notifyWorkspaceToast(message,{error:true});}
  async function run(operation,item){if(lock.current)return;lock.current=true;setBusy(true);setOperation({name:operation,id:item?.id});setError('');setErrorCode('');try{const value=await api('skillMarketplace',{operation,taskId,id:item?.id,expectedCommit:item?.commit,expectedVersion:item?.version});if(live.current){setCatalog(value);if(operation==='install')notifyWorkspaceToast('누비 스킬에 추가했어요.',{success:true});return value;}}catch(e){reportError(e);}finally{lock.current=false;if(live.current){setBusy(false);setOperation(null);}}}
  useEffect(()=>{live.current=true;void (async()=>{const value=await run('status');if(!live.current||!value)return;if(marketplaceRequiresLogin(value)){if(connectMarketplace)await connect({interactive:false});}else await run('refresh');})();return()=>{live.current=false;};},[]);
  async function connect({interactive=true}={}){if(lock.current||!connectMarketplace)return;lock.current=true;setBusy(true);setError('');setErrorCode('');let connected=false;try{const result=await connectMarketplace({interactive});connected=!!result&&!result.cancelled&&!result.loginRequired;if(connected&&live.current)setCatalog(value=>({...value,credentialsReady:true,loginRequired:false}));}catch(e){reportError(e);}finally{lock.current=false;if(live.current)setBusy(false);}if(connected&&live.current)await run('refresh');}
  const requiresSignIn=marketplaceRequiresLogin(catalog,errorCode);
  const missing=(catalog?.installed||[]).filter(i=>!(catalog?.items||[]).some(s=>s.id===i.id));
  const all=[...(catalog?.items||[]),...missing.map(i=>({...i,installedVersion:i.version}))];
  const filtered=all.filter(item=>[item.title,item.name,item.description].some(text=>text?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const pagination=useSkillPagination(filtered,`${taskId}:${query}`);
  const toolbar=<div className="nubi-marketplace-toolbar"><ActionButton action="refresh" iconOnly label="마켓플레이스 새로고침" disabled={busy||requiresSignIn} onClick={()=>run('refresh')}/><ActionButton action="more" iconOnly label="스킬 설정" aria-expanded={options} onClick={()=>setOptions(!options)}/></div>;
  return <section className="nubi-skill-library nubi-marketplace-compact" aria-label="회사 스킬 마켓플레이스" aria-busy={busy}>
    {toolbarTarget?createPortal(toolbar,toolbarTarget):toolbar}
    {options&&<div className="nubi-skill-options">{!requiresSignIn&&<CxButton disabled={busy} onClick={()=>{setOptions(false);void connect();}}><Icon name="link" size={16}/>연결 다시 확인</CxButton>}<details><summary>저장 위치</summary><code>.nubi/skill/</code><p>현재 프로젝트에 참고 파일과 함께 저장해요. 스크립트와 MCP는 자동 실행하지 않아요.</p></details></div>}
    <div className="nubi-marketplace-search"><Icon name="search" size={18}/><input aria-label="AI Workspace 스킬 검색" placeholder="스킬 검색" value={query} onChange={event=>setQuery(event.target.value)}/></div>
    {requiresSignIn&&connectMarketplace&&<CompanySkillSignIn busy={busy} onConnect={()=>void connect()}/>}
    {error&&!requiresSignIn&&<div className="nubi-skill-recovery"><p>{error}</p><ActionButton action="refresh" label="스킬 목록 다시 확인" disabled={busy} onClick={()=>run('refresh')}/></div>}
    {busy&&<p role="status" className="nubi-marketplace-status"><span className="status-spinner"/>{operation?.name==='install'?'스킬을 내려받고 있어요.':'목록 확인 중'}</p>}
    {!busy&&!requiresSignIn&&!error&&!filtered.length&&<p className="nubi-muted">{query?'검색 결과가 없어요.':'등록된 스킬이 없어요.'}</p>}
    {confirm&&<DeckConfirmation className="nubi-delete-skill" title="스킬을 삭제할까요?" message={<><strong>{confirm.title||confirm.name}</strong> 스킬을 이 프로젝트에서 삭제해요.</>} confirmLabel="삭제" confirmIcon="check" showActionLabels busy={busy} onCancel={()=>{if(!lock.current)setConfirm(null);}} onConfirm={async()=>{const value=await run('remove',confirm);if(value&&live.current){setConfirm(null);notifyWorkspaceToast('이 프로젝트에서 스킬을 삭제했어요.',{success:true});}}}/>}
    {!requiresSignIn&&<SkillPagination pagination={pagination} label="AI Workspace 스킬" busy={busy}/>}
    {pagination.items.map(item=>{
      const own=catalog?.installed?.find(i=>i.id===item.id),installed=own?.state==='installed',canInstall=!requiresSignIn&&!error&&(item.state==='available'||installed&&item.updateAvailable);
      return <article className="nubi-skill-card nubi-marketplace-card" key={item.id}>
        <span className="nubi-skill-card-icon" aria-hidden="true"><Icon name="layers" size={18}/></span><div className="nubi-skill-name"><strong>{item.title||item.name}</strong></div>{expanded!==item.id&&<p className="nubi-skill-description" title={item.description}>{item.description}</p>}

        <div className="nubi-marketplace-actions">{own&&<span className="nubi-marketplace-installed" data-state={own.state} role="img" aria-label={stateLabels[own.state]||'확인 필요'} title={stateLabels[own.state]||'확인 필요'}><Icon name={installed?'check':'infoCircle'} size={18}/></span>}{canInstall&&<CxButton className="nubi-marketplace-download" aria-label={item.updateAvailable?`${item.title||item.name} 업데이트`:`${item.title||item.name} 다운로드`} title={item.updateAvailable?`v${own?.version} → v${item.version}`:'다운로드'} disabled={busy} onClick={()=>run('install',item)}><Icon name={item.updateAvailable?'refresh':'download'} size={16}/><span className="nubi-marketplace-download-label">{item.updateAvailable?'업데이트':'다운로드'}</span></CxButton>}<WorkspaceActionMenu><ActionButton action="help" visibleLabel="정보" label={`${item.title||item.name} 정보`} aria-expanded={expanded===item.id} onClick={()=>setExpanded(expanded===item.id?null:item.id)}/>{own&&['attention','installing','removing'].includes(own.state)&&<CxButton disabled={busy} onClick={()=>run('reconcile',item)}><Icon name="check" size={16}/>설치 기록 확인</CxButton>}{own&&<ActionButton action="edit" visibleLabel="지침" label={`${item.title||item.name} 지침 열기`} disabled={busy} onClick={async()=>{try{await openPath(`.nubi/skill/${own.name}/SKILL.md`);}catch{setError('스킬 파일을 열지 못했어요. 설치 기록을 확인해 주세요.');}}}/>} {installed&&<ActionButton action="delete" visibleLabel="삭제" label={`${item.title||item.name} 삭제`} disabled={busy} onClick={()=>setConfirm(item)}/>}</WorkspaceActionMenu></div>
        {expanded===item.id&&<div className="nubi-skill-expanded"><p>{item.description}</p><span className="nubi-skill-version">{item.updateAvailable?`v${own?.version} → v${item.version}`:`v${own?.version||item.version}`}</span>{own&&<><code>{`.nubi/skill/${own.name}/`}</code>{own.previous&&<p>이전 버전 {own.previous.version}</p>}{own.backup&&<code>{`.nubi/skill/${own.backup}/`}</code>}</>}</div>}
      </article>;
    })}


  </section>;
}
