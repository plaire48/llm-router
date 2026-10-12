import React, {useLayoutEffect, useRef, useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {NubiComposerInput, NubiComposerBar} from '../../../extensions/aipro-chat/src/NubiSurfaces.jsx';
import {WORKSPACE_LAYOUT} from '../electron-app/workspace-layout.cjs';
import {useComposerCommands} from './ComposerCommands.jsx';

// Shared Nubi composer: model, approval and context stay inside the input surface.
// While running, a draft goes to the inbox and Stop remains available.
export function WorkspaceComposer({className = '', inputRef, id = 'message-input', value, onSubmit, sendDisabled, sending=false, modelControl, actionControl, contextControl, evidenceControl, onStop, onMinimumWidth, commandApi, taskId, onCommand, ...inputProps}) {
  const commands=useComposerCommands({api:commandApi,taskId,value,inputRef,onChange:inputProps.onChange,onCommand});
  const form = useRef(null), previousLayout=useRef(null), entrance=useRef(null);
  useLayoutEffect(()=>{
    const node=form.current;if(!node)return;
    const rect=node.getBoundingClientRect(),previous=previousLayout.current;
    previousLayout.current={top:rect.top,value};
    // Animate only the first Send's layout change. Work starts immediately;
    // admission and subsequent typing never wait for a transition to finish.
    if(previous?.value&&!value&&sending&&node.closest('.nubi-submit-scene')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const offset=previous.top-rect.top;
      if(Math.abs(offset)>2){entrance.current?.cancel();entrance.current=node.animate([{transform:`translateY(${offset}px)`},{transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});}
    }
  },[value,sending]);
  useLayoutEffect(()=>()=>entrance.current?.cancel(),[]);
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  useLayoutEffect(() => {
    if (!onMinimumWidth || !form.current) return;
    const node = form.current, content = node.closest('.nubi-workbench-content');
    const bar = node.querySelector('.composer-bottom');
    let disposed = false;
    const pixels = value => parseFloat(value) || 0;
    const measure = () => {
      if (disposed || !node.isConnected) return;
      
      const groupWidth = group => {
        if (!group) return 0;
        // Count each control, including model recovery and running/queue actions.
        // A wrapper can contain more than one button; capping its total lost space.
        const controls=[...group.querySelectorAll('button,.status-spinner')].filter(item=>!item.closest('[role="dialog"],[role="menu"]')&&item.getClientRects().length);
        const style=getComputedStyle(node),icon=pixels(style.getPropertyValue('--nubi-composer-icon-size'))||36;
        return controls.reduce((sum,item)=>sum+(item.matches('.context-trigger')?Math.max(44,item.getBoundingClientRect().width):item.matches('.status-spinner')?item.getBoundingClientRect().width:icon),0)+Math.max(0,controls.length-1)*pixels(getComputedStyle(group).columnGap);
      };
      let minimum = groupWidth(bar.querySelector('.composer-leading'))+groupWidth(bar.querySelector('.composer-tools'))+pixels(getComputedStyle(bar).columnGap);
      const surfaceStyle=getComputedStyle(node.querySelector('.nubi-composer-surface'));
      minimum+=pixels(surfaceStyle.paddingLeft)+pixels(surfaceStyle.paddingRight)+pixels(surfaceStyle.borderLeftWidth)+pixels(surfaceStyle.borderRightWidth);
      // Include the input card and reading-column insets, not just the icons.
      for (let ancestor = node; ancestor && ancestor !== content; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        // Fluid reading insets contract with the agent. Reserve their lower
        // bound so a wide layout cannot inflate the minimum during resizing.
        const fluid = ancestor.matches('.nubi-main'), inset = pixels(style.getPropertyValue('--nubi-chat-min-inset'));
        minimum += (fluid && inset ? inset * 2 : pixels(style.paddingLeft) + pixels(style.paddingRight)) + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth);
      }
      onMinimumWidth(Math.max(WORKSPACE_LAYOUT.minimumAgent,Math.ceil(minimum) + 2));
    };
    const sizes = new ResizeObserver(measure);
    const observe = () => {
      sizes.disconnect();
      sizes.observe(node);
      for (const item of node.querySelectorAll('.composer-leading > *, .composer-tools > *')) sizes.observe(item);
      measure();
    };
    const changes = new MutationObserver(observe);
    changes.observe(bar, {childList:true, subtree:true, characterData:true});
    observe();
    document.fonts?.ready.then(measure);
    return () => {disposed = true; sizes.disconnect(); changes.disconnect();};
  }, [onMinimumWidth]);
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    const measure = () => {
      const more = field.scrollHeight > 181;
      setHasMore(current => current === more ? current : more);
      if (!more) setExpanded(false);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(field);
    window.addEventListener('resize', measure);
    return () => {observer?.disconnect(); window.removeEventListener('resize', measure);};
  }, [inputRef, value, expanded]);
  function submit(event){event.preventDefault();if(!sendDisabled)onSubmit(event);}
  function keyDown(event){
    if(commands.onKeyDown(event))return;
    inputProps.onKeyDown?.(event);
    if(!event.defaultPrevented&&event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229)submit(event);
  }
  return <form ref={form} className={`composer ${className}`} onSubmit={submit}>
    <div className="nubi-composer-surface">
    {evidenceControl}
    <div className="nubi-composer-input" data-expanded={expanded}>
      <NubiComposerInput rows={1} inputRef={inputRef} id={id} value={value} title="" {...inputProps} {...commands.inputAttributes} onKeyDown={keyDown}/>
    </div>
    <NubiComposerBar leading={modelControl} tools={<>{actionControl}{contextControl}{hasMore && <CxButton type="button" className="nubi-composer-more" data-icon-only aria-expanded={expanded} aria-controls={id} onClick={() => {
      setExpanded(current => !current);
      requestAnimationFrame(() => inputRef.current?.focus());
    }} aria-label={expanded?'접기':'더 보기'} title={expanded?'입력 접기':'입력 펼치기'}><Icon name={expanded?'chevronUp':'chevronDown'} size={16}/></CxButton>}{onStop ? <>{value.trim()&&<CxButton type="submit" variant="primary" data-icon-only aria-label="대기열에 추가" title="대기열에 추가" disabled={sendDisabled}><Icon name="arrowUp" size={20}/></CxButton>}<CxButton type="button" className="nubi-composer-stop" data-icon-only aria-label="중지" title="작업 중지" onClick={onStop}><span className="stop-symbol" aria-hidden="true"/></CxButton></> : <CxButton type="submit" variant="primary" data-icon-only aria-label={sending?"요청 접수 중":"전송"} title={sending?"요청 접수 중":"전송"} disabled={sendDisabled}>{sending?<span className="status-spinner" aria-hidden="true"/>:<Icon name="arrowUp" size={20}/>}</CxButton>}</>}/>
    </div>
    {commands.popup}
  </form>;
}
