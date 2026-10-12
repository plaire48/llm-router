import {useRef,useState} from 'react';

// Per-window draft storage. Never send these values to the agent until Submit.
// JSON tuple keys distinguish projects, a blank conversation and real tasks.
export function useComposerDraft(projectId,taskId) {
  const cache=useRef(new Map()),[,render]=useState(0);
  const key=projectId?`nubi-composer-v1:${JSON.stringify([projectId,taskId??null])}`:null;
  if(key&&!cache.current.has(key)) {
    let value='';try{value=sessionStorage.getItem(key)||'';}catch{}
    cache.current.set(key,value);
  }
  const value=key?cache.current.get(key):'';
  function setValue(next) {
    if(!key)return;
    cache.current.set(key,next);
    try{if(next)sessionStorage.setItem(key,next);else sessionStorage.removeItem(key);}catch{}
    render(n=>n+1);
  }
  function moveTo(nextTaskId){if(!key)return;const nextKey=`nubi-composer-v1:${JSON.stringify([projectId,nextTaskId])}`,text=cache.current.get(key)||'';cache.current.set(nextKey,text);try{if(text)sessionStorage.setItem(nextKey,text);else sessionStorage.removeItem(nextKey);}catch{}setValue('');}
  return [value,setValue,()=>key?cache.current.get(key)||'':'',moveTo];
}
