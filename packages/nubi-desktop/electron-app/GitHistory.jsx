import {gitErrors} from '../ui/git-errors.mjs';
import React, {useEffect, useRef, useState, lazy, Suspense} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {GitEmptyState} from '../ui/GitEmptyState.jsx';
import {BranchMark} from '../ui/marks.jsx';
import {DriftLabel} from '../ui/DriftLabel.jsx';
import {ProjectFileTree} from '../ui/ProjectFileTree.jsx';

const Diff = lazy(() => import('./editor.jsx').then(module => ({default:module.GitDiff})));
const dateLabel = value => Number.isNaN(Date.parse(value))?'':new Date(value).toLocaleDateString('ko-KR', {month:'numeric', day:'numeric'});
const fullDate = value => Number.isNaN(Date.parse(value))?'':new Date(value).toLocaleString('ko-KR');
const catalogs = new WeakMap();
function catalogCache(api){if(!catalogs.has(api))catalogs.set(api,new Map());return catalogs.get(api);}
const states = {A:'추가', D:'삭제', M:'수정', T:'형식 변경'};
const unavailable = {binary_file:'바이너리 파일은 코드 비교를 표시할 수 없어요.', file_encoding:'이 파일의 문자 인코딩은 아직 지원하지 않아요.', file_size_limit:'1 MB를 넘는 파일은 코드 비교를 표시하지 않아요.', submodule:'하위 저장소의 커밋이 변경됐어요.', special_file:'링크 파일은 코드 비교를 표시하지 않아요.'};
function Counts({added, removed}) {
  return <span className="desktop-git-counts" aria-label={added === null ? '바이너리 변경' : `${added ?? 0}줄 추가, ${removed ?? 0}줄 삭제`}>
    {added === null ? <span>바이너리</span> : <><span className="desktop-git-added">+{added ?? 0}</span><span className="desktop-git-removed">−{removed ?? 0}</span></>}
  </span>;
}

export function GitHistory({api, onError, projectId}) {
  const cache=catalogCache(api),[offset,setOffset]=useState(0);
  const [branch, setBranch] = useState('HEAD'), [catalog, setCatalog] = useState(()=>cache.get(`${projectId}:HEAD:0`)||null);
  const [selected, setSelected] = useState(null), [detail, setDetail] = useState(null);
  const [file, setFile] = useState(null), [content, setContent] = useState(null);
  const [busy, setBusy] = useState('list'), [failed, setFailed] = useState(false), [reload, setReload] = useState(0);
  const requestId = useRef(0), errorRef = useRef(onError), tipRef=useRef(null),scrollRef=useRef(null);
  errorRef.current = onError;
  useEffect(() => {
    const id = ++requestId.current;
    setBusy('list'); setFailed(false); setSelected(null); setDetail(null); setFile(null); setContent(null); setCatalog(cache.get(`${projectId}:${branch}:${offset}`)||null);
    api('commitHistory', {branch,offset,...offset&&tipRef.current?{expectedTip:tipRef.current}:{}}).then(value => { if (id === requestId.current) {cache.set(`${projectId}:${branch}:${offset}`,value);while(cache.size>12)cache.delete(cache.keys().next().value);tipRef.current=value.tip;setCatalog(value); setBusy(null);scrollRef.current?.scrollTo(0,0);} })
      .catch(error => { if (id === requestId.current) {setFailed(error.message); setBusy(null); errorRef.current(error);} });
    return () => { requestId.current++; };
  }, [api, projectId, branch, offset, reload]);
  async function chooseCommit(row) {
    const id = ++requestId.current;
    setSelected(row); setDetail(null); setFile(null); setContent(null); setBusy('commit'); setFailed(false);
    try {
      const value = await api('commitHistory', {branch, commit:row.id, view:'files'});
      if (id !== requestId.current) return;
      setDetail(value); setBusy(null);
      // Reading the list never loads file blobs or the diff editor. The user
      // selects a changed file when they want its contents.
    } catch (error) { if (id === requestId.current) {setFailed(error.message); setBusy(null); errorRef.current(error);} }
  }
  async function chooseFile(row, commit = selected?.id, force = false) {
    const id = ++requestId.current;
    if (!force && file?.path === row.path && content) {setFile(null); setContent(null); setBusy(null); return;}
    setFile(row); setContent(null); setBusy('file'); setFailed(false);
    try {
      const value = await api('commitHistory', {branch, commit, path:row.path});
      if (id === requestId.current) {setContent(value); setBusy(null);}
    } catch (error) { if (id === requestId.current) {setFailed(error.message); setBusy(null); errorRef.current(error);} }
  }
  function back() {requestId.current++; setSelected(null); setDetail(null); setFile(null); setContent(null); setBusy(null); setFailed(false);}
  const totals = detail?.files.reduce((sum, row) => ({added:sum.added + (row.added || 0), removed:sum.removed + (row.removed || 0)}), {added:0, removed:0});
  return <section className="desktop-git-history" aria-label="브랜치별 커밋 이력">
    <div className="desktop-git-toolbar">
      {selected && <CxButton className="desktop-git-back" data-icon-only aria-label="커밋 목록으로" title="커밋 목록으로" onClick={back}><Icon name="arrowLeft" size={16}/><span>목록</span></CxButton>}
      <Icon name="gitCommit" size={16}/>
      <select aria-label="이력을 볼 브랜치" value={branch} onChange={event => {tipRef.current=null;setOffset(0);setBranch(event.target.value);}}>
        <option value="HEAD">{catalog?.currentBranch ? `${catalog.currentBranch.replace(/^refs\/heads\//, '')} (현재)` : catalog?.tip ? `${catalog.tip.slice(0,7)} (HEAD)` : '현재 브랜치'}</option>
        {catalog?.branches.map(row => <option key={row.ref} value={row.ref}>{row.name}</option>)}
      </select>
      <CxButton className="desktop-git-back" data-icon-only aria-label="커밋 이력 새로고침" title="커밋 이력 새로고침" disabled={busy==='list'} onClick={() => {tipRef.current=null;setOffset(0);setReload(value => value + 1);}}><Icon name="refresh" size={16}/></CxButton>
    </div>
    <div className="desktop-git-scroll" ref={scrollRef}>
      {!selected && <div className="desktop-git-commits">
        {catalog?.commits.map(row => <CxButton key={row.id} className="desktop-git-commit" onClick={() => chooseCommit(row)}>
          <Icon name="gitCommit" size={16}/><span className="desktop-git-commit-copy"><strong title={row.subject}>{row.subject}</strong>
            <small><span className="desktop-git-author" title={row.author}>{row.author}</span><code title={row.id}>{row.id.slice(0,7)}</code><time dateTime={row.date} title={fullDate(row.date)}>{dateLabel(row.date)}</time></small>
            {catalog.branches.some(ref=>ref.tip===row.id)&&<span className="desktop-git-refs" title={catalog.branches.filter(ref=>ref.tip===row.id).map(ref=>ref.name).join(', ')}><BranchMark size={14}/><span>{catalog.branches.find(ref=>ref.tip===row.id).name}</span>{catalog.branches.filter(ref=>ref.tip===row.id).length>1&&<small>+{catalog.branches.filter(ref=>ref.tip===row.id).length-1}</small>}</span>}
          </span>
        </CxButton>)}
        {!busy && !failed && !catalog?.commits.length && <GitEmptyState title="아직 커밋이 없어요"/>}

      </div>}
      {selected && <>
        <div className="desktop-git-summary"><h3 title={selected.subject}>{selected.subject}</h3><p><code>{selected.id.slice(0,7)}</code><span title={selected.author}>{selected.author}</span><time dateTime={selected.date} title={fullDate(selected.date)}>{dateLabel(selected.date)}</time></p>
          {detail?.totalFiles > 0 && <div className="desktop-git-summary-count"><span>{detail.totalFiles}개 파일</span><Counts {...totals}/></div>}
          {detail?.commit.parents.length > 1 && <p className="desktop-git-caption">첫 번째 부모 커밋과 비교</p>}
          {detail?.excludedCount > 0 && <p className="desktop-git-caption">보호 경로 {detail.excludedCount}개 제외</p>}
          {detail?.truncated && <p className="desktop-git-caption">처음 {detail.files.length}개 파일의 변경량을 표시합니다.</p>}
        </div>
        {detail?.files.length > 0 && <ProjectFileTree key={selected.id} items={detail.files} selected={file?.path} onSelect={row=>chooseFile(row)} label="커밋 변경 파일" renderTrailing={row=><Counts added={row.added} removed={row.removed}/>}/>}
        {file && <section className="desktop-git-file">
          <div className="desktop-git-file-heading">
            <Icon name="file" size={16}/><DriftLabel>{file.path}</DriftLabel><span className="desktop-git-state">{states[file.status] || '변경'}</span>
          </div>
          <div id="desktop-commit-diff" className="desktop-git-file-content">
            {busy === 'file' && <p className="desktop-git-empty" role="status">변경 내용 불러오는 중</p>}
            {content?.unavailable && <p className="desktop-git-empty">{unavailable[content.unavailable] || '코드 비교를 표시할 수 없어요.'}</p>}
            {content && !content.unavailable && content.before === content.after && <p className="desktop-git-empty">{content.beforeMode !== content.afterMode ? `파일 권한 변경: ${content.beforeMode} → ${content.afterMode}` : '파일 내용은 동일해요.'}</p>}
            {content && !content.unavailable && content.before !== content.after && <Suspense fallback={<p className="desktop-git-empty" role="status">변경 비교 준비 중</p>}><Diff diff={content}/></Suspense>}
          </div>
        </section>}
        {detail && !detail.totalFiles && <GitEmptyState title="이 커밋에는 변경이 없어요"/>}
      </>}
      {['list','commit'].includes(busy) && <p className="desktop-git-empty" role="status">커밋 이력 불러오는 중</p>}
      {failed && <p className="desktop-git-empty" role="alert">{gitErrors[failed]||gitErrors.git_history_failed}</p>}
      {failed && <CxButton className="desktop-git-retry" onClick={() => selected ? (file ? chooseFile(file) : chooseCommit(selected)) : (tipRef.current=null,setOffset(0),setReload(value => value + 1))}><Icon name="refresh" size={16}/>다시 불러오기</CxButton>}
    </div>
    {!selected&&!!catalog?.commits.length&&<nav className="desktop-git-pagination" aria-label="커밋 페이지 이동"><span>{offset+1}–{offset+catalog.commits.length}</span><CxButton data-icon-only aria-label="이전 커밋 페이지" title="이전 페이지" disabled={busy==='list'||offset===0} onClick={()=>setOffset(value=>Math.max(0,value-(catalog.limit||25)))}><Icon name="chevronLeft" size={16}/></CxButton><CxButton data-icon-only aria-label="다음 커밋 페이지" title="다음 페이지" disabled={busy==='list'||!catalog.hasMore} onClick={()=>setOffset(value=>value+(catalog.limit||25))}><Icon name="chevronRight" size={16}/></CxButton></nav>}
  </section>;
}
