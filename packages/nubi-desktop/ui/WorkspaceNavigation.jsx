import {WorkspaceIconAction} from './WorkspaceIconAction.jsx';
import React from 'react';
import {auxiliaryMenu} from './auxiliary-menu.js';
import {teamWorkspaceMark} from './TeamWorkspaceMark.js';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {BranchMark, FolderMark, TerminalMark, HomeMark} from './marks.jsx';

const TOOLS = [
  ['files', '파일', '프로젝트 파일 열기', FolderMark],
  ['changes', 'Git 변경', '이 프로젝트의 변경 확인', BranchMark],
  ['history', '커밋 이력', '프로젝트 커밋 이력 확인', null],
  ['search', '검색', '프로젝트 내용 검색', null],
  ['terminal', '터미널', '이 프로젝트의 터미널 열기', TerminalMark],
];

// Fixed native navigation only. No model tools, arbitrary command strings,
// agent execution or approval are exposed by these controls.
export function WorkspaceNavigation({onView, disabled, rail = false, onHome, onSettings, homeDisabled, settingsRef, onSkills, onTeamWorkspace, skillsRef, skillsActive,teamActive,accountControl,onMail,mailActive,activeView,homeActive,onSidebarToggle,sidebarOpen}) {
  const button = (view, label, title, Mark) => {const selected=activeView===view||auxiliaryMenu(activeView)===view;return <CxButton key={view} data-tone="blue" data-icon-only={rail||view==='files'||undefined} aria-pressed={selected} disabled={disabled&&!selected} aria-label={label} title={title} onClick={() => onView(view)}>{Mark?<Mark size={18}/>:<Icon name={view==='search'?'search':view==='history'?'clock':'code'} size={18}/>}{!rail&&view!=='files'&&<span>{label}</span>}</CxButton>;};
  return <nav className={`nubi-workspace-navigation${rail?' nubi-workspace-rail':''}`} aria-label="프로젝트 도구">
    {rail&&<CxButton data-tone="blue" aria-pressed={homeActive} disabled={homeDisabled} aria-label="홈" title="새 대화" onClick={onHome}><HomeMark size={18}/></CxButton>}
    {rail&&onMail&&<CxButton data-tone="blue" aria-label="메일" aria-pressed={mailActive} title="메일 수신 이력" onClick={onMail}><Icon name="mail" size={18}/></CxButton>}
    {rail&&button('files','파일','프로젝트 파일 열기',FolderMark)}
    {(rail?TOOLS.slice(1,2):TOOLS.filter(([view])=>view!=='terminal')).map(([view,label,title,Mark])=>button(view,label,title,Mark))}
    {onSettings&&<WorkspaceIconAction ref={settingsRef} className="nubi-rail-settings" icon="sliders" label="설정" title="누비 설정" onClick={onSettings}/>}
    {rail&&accountControl}
    {rail&&onTeamWorkspace&&<CxButton className="nubi-rail-team" aria-pressed={!!teamActive} aria-label="AI Workspace" title="AI Workspace 열기" data-icon-only onClick={onTeamWorkspace}><img className="nubi-team-mark" src={teamWorkspaceMark} alt=""/></CxButton>}
  </nav>;
}
