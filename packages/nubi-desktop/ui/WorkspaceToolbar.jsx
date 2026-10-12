import React, {useLayoutEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '@e2e/cx-design-system';
import {NubiLogo} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {WorkspaceIconAction} from './WorkspaceIconAction.jsx';
import {FolderMark} from './marks.jsx';

export function WorkspaceToolbar({host, layoutRoot, title, project, status, sidebarOpen, onToggleSidebar, onNew, disabled, children, accountControl}) {
  const navigation=useRef(null);
  useLayoutEffect(()=>{
    const root=layoutRoot?.current, nav=navigation.current, sidebar=root?.querySelector('.nubi-sidebar');
    if(!host||!root||!nav||!sidebar)return;
    const align=()=>{
      const aligned=sidebarOpen&&root.dataset.compact==='false'&&sidebar.getClientRects().length>0;
      nav.dataset.aligned=String(aligned);
      if(aligned)nav.style.setProperty('--nubi-brand-column',`${Math.max(0,sidebar.getBoundingClientRect().right-nav.getBoundingClientRect().left)}px`);
      else nav.style.removeProperty('--nubi-brand-column');
    };
    const sizes=new ResizeObserver(align);sizes.observe(sidebar);sizes.observe(root);sizes.observe(host);
    const changes=new MutationObserver(align);changes.observe(root,{attributes:true,attributeFilter:['data-compact']});
    align();return()=>{sizes.disconnect();changes.disconnect();};
  },[host,layoutRoot,project,sidebarOpen]);
  if (!host) return null;
  return createPortal(<header className="nubi-window-toolbar" aria-label="Workspace 상단 메뉴">
    <div ref={navigation} className="nubi-toolbar-navigation">
      <NubiLogo size={22} product="Workspace" versionLabel="Beta"/>
      {project && <WorkspaceIconAction icon={sidebarOpen?'panelLeftClose':'panelLeft'} iconOnly label={sidebarOpen?'사이드바 접기':'사이드바 펼치기'} aria-expanded={sidebarOpen} onClick={onToggleSidebar}/>}
    </div>
    <div className="nubi-toolbar-context" title={title}>
      {project?<FolderMark size={18}/>:<Icon name="message" size={18}/>}<span>{title}</span>
    </div>
    {status&&<span className="nubi-toolbar-state">{status}</span>}
    <div className="nubi-toolbar-actions">{children}{project && <WorkspaceIconAction icon="plus" iconOnly label="새 대화" disabled={disabled} onClick={onNew}/>}</div>
    {accountControl&&<div className="nubi-toolbar-account">{accountControl}</div>}
  </header>,host);
}
