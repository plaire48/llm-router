import React,{useEffect,useId,useRef} from 'react';
import {Icon} from '@e2e/cx-design-system';

// The native top layer escapes sidebar/modal clipping without moving the row.
export function WorkspaceActionMenu({label='관리',inline=false,children}){
 const root=useRef(null),panel=useRef(null),trigger=useRef(null),pressedOpen=useRef(false),id=useId();
 const items=()=>[...panel.current.querySelectorAll('button:not(:disabled),a[href]')];
 function close(restore=false){
  if(panel.current.matches(':popover-open'))panel.current.hidePopover();
  root.current.open=false;
  if(restore)trigger.current.focus();
 }
 function position(){
  const anchor=trigger.current.getBoundingClientRect(),box=panel.current.getBoundingClientRect(),gap=6,inset=8;
  const left=Math.max(inset,Math.min(anchor.right-box.width,innerWidth-box.width-inset));
  const top=Math.max(inset,Math.min(anchor.bottom+box.height+gap<=innerHeight-inset?anchor.bottom+gap:anchor.top-box.height-gap,innerHeight-box.height-inset));
  Object.assign(panel.current.style,{left:`${left}px`,top:`${top}px`});
 }
 function show(){
  root.current.open=true;
  panel.current.showPopover({source:trigger.current});position();
 }
 useEffect(()=>{
  const popup=panel.current;
  const sync=event=>{if(event.newState==='closed')root.current.open=false;};
  const dismiss=event=>{if(!(event.target instanceof Node)||!popup.contains(event.target))close();};
  popup.addEventListener('beforetoggle',sync);
  window.addEventListener('resize',dismiss);document.addEventListener('scroll',dismiss,true);
  return()=>{popup.removeEventListener('beforetoggle',sync);window.removeEventListener('resize',dismiss);document.removeEventListener('scroll',dismiss,true);};
 },[]);
 return <details ref={root} className="nubi-actions-disclosure" onKeyDownCapture={event=>{
  if(event.key==='Escape'&&root.current.open){event.preventDefault();event.stopPropagation();close(true);}
 }} onKeyDown={event=>{
  if(event.key==='Escape'&&root.current.open){event.preventDefault();event.stopPropagation();close(true);}
  else if(['ArrowDown','ArrowUp','Home','End',...(inline?['ArrowLeft','ArrowRight']:[])].includes(event.key)){
   event.preventDefault();event.stopPropagation();if(!root.current.open)show();
   const buttons=items(),index=buttons.indexOf(document.activeElement);
   const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:['ArrowDown','ArrowRight'].includes(event.key)?(index+1)%buttons.length:(index<=0?buttons.length:index)-1;
   buttons[next]?.focus();
  }
 }}>
  <summary ref={trigger} aria-label={label} title={label} aria-controls={id} onPointerDown={()=>{pressedOpen.current=panel.current.matches(':popover-open');}} onClick={event=>{event.preventDefault();(event.detail>0&&pressedOpen.current)||panel.current.matches(':popover-open')?close():show();pressedOpen.current=false;}}><Icon name="moreHorizontal" size={16}/></summary>
  <div ref={panel} id={id} popover="auto" role="group" aria-label={label} data-inline={inline||undefined} className="nubi-actions-disclosure-body" onClickCapture={event=>{
   // Hide before an action opens a confirmation, so focus can move to that dialog.
   if(event.target.closest('button:not(:disabled),a[href]'))close(true);
  }} onBlur={event=>{if(event.relatedTarget&&!root.current.contains(event.relatedTarget))close();}}>{children}</div>
 </details>;
}
