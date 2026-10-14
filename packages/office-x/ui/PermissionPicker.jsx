import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,Icon} from '@e2e/cx-design-system';
const modes=[
 {id:'read',label:'읽기 전용',detail:'문서를 읽고 분석합니다'},
 {id:'confirm',label:'매번 확인',detail:'변경 내용을 확인한 뒤 적용합니다'},
 {id:'auto',label:'자동 적용',detail:'요청한 편집을 반복 확인 없이 적용합니다'},
];
export function PermissionPicker({mode='confirm',disabled,onChange}){
 const [open,setOpen]=useState(false),[position,setPosition]=useState({}),trigger=useRef(null),panel=useRef(null);
 const selected=modes.find(item=>item.id===mode)||modes[1];
 const close=()=>{setOpen(false);trigger.current?.focus();};
 useEffect(()=>{
  if(!open)return;
  const place=()=>{const r=trigger.current.getBoundingClientRect();setPosition({right:Math.max(12,innerWidth-r.right),bottom:Math.max(12,innerHeight-r.top+8)});};place();
  const outside=e=>{if(!panel.current?.contains(e.target)&&!trigger.current?.contains(e.target))setOpen(false);};
  const frame=requestAnimationFrame(()=>panel.current?.querySelector('[aria-checked="true"]')?.focus());
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);};
 },[open]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 return <><button ref={trigger} className="office-permission-trigger" type="button" disabled={disabled} aria-label={'작업 권한: '+selected.label} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}><Icon name="sliders" size={14}/><span>{selected.label}</span><span aria-hidden="true">⌄</span></button>{open&&createPortal(<div ref={panel} className="office-permission-menu" style={position} role="menu" aria-label="작업 권한" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...panel.current.querySelectorAll('[role="menuitemradio"]')],at=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}if(e.key==='Tab')setOpen(false);}}><strong className="office-permission-title">작업 권한</strong>{modes.map(item=><CxButton key={item.id} role="menuitemradio" aria-checked={mode===item.id} className="office-permission-option" onClick={()=>{onChange(item.id);close();}}><span><strong>{item.label}</strong><small>{item.detail}</small></span><span aria-hidden="true">{mode===item.id?'✓':''}</span></CxButton>)}<p>복원, 파일 덮어쓰기, 불확실한 결과는 확인합니다.</p></div>,document.body)}</>;
}
