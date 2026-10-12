import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import React,{useEffect,useLayoutEffect,useRef,useState,useImperativeHandle} from 'react';
import {CxButton, CxInput, Icon} from '@e2e/cx-design-system';
import {BrowserMark,StopMark} from '../ui/marks.jsx';
const hasOpenDialog=()=>[...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some(node=>node.getClientRects().length&&!node.closest('[hidden],[aria-hidden="true"],[inert]'));
export function BrowserPane({api,visible,obscured=false,onError,onState,controller}) {
 const [state,setState]=useState({tabs:[],active:null}),[url,setUrl]=useState(''),[find,setFind]=useState(false),[query,setQuery]=useState('');
 const viewport=useRef(null),addressInput=useRef(null),findInput=useRef(null),editing=useRef(false),errors=useRef(onError),sequence=useRef(0),urlRef=useRef('');errors.current=onError;
 const native=window.nubi.desktop===true,current=state.tabs.find(tab=>tab.id===state.active);
 const update=value=>{setState(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);onState?.(value);const selected=value.tabs.find(tab=>tab.id===value.active);if(!selected){urlRef.current='';editing.current=false;setUrl('');}else if(!editing.current||selected.id!==urlRef.current){urlRef.current=selected.id;setUrl(selected.url==='about:blank'?'':selected.url);}};
 async function action(action,args={}){try{const request=++sequence.current;const value=await api('browser',{action,...args});if(request===sequence.current)update(value);}catch(error){errors.current(error);}}
 useImperativeHandle(controller,()=>({action}),[api]);
 useEffect(()=>window.nubi.onBrowserEvent?.(event=>{if(['opened','changed','closed'].includes(event.type)&&event.state)update(event.state);if(event.type==='focus'){if(event.field==='find')setFind(true);else addressInput.current?.focus();}}),[api]);
 useEffect(()=>{if(find&&visible)findInput.current?.focus();},[find,visible]);
 useEffect(()=>{
  if(!visible||!native)return;
  const key=event=>{
   if(hasOpenDialog())return;
   if(event.key==='Escape'&&find){event.preventDefault();event.stopPropagation();setFind(false);void action('find',{text:''});return;}
   if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
   const value=event.key.toLowerCase();if(!['l','f','r','t','w'].includes(value))return;event.preventDefault();event.stopPropagation();
   if(value==='l')addressInput.current?.focus();else if(value==='f')setFind(true);else void action(({r:'reload',t:'new',w:'close'})[value]);
  };
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[visible,native,find,api]);
 useEffect(()=>{if(!native)return;let alive=true;const request=sequence.current;void api('browser',{action:'status'}).then(value=>{if(alive&&request===sequence.current)update(value);},error=>{if(alive)errors.current(error);});return()=>{alive=false;};},[api,native]);
 useLayoutEffect(()=>{
  if(!native)return;
  const hide=()=>void api('browser',{action:'layout',visible:false}).catch(()=>{});
  // Hidden tabs retain their page/session but do no document-wide layout work.
  if(!visible||obscured||!current||current.url==='about:blank'){hide();return;}
  const node=viewport.current;let last='',frame=0;
  const updateBounds=()=>{
   frame=0;
   if(document.hidden||hasOpenDialog()){if(last!=='hidden'){last='hidden';hide();}return;}
   const rect=node.getBoundingClientRect(),bounds={x:rect.left,y:rect.top,width:rect.width,height:rect.height};
   const show=!!node.getClientRects().length,key=JSON.stringify({bounds,show});
   if(key===last)return;last=key;void api('browser',{action:'layout',bounds,visible:show}).catch(()=>{});
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(updateBounds);};
  const guard=()=>{
   // Native web contents must disappear immediately behind a modal, not after a frame.
   if(document.hidden||hasOpenDialog()){cancelAnimationFrame(frame);frame=0;updateBounds();}
   else schedule();
  };
  updateBounds();const size=new ResizeObserver(schedule);size.observe(node);
  const changes=new MutationObserver(guard);changes.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-modal','role','hidden','aria-hidden','inert']});
  document.addEventListener('visibilitychange',guard);window.addEventListener('resize',schedule);
  return()=>{cancelAnimationFrame(frame);size.disconnect();changes.disconnect();document.removeEventListener('visibilitychange',guard);window.removeEventListener('resize',schedule);hide();};
 },[api,native,visible,obscured,current?.id,current?.url,find]);
 useEffect(()=>{if(!native||!find)return;const timer=setTimeout(()=>void action('find',{text:query}),200);return()=>clearTimeout(timer);},[query,find,native]);
 if(!native)return <section className="desktop-browser-empty" hidden={!visible}><BrowserMark size={30}/><p>Electron 앱에서 인터넷 브라우저를 사용할 수 있어요.</p></section>;
 const menu=(event,kind)=>void action('menu',{kind,x:event.clientX,y:event.clientY});
 return <section className="desktop-browser" hidden={!visible} aria-label="인터넷 브라우저">
  <form className="desktop-browser-toolbar" onSubmit={event=>{event.preventDefault();editing.current=false;void action('navigate',{url});}}><CxButton type="button" aria-label="뒤로" title="뒤로" disabled={!current?.back} onClick={()=>void action('back')}><Icon name="arrowLeft" size={16}/></CxButton><CxButton type="button" aria-label="앞으로" title="앞으로" disabled={!current?.forward} onClick={()=>void action('forward')}><Icon name="arrowRight" size={16}/></CxButton><CxButton type="button" aria-label={current?.loading?'불러오기 중지':'새로고침'} title={current?.loading?'중지':'새로고침'} onClick={()=>void action(current?.loading?'stop':'reload')}>{current?.loading?<StopMark size={16}/>:<Icon name="refresh" size={16}/>}</CxButton><div className="desktop-browser-address"><BrowserMark size={15}/><CxInput ref={addressInput} aria-label="인터넷 주소 또는 검색어" placeholder="주소 또는 검색어 입력" value={url} onFocus={event=>{editing.current=true;event.target.select();}} onBlur={()=>{editing.current=false;}} onChange={event=>setUrl(event.target.value)}/></div><CxButton type="button" aria-label="페이지에서 찾기" title="페이지에서 찾기" aria-pressed={find} onClick={()=>{setFind(value=>!value);if(find)void action('find',{text:''});}}><Icon name="search" size={16}/></CxButton><CxButton type="button" aria-label="다운로드" title="다운로드" onClick={event=>menu(event,'downloads')}><Icon name="download" size={16}/></CxButton><CxButton type="button" aria-label="브라우저 메뉴" title="브라우저 메뉴" onClick={event=>menu(event,'main')}><Icon name="moreHorizontal" size={16}/></CxButton></form>
  {find&&<div className="desktop-browser-find"><CxInput ref={findInput} aria-label="페이지에서 찾을 텍스트" placeholder="페이지에서 찾기" value={query} onChange={event=>setQuery(event.target.value)}/><small>{state.find?`${state.find.active}/${state.find.matches}`:''}</small><CxButton aria-label="이전 검색 결과" title="이전 검색 결과" onClick={()=>void action('find',{text:query,forward:false})}><Icon name="chevronUp" size={14}/></CxButton><CxButton aria-label="다음 검색 결과" title="다음 검색 결과" onClick={()=>void action('find',{text:query})}><Icon name="chevronDown" size={14}/></CxButton></div>}
  {current?.loginCode&&<div className="desktop-browser-login-code"><span>회사 로그인 코드</span><strong>{current.loginCode}</strong><CopyButton label="로그인 코드 복사" resetKey={current.loginCode} onCopy={()=>api('ghesAccount',{operation:'copy'})}/></div>}
  <div ref={viewport} className="desktop-browser-viewport">{(!current||current.url==='about:blank')&&<div className="desktop-browser-empty"><BrowserMark size={32}/><p>어떤 페이지를 열어볼까요?</p></div>}{current?.error&&<p className="desktop-browser-load-error">페이지를 열지 못했어요. 주소를 확인하거나 새로고침해 주세요.</p>}</div>
 </section>;
}
