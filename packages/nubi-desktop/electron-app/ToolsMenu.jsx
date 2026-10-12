import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {TerminalMark,FolderMark,BrowserMark} from '../ui/marks.jsx';

export function ToolsMenu({profiles=[],defaultShell,projectReady,onTerminal,onFiles,onWeb,onOpenChange}) {
 const [open,setOpen]=useState(false),[shells,setShells]=useState(false);
 const anchor=useRef(null),trigger=useRef(null),menuNode=useRef(null);
 const [menuStyle,setMenuStyle]=useState(undefined);
 useLayoutEffect(()=>{
  if(!open)return;const pane=anchor.current.closest('.desktop-pane');
  const place=()=>{const target=anchor.current.getBoundingClientRect(),bounds=pane?.getBoundingClientRect()||{left:0,right:innerWidth,width:innerWidth},width=Math.min(220,bounds.width-16),left=Math.max(bounds.left+8,Math.min(target.right-width,bounds.right-width-8))-target.left;setMenuStyle(current=>current?.left===left&&current?.width===width?current:{left,width,right:'auto'});};
  place();const observer=new ResizeObserver(place);observer.observe(pane||anchor.current);window.addEventListener('resize',place);return()=>{observer.disconnect();window.removeEventListener('resize',place);};
 },[open]);
 useEffect(()=>{onOpenChange(open);},[open,onOpenChange]);
 useEffect(()=>{if(!open)return;const close=event=>{if(!anchor.current?.contains(event.target))setOpen(false);};document.addEventListener('pointerdown',close);anchor.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();return()=>document.removeEventListener('pointerdown',close);},[open]);
 function choose(action){setOpen(false);setShells(false);trigger.current?.focus();action();}
 return <div className="desktop-tools-anchor" ref={anchor} onKeyDown={event=>{
  if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();if(shells)setShells(false);else{setOpen(false);trigger.current?.focus();}}
  if(open&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){const items=[...anchor.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];if(!items.length)return;event.preventDefault();const index=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();}
 }}>
  <CxButton ref={trigger} className="desktop-dock-action" aria-label="새 탭" title="새 탭" aria-haspopup="menu" aria-expanded={open} onClick={()=>{setShells(false);setOpen(value=>!value);}}><Icon name="plus" size={18}/></CxButton>
  {open&&<div ref={menuNode} style={menuStyle} className="desktop-tools-menu" role="menu" aria-label="새 탭">

   <div className="desktop-tools-terminal-row"><CxButton role="menuitem" disabled={!projectReady} onClick={()=>choose(()=>onTerminal(defaultShell))}><TerminalMark size={17}/><span>터미널</span></CxButton><CxButton role="menuitem" className="desktop-tools-shell-trigger" aria-label="터미널 종류 선택" title="터미널 종류 선택" aria-expanded={shells} disabled={!projectReady||!profiles.length} onClick={()=>setShells(value=>!value)}><Icon name="moreHorizontal" size={16}/><span>종류</span></CxButton></div>
   {shells&&<div className="desktop-tools-shell-list" role="group" aria-label="사용할 터미널">{profiles.map(profile=><CxButton role="menuitem" key={profile.id} onClick={()=>choose(()=>onTerminal(profile.id))}><TerminalMark size={15}/><span>{profile.label}</span>{profile.id===defaultShell&&<Icon name="check" size={14}/>}</CxButton>)}</div>}
   <CxButton role="menuitem" disabled={!projectReady} onClick={()=>choose(onFiles)}><FolderMark size={17}/><span>파일</span></CxButton>
   <CxButton role="menuitem" onClick={()=>choose(onWeb)}><BrowserMark size={17}/><span>웹</span></CxButton>
  </div>}
 </div>;
}
