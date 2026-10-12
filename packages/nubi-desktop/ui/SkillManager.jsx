import React,{useEffect,useRef,useState} from 'react';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {SkillLibrary} from './SkillLibrary.jsx';
import {Icon} from '@e2e/cx-design-system';
import {AgentTabs} from '../../../extensions/aipro-chat/src/AgentTabs.jsx';
import {WikiRepository} from './WikiRepository.jsx';

// The page and composer dialog share the same registration and management flow.
export function SkillManager({api,taskId,openPath,onBack,onRegister,connectMarketplace,initialTab,onSignIn,accountRevision}){
  const heading=useRef(null),[section,setSection]=useState('skills');
  useEffect(()=>{heading.current?.focus();},[]);
  return <section className="nubi-skill-page" aria-label="AI Workspace"><header className="nubi-skill-page-header"><ActionButton action="back" label="대화로 돌아가기" onClick={onBack}/><h1 ref={heading} tabIndex={-1}>AI Workspace</h1></header><div className="nubi-skill-page-body"><AgentTabs items={[{key:'skills',label:<><Icon name="layers" size={16}/>스킬</>},{key:'wiki',label:<><Icon name="bookmark" size={16}/>위키</>}]} active={section} onChange={setSection} label="AI Workspace 영역" idPrefix="workspace-section"/>{section==='wiki'?<WikiRepository key={accountRevision} api={api} onSignIn={onSignIn}/>:<SkillLibrary page api={api} taskId={taskId} openPath={openPath} onRegister={onRegister} marketplaceEnabled connectMarketplace={connectMarketplace} initialTab={initialTab}/>}</div></section>;
}
