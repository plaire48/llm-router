import React,{useId,useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {WorkspaceCatalogTabs} from './WorkspaceCatalogTabs.jsx';
import {SkillMarketplace} from './SkillMarketplace.jsx';
import {CustomSkills} from './CustomSkills.jsx';
export {skillRegistrationErrors} from './skill-registration-state.mjs';

export function SkillLibrary({api,taskId,openPath,onRegister,marketplaceEnabled=false,initialTab='installed',connectMarketplace,page=false}) {
  const [toolbarTarget,setToolbarTarget]=useState(null),[tab,setTab]=useState(marketplaceEnabled?initialTab:'installed'),id=useId();
  const items=[...(marketplaceEnabled?[{key:'marketplace',label:<span className="nubi-skill-tab-label" title="Team"><Icon name="layoutGrid02" size={16}/><span className="nubi-skill-tab-name">Team</span></span>}]:[]),{key:'installed',label:<span className="nubi-skill-tab-label" title="Personal (내 스킬)"><Icon name="layers" size={16}/><span className="nubi-skill-tab-name">Personal</span></span>}];
  return <div className="nubi-skill-library-layout" data-page={page||undefined}><p className="nubi-skill-purpose">이 프로젝트에서 AI가 사용할 작업 지침을 관리해요.</p><div className="nubi-skill-tabs"><WorkspaceCatalogTabs items={items} active={tab} onChange={setTab} label="스킬 관리" idPrefix={id} panelId={`${id}-panel`}/><div className="nubi-skill-header-actions" ref={setToolbarTarget}/></div><div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>{tab==='marketplace'?<SkillMarketplace toolbarTarget={toolbarTarget} connectMarketplace={connectMarketplace} api={api} taskId={taskId} openPath={openPath}/>:<CustomSkills searchable={page} api={api} taskId={taskId} openPath={openPath} onRegister={onRegister} toolbarTarget={toolbarTarget}/>}</div></div>;
}
