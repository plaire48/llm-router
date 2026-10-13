// Adapted from the immutable Workspace scroll hook for resizing Office panes.
import {useCallback,useLayoutEffect,useRef,useState} from 'react';

// Match the browser chat's follow-latest behavior. Only a user's new turn or
// steering admission resumes following while they are reading older content.
export function useOfficeConversationScroll(conversationId,userMessageKey,steeringKey) {
  const viewport=useRef(null),content=useRef(null),following=useRef(true);
  const [away,setAway]=useState(false);
  const geometry=useRef({height:0,total:0});
  const followLatest=useCallback(()=>{
    following.current=true;
    if(viewport.current){viewport.current.scrollTop=viewport.current.scrollHeight;geometry.current={height:viewport.current.clientHeight,total:viewport.current.scrollHeight};}
    setAway(false);
  },[]);
  useLayoutEffect(()=>{
    const list=viewport.current,body=content.current;
    if(!list||!body)return;
    followLatest();
    const observer=new ResizeObserver(()=>{
      if(following.current)list.scrollTop=list.scrollHeight;
      geometry.current={height:list.clientHeight,total:list.scrollHeight};
      setAway(list.scrollHeight-list.scrollTop-list.clientHeight>24);
    });
    observer.observe(list);observer.observe(body);
    return()=>observer.disconnect();
  },[conversationId,followLatest]);
  useLayoutEffect(()=>{followLatest();},[conversationId,userMessageKey,steeringKey,followLatest]);
  const onScroll=event=>{
    const list=event.currentTarget;
    // A resizing Office pane/input changes scrollTop too. Only an actual scroll
    // within unchanged geometry changes the follow-latest intent.
    if(list.clientHeight!==geometry.current.height||list.scrollHeight!==geometry.current.total)return;
    following.current=list.scrollHeight-list.scrollTop-list.clientHeight<=24;
    setAway(!following.current);
  };
  const onFocusCapture=event=>{
    if(event.target.matches('input,textarea'))following.current=false;
  };
  return {viewport,content,away,followLatest,onScroll,onFocusCapture};
}
