import {useLayoutEffect} from 'react';
import {captionColors} from './titlebar-colors.cjs';

// Native window controls sit above the web surface and cannot receive its scrim.
// Read the rendered CX colors, including stacked dialogs, instead of duplicating tokens.
export function useNativeTitlebar(request) {
 useLayoutEffect(()=>{
  if(!window.nubi?.desktop)return;
  let pending=0,last='';
  const update=()=>{
   pending=0;
   const toolbar=document.querySelector('.nubi-window-toolbar');if(!toolbar)return;
   const style=getComputedStyle(toolbar),symbol=style.getPropertyValue('--deck-sub').trim();
   const layers=[...document.querySelectorAll('.cx-panel-backdrop')].filter(node=>{
    const rect=node.getBoundingClientRect();return node.checkVisibility()&&rect.top<=24&&rect.bottom>24&&rect.right>=innerWidth-1;
   }).sort((a,b)=>(Number(getComputedStyle(a).zIndex)||0)-(Number(getComputedStyle(b).zIndex)||0)).map(node=>getComputedStyle(node).backgroundColor);
   const colors=captionColors(style.backgroundColor,symbol,layers),key=JSON.stringify(colors);
   if(key===last)return;last=key;
   void request('titlebarAppearance',colors).catch(()=>{if(last===key)last='';});
  };
  const schedule=()=>{if(!pending)pending=requestAnimationFrame(update);};
  const affectsCaption=node=>node instanceof Element&&(node.matches('.cx-panel-backdrop,.nubi-window-toolbar')||!!node.querySelector('.cx-panel-backdrop,.nubi-window-toolbar'));
  const observer=new MutationObserver(records=>{
   if(records.some(record=>record.type==='childList'?[...record.addedNodes,...record.removedNodes].some(affectsCaption):affectsCaption(record.target)))schedule();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden']});
  window.addEventListener('resize',schedule);update();
  return()=>{observer.disconnect();cancelAnimationFrame(pending);window.removeEventListener('resize',schedule);};
 },[request]);
}
