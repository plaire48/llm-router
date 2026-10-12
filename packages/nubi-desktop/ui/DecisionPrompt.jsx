import React,{useEffect,useRef,useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {TerminalMark} from './marks.jsx';

// Only one pending decision claims focus. Closing postpones the decision;
// it never answers a question, rejects a proposal or grants permission.
let activeDecision=null;
const changed='nubi-decision-available';
export function DecisionPrompt({id,title,summary,icon='helpCircle',label='확인하기',pending=true,blocked=false,children}){
 const [open,setOpen]=useState(false),seen=useRef(new Set()),owner=useRef(Symbol('decision')),trigger=useRef(null);
 const release=()=>{if(activeDecision===owner.current){activeDecision=null;document.dispatchEvent(new Event(changed));}};
 useEffect(()=>{
  if(!pending){setOpen(false);release();return;}
  if(blocked)return;
  let frame=0;
  const check=()=>{
   if(seen.current.has(id)||activeDecision||document.visibilityState==='hidden')return;
   if([...document.querySelectorAll('[aria-modal="true"]')].some(node=>node.getClientRects().length&&!node.closest('[inert],[hidden]')))return;
   activeDecision=owner.current;seen.current.add(id);setOpen(true);
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(check);};
  const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true});
  document.addEventListener(changed,schedule);document.addEventListener('visibilitychange',schedule);schedule();
  return()=>{observer.disconnect();cancelAnimationFrame(frame);document.removeEventListener(changed,schedule);document.removeEventListener('visibilitychange',schedule);};
 },[id,pending,blocked]);
 useEffect(()=>()=>release(),[]);
 const close=()=>{setOpen(false);release();requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));};
 return <div className="nubi-decision-prompt">
  <span className="nubi-decision-summary">{icon==='terminal'?<TerminalMark size={18}/>:<Icon name={icon} size={18}/>}<span title={summary}>{summary}</span></span>
  <CxButton ref={trigger} className="nubi-text-button" disabled={blocked} onClick={()=>{if(open){close();return;}if(activeDecision&&activeDecision!==owner.current)return;seen.current.add(id);activeDecision=owner.current;setOpen(true);}}><Icon name="arrowRight" size={16}/>{label}</CxButton>
  {open&&<DetailPanel title={title} variant="modal" className="deck-dialog nubi-panel nubi-decision-dialog" onClose={close} busy={blocked} initialFocus=".cx-panel-header button[data-action=close]">{children}</DetailPanel>}
 </div>;
}
