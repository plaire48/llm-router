import {pickerWidth} from './picker-width.mjs';
import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {useAnchoredModal} from './useAnchoredModal.js';

// Automatic approval, as in Codex and Claude Code (user decision 2026-09-30: three modes and "always allow").
// Administrator commands and app control always wait for the user; the menu says so.
export const APPROVAL_MODES=[
  {id:'ask',icon:'user',label:'매번 확인',description:'파일 수정과 명령마다 확인해요.'},
  {id:'edits',icon:'pencil',label:'파일 자동 반영',description:'파일은 자동 반영, 명령은 확인해요.'},
  {id:'commands',icon:'automation',label:'파일과 명령 자동',description:'파일 수정과 프로젝트 테스트, 빌드, 점검을 자동 실행해요.'},
];

// The composer control: the current mode as an icon and a name, and a menu to change it or drop an allowed command.
export function ApprovalModeControl({policy,disabled,onMode,onRemove}){
  const [position,setPosition]=useState(null);
  const [open,setOpen]=useState(false),trigger=useRef(null),menu=useRef(null),titleId=useId(),current=APPROVAL_MODES.find(mode=>mode.id===policy?.mode)||APPROVAL_MODES[0];
  useAnchoredModal(menu,trigger,open&&!!position,'[aria-checked="true"]');
  // Follow CX's keyboard-tooltip portal and viewport clamp pattern for this interactive menu.
  useLayoutEffect(()=>{
    if(!open){setPosition(null);return;}
    const place=()=>{const anchor=trigger.current?.getBoundingClientRect(),content=menu.current;if(!anchor||!content)return;const width=pickerWidth(innerWidth-32),above=anchor.top-24,below=innerHeight-anchor.bottom-24,up=above>=content.scrollHeight||above>=below,maxHeight=Math.max(80,up?above:below),height=Math.min(content.scrollHeight,maxHeight);setPosition({width,maxHeight,left:Math.max(16,Math.min(anchor.left,innerWidth-width-16)),top:Math.max(16,up?anchor.top-height-8:anchor.bottom+8)});};
    place();window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);};
  },[open,policy?.allowedCommands?.length]);
  useEffect(()=>{
    if(!open)return;
    const close=event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();setOpen(false);}};
    document.addEventListener('keydown',close);
    return()=>document.removeEventListener('keydown',close);
  },[open]);
  function select(mode){setOpen(false);trigger.current?.focus();if(mode.id!==current.id)onMode(mode.id);}
  function navigate(event){if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const items=[...menu.current.querySelectorAll('[role="menuitemradio"]')],index=items.indexOf(document.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
  const allowed=policy?.allowedCommands||[];
  return <div className="nubi-approval-mode">
    <CxButton ref={trigger} type="button" className="nubi-approval-mode-button" data-mode={current.id} aria-label={'승인 방식: '+current.label} aria-haspopup="dialog" aria-expanded={open} title={'승인 방식: '+current.label} disabled={disabled} onClick={()=>setOpen(value=>!value)}><Icon name={current.icon} size={16}/><span>{current.label}</span><Icon name="chevronDown" size={14}/></CxButton>
    {open&&createPortal(<div className="nubi-approval-mode-layer"><div style={{...position,visibility:position?'visible':'hidden'}} ref={menu} className="nubi-approval-mode-menu" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="nubi-approval-mode-header"><strong id={titleId}>승인 방식</strong><CxButton className="nubi-modal-close" aria-label="승인 방식 닫기" title="닫기" onClick={()=>setOpen(false)}><Icon name="xClose" size={18}/></CxButton></div>
      <div role="menu" aria-label="승인 방식" onKeyDown={navigate}>{APPROVAL_MODES.map(mode=><button key={mode.id} type="button" role="menuitemradio" aria-checked={mode.id===current.id} className="nubi-approval-mode-item" title={mode.description} aria-label={`${mode.label}: ${mode.description}`} onClick={()=>select(mode)}>
        <Icon name={mode.icon} size={18}/><span><strong>{mode.label}</strong></span>{mode.id===current.id&&<Icon name="check" size={16}/>}
      </button>)}</div>
      <p className="nubi-approval-mode-description">{current.description}</p>
      <p className="nubi-approval-mode-note"><Icon name="infoCircle" size={14}/>관리자 명령과 앱 조작은 항상 확인해요.</p>
      {allowed.length>0&&<div className="nubi-approval-allowed" role="group" aria-label="항상 허용한 명령">
        <strong>항상 허용한 명령</strong>
        <ul>{allowed.map(item=><li key={item.profile+'\n'+item.script}><code title={item.script}>{item.script}</code><ActionButton action="delete" label={item.script+' 허용 해제'} title="허용 해제" onClick={()=>{menu.current?.querySelector('[aria-checked="true"]')?.focus();onRemove(item);}}/></li>)}</ul>
      </div>}
    </div></div>,document.body)}
  </div>;
}
