import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {TerminalMark} from './marks.jsx';
import {commandOptions} from '../runtime/agent-commands.mjs';

export function useComposerCommands({api,taskId,value,inputRef,onChange,onCommand}) {
  const [catalog,setCatalog]=useState([]),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
  const [selected,setSelected]=useState(0),[dismissed,setDismissed]=useState(null),[position,setPosition]=useState(null);
  const menu=useRef(null),id=useId(),active=/^\/[^\s/]*$/.test(value),visible=active&&dismissed!==value;
  const options=commandOptions(catalog,value),signature=options.map(item=>item.command).join('|');
  useEffect(()=>{setCatalog([]);},[api,taskId]);
  useEffect(()=>{
    if(!visible||!api)return;
    let live=true;setLoading(true);setFailed(false);
    Promise.resolve().then(()=>api('listSkills',{taskId})).then(result=>{if(live)setCatalog(result.skills||[]);}).catch(()=>{if(live)setFailed(true);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[api,taskId,visible]);
  useEffect(()=>{setSelected(0);},[value,signature]);
  useLayoutEffect(()=>{
    if(!visible)return;
    const place=()=>{const field=inputRef.current?.closest('form');if(!field)return;const rect=field.getBoundingClientRect(),width=Math.min(rect.width,window.innerWidth-24);setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),bottom:Math.max(12,window.innerHeight-rect.top+8),width,maxHeight:Math.max(100,Math.min(420,rect.top-20))});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[visible,inputRef]);
  useEffect(()=>{menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});},[selected]);
  function choose(item) {
    if(item.action){onChange({target:{value:''}});onCommand?.(item.action);}
    else {onChange({target:{value:`/${item.command} `}});requestAnimationFrame(()=>inputRef.current?.focus({preventScroll:true}));}
    setDismissed(value);
  }
  function onKeyDown(event) {
    if(!visible||event.nativeEvent?.isComposing||event.keyCode===229)return false;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDismissed(value);return true;}
    if(!options.length)return false;
    if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();setSelected(index=>(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);return true;}
    if((event.key==='Enter'&&!event.shiftKey)||(event.key==='Tab'&&!event.shiftKey)){event.preventDefault();choose(options[selected]||options[0]);return true;}
    return false;
  }
  const popup=visible&&position?createPortal(<div className="nubi-command-menu" style={position}>
    <div ref={menu} id={id} role="listbox" aria-label="명령과 스킬" className="nubi-command-options">
      {options.map((item,index)=><CxButton key={item.command} id={`${id}-${index}`} role="option" title={`${item.title}: ${item.description}`} aria-selected={index===selected} type="button" tabIndex={-1} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(item)} onPointerMove={()=>setSelected(index)}><span className="nubi-command-icon">{item.icon==='terminal'?<TerminalMark size={17}/>:<Icon name={item.icon} size={17}/>}</span><span className="nubi-command-copy"><strong>{item.title}</strong><small>{item.description}</small></span><code>/{item.command}</code></CxButton>)}
      {!options.length&&<p className="nubi-command-empty">{loading?'스킬을 불러오는 중':'일치하는 명령이나 스킬이 없어요.'}</p>}
    </div>
    {failed&&<small className="nubi-command-footnote">스킬을 불러오지 못했어요. 스킬 관리에서 다시 확인해 주세요.</small>}
  </div>,document.body):null;
  return {popup,onKeyDown,inputAttributes:visible?{'aria-controls':id,'aria-expanded':true,'aria-autocomplete':'list','aria-activedescendant':options.length?`${id}-${Math.min(selected,options.length-1)}`:undefined}:{'aria-expanded':false}};
}
