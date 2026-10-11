import React,{useId,useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {AgentTabs} from '../../../extensions/aipro-chat/src/AgentTabs.jsx';
import {SkillMarketplace} from './SkillMarketplace.jsx';
import {CustomSkills} from './CustomSkills.jsx';
export {skillRegistrationErrors} from './skill-registration-state.mjs';

export function SkillLibrary({api,taskId,openPath,onRegister,marketplaceEnabled=false,initialTab='installed',connectMarketplace,openTeamWorkspace}) {
  const [toolbarTarget,setToolbarTarget]=useState(null),[tab,setTab]=useState(marketplaceEnabled?initialTab:'installed'),id=useId();
  const items=[...(marketplaceEnabled?[{key:'marketplace',label:<span className="nubi-skill-tab-label" title="AI Workspace"><Icon name="layoutGrid02" size={16}/><span className="nubi-skill-tab-name">AI Workspace</span></span>}]:[]),{key:'installed',label:<span className="nubi-skill-tab-label" title="내 스킬"><Icon name="layers" size={16}/><span className="nubi-skill-tab-name">내 스킬</span></span>}];
  return <div className="nubi-skill-library-layout"><div className="nubi-skill-tabs"><AgentTabs items={items} active={tab} onChange={setTab} label="스킬 관리" idPrefix={id} panelId={`${id}-panel`}/><div className="nubi-skill-header-actions" ref={setToolbarTarget}/></div><div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>{tab==='marketplace'?<SkillMarketplace toolbarTarget={toolbarTarget} connectMarketplace={connectMarketplace} openTeamWorkspace={openTeamWorkspace} api={api} taskId={taskId} openPath={openPath}/>:<CustomSkills api={api} taskId={taskId} openPath={openPath} onRegister={onRegister} toolbarTarget={toolbarTarget}/>}</div></div>;
}
