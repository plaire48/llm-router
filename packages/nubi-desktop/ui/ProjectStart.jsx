import React, {useId, useRef, useState} from 'react';
import {CxButton, CxInput, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {remoteAddress} from './remote-address.mjs';
import {BranchMark, FolderMark} from './marks.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';

// Select the model first. Git clones into a new child of the chosen parent.
export function ProjectStart({projects=[],onSelectProject,busy, blocked=false, modelControl, onOpenFolder, onClone, onStartConversation, onCancel}) {
  const [remote, setRemote] = useState(''), [gitOpen, setGitOpen] = useState(false);
  const input = useRef(null), gitForm = useId();
  async function clone(event) {
    event.preventDefault();
    const url = remote.trim();
    if (!url || busy || blocked) return;
    if (!remoteAddress(url)) {notifyWorkspaceToast('https://, ssh:// 또는 git@ 주소를 넣어 주세요.', {error:true});input.current?.focus();return;}
    const result = await onClone(url);
    if (result?.projectId) setRemote('');
  }
  return <section className="nubi-project-start" aria-label="프로젝트 열기" aria-busy={busy}>
    {modelControl&&<div className="nubi-start-model">{modelControl}</div>}
    {projects.length>0&&onSelectProject&&<nav className="nubi-start-projects" aria-label="추가한 프로젝트">{projects.map(project=><CxButton key={project.id} disabled={busy||blocked} title={project.root} onClick={()=>onSelectProject(project.id)}><FolderMark size={18}/><span>{project.name}</span><Icon name="chevronRight" size={16}/></CxButton>)}</nav>}
    <div className="nubi-start-choices" data-count={1+Number(!!onClone)}>
      <button type="button" className="nubi-start-card" disabled={busy||blocked} onClick={onOpenFolder}>
        <span className="nubi-start-tile" data-tone="blue"><FolderMark/></span>
        <strong>폴더 열기</strong>
        <span className="nubi-start-text">최상위 폴더 선택</span>
        <span className="nubi-start-go" aria-hidden="true"><Icon name="arrowRight" size={18}/></span>
      </button>
      {onClone&&<button type="button" className="nubi-start-card" disabled={busy||blocked} aria-expanded={gitOpen} aria-controls={gitForm} onClick={()=>{setGitOpen(value=>!value);requestAnimationFrame(()=>input.current?.focus());}}>
        <span className="nubi-start-tile" data-tone="blue"><BranchMark/></span>
        <strong>Git URL</strong>
        <span className="nubi-start-text">새 폴더로 복제</span>
        <span className="nubi-start-go" aria-hidden="true"><Icon name={gitOpen?'chevronUp':'arrowRight'} size={18}/></span>
      </button>}
    </div>
    {gitOpen&&<form id={gitForm} className="nubi-start-git" aria-label="Git URL로 프로젝트 열기" noValidate onSubmit={clone}>
      <label htmlFor={gitForm+'-url'}><BranchMark size={16}/>저장소 주소</label>
      <p className="nubi-muted">선택한 폴더 아래에 새 폴더로 복제해요.</p>
      <div className="nubi-start-field">
        <CxInput ref={input} id={gitForm+'-url'} placeholder="https://github.com/team/project.git" value={remote} spellCheck={false} autoComplete="off" disabled={busy||blocked} onChange={event=>setRemote(event.target.value)}/>
        <CxButton type="submit" variant="primary" disabled={!remote.trim()||busy||blocked}><FolderMark size={16}/>저장할 폴더 선택</CxButton>
      </div>
    </form>}
    <p className="nubi-start-privacy"><Icon name="infoCircle" size={14}/>프로젝트 내용이 선택한 모델에 전달돼요.</p>
    <div className="nubi-start-secondary">
      {onCancel&&<ActionButton action="back" label="대화로 돌아가기" disabled={busy} onClick={onCancel}/>}
      {onStartConversation&&<CxButton disabled={busy||blocked} onClick={onStartConversation}><Icon name="message" size={16}/>프로젝트 없이 대화</CxButton>}
    </div>
  </section>;
}
