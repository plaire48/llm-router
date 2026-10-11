import React,{useEffect,useRef} from 'react';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {SkillLibrary} from './SkillLibrary.jsx';

// The page and composer dialog share the same registration and management flow.
export function SkillManager({api,taskId,openPath,onBack,onRegister,connectMarketplace,openTeamWorkspace}){
  const heading=useRef(null);
  useEffect(()=>{heading.current?.focus();},[]);
  return <section className="nubi-skill-page" aria-label="스킬 관리"><header className="nubi-skill-page-header"><ActionButton action="back" label="대화로 돌아가기" onClick={onBack}/><h1 ref={heading} tabIndex={-1}>스킬 관리</h1></header><div className="nubi-skill-page-body"><SkillLibrary api={api} taskId={taskId} openPath={openPath} onRegister={onRegister} marketplaceEnabled connectMarketplace={connectMarketplace} openTeamWorkspace={openTeamWorkspace}/></div></section>;
}
