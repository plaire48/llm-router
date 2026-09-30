import React, {useId, useState} from 'react';
import {CxButton, CxInput, Icon} from '@e2e/cx-design-system';
import {remoteAddress} from './remote-address.mjs';

// Folder and branch marks; the design system has no folder or branch glyph.
const Mark = ({children}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const FolderMark = () => <Mark><path d="M3.5 7.5a2 2 0 0 1 2-2h3.7l2 2.2h7.3a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></Mark>;
const BranchMark = () => <Mark><circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8" r="2"/><path d="M6.5 7.5v9M17.5 10c0 4-4.5 4.2-9.6 6.9"/></Mark>;

// Where a first project comes from (user decision 2026-09-30): a folder on this PC, or a remote
// repository the host clones and opens. The cards take the composer's place and width.
export function ProjectStart({busy, onOpenFolder, onClone}) {
  const [remote, setRemote] = useState(''), [invalid, setInvalid] = useState(false), folderText = useId(), hint = useId();
  function clone(event) {
    event.preventDefault();
    const url = remote.trim();
    if (!url || busy) return;
    if (!remoteAddress(url)) { setInvalid(true); return; }
    Promise.resolve(onClone(url)).then(result => { if (result && !result.cancelled) setRemote(''); });
  }
  return <div className="nubi-project-start">
    <p className="nubi-start-support">폴더를 열면 누비가 코드를 읽고 실행 환경을 준비해요.</p>
    <div className="nubi-start-choices" data-count={onClone ? 2 : 1}>
      <button type="button" className="nubi-start-card" aria-label="폴더 열기" aria-describedby={folderText} disabled={busy} onClick={onOpenFolder}>
        <span className="nubi-start-tile" data-tone="blue"><FolderMark/></span>
        <strong>폴더 열기</strong>
        <span id={folderText} className="nubi-start-text">내 PC에 있는 프로젝트</span>
        <span className="nubi-start-go" aria-hidden="true"><Icon name="arrowRight" size={18}/></span>
      </button>
      {onClone && <form className="nubi-start-card" aria-label="저장소 복제" noValidate onSubmit={clone}>
        <span className="nubi-start-tile" data-tone="violet"><BranchMark/></span>
        <strong>저장소 복제</strong>
        <span className="nubi-start-text">Git 주소로 받아서 열어요</span>
        <span className="nubi-start-field">
          <CxInput aria-label="원격 저장소 주소" aria-invalid={invalid || undefined} aria-describedby={invalid ? hint : undefined} placeholder="https://code.sdsdev.co.kr/repo.git" value={remote} spellCheck={false} autoComplete="off" onChange={event => { setRemote(event.target.value); setInvalid(false); }}/>
          <CxButton type="submit" variant="primary" className="nubi-start-submit" aria-label="복제" title="복제해서 열기" disabled={!remote.trim() || busy}><Icon name="arrowRight" size={18}/></CxButton>
        </span>
        {invalid && <span id={hint} className="nubi-start-hint" role="alert">https://, ssh:// 또는 git@ 주소를 넣어 주세요.</span>}
      </form>}
    </div>
  </div>;
}
