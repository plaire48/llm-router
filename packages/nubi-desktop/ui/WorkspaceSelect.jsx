import React,{useLayoutEffect,useRef} from 'react';
import {CxSelect as BaseSelect} from '@e2e/cx-design-system';

// Preserve CX keyboard selection, validation and portal ownership. Only the
// dropdown geometry differs: its edges follow the field, without the 420px cap.
export function CxSelect({ref:forwardedRef,options,children,...props}){
 const field=useRef(null);
 useLayoutEffect(()=>{
  const node=field.current;if(!node)return;let frame=0;
  const place=()=>{
   const menu=document.getElementById(node.getAttribute('aria-controls'));
   if(!menu?.classList.contains('cx-select-menu'))return;
   const rect=node.getBoundingClientRect(),viewport=window.visualViewport,left=viewport?.offsetLeft||0,room=(viewport?.width||innerWidth)-16,width=Math.min(rect.width,room);
   menu.style.setProperty('width',`${width}px`,'important');
   menu.style.setProperty('left',`${Math.max(left+8,Math.min(rect.left,left+room+8-width))}px`,'important');
  };
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(place);};
  const changes=new MutationObserver(place);changes.observe(node,{attributes:true,attributeFilter:['aria-controls','aria-expanded']});
  const sizes=new ResizeObserver(schedule);sizes.observe(node);
  window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',schedule);
  return()=>{changes.disconnect();sizes.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);window.visualViewport?.removeEventListener('resize',schedule);};
 },[]);
 return <BaseSelect {...props} ref={node=>{field.current=node;if(typeof forwardedRef==='function')forwardedRef(node);else if(forwardedRef)forwardedRef.current=node;}}>{children ?? options?.map(option=><option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</BaseSelect>;
}
