import React,{createContext,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Tree} from 'react-arborist';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {FolderMark} from '../ui/marks.jsx';
import {DriftLabel} from '../ui/DriftLabel.jsx';
import {FileKindIcon} from '../ui/FileKindIcon.jsx';
export {FileKindIcon} from '../ui/FileKindIcon.jsx';
const ExplorerActions=createContext(null);
function FileRow({node,attrs,innerRef,children}) {
 const actions=useContext(ExplorerActions);
 return <div {...attrs} ref={innerRef} aria-label={node.data.name} style={{...attrs.style,minWidth:0}} onFocus={event=>event.stopPropagation()} onClick={event=>{if(event.detail>1)return;node.select();if(node.isInternal)node.toggle();}} onDoubleClick={event=>{event.stopPropagation();if(node.isLeaf)actions.open(node.data.path);}}>{children}</div>;
}
function FileNode({node,style}) {
 const item=node.data,actions=useContext(ExplorerActions);
 return <div style={style} className="desktop-explorer-row" data-selected={node.isSelected} title={item.path}>
  <span className="desktop-tree-chevron" aria-hidden="true">{item.directory&&<Icon name={node.isOpen?'chevronDown':'chevronRight'} size={12}/>}</span>
  <FileKindIcon name={item.name} directory={item.directory}/><DriftLabel>{item.name}</DriftLabel>{actions.loading.has(item.path)?<span className="status-spinner" aria-label="폴더 불러오는 중"/>:!item.directory&&item.extension?<small aria-hidden="true">{item.extension}</small>:null}
 </div>;
}
function hierarchy(rows,cache){return rows.map(item=>item.directory?{...item,children:hierarchy(cache.get(item.path)?.entries||[],cache)}:item);}
function includesName(rows,term){return rows.some(item=>item.name.toLowerCase().includes(term)||item.children&&includesName(item.children,term));}
export function FileExplorer({api,project,taskId,selected,revealRequest,cwd='',onDirectory,onOpen,onError,visible=true}) {
 const [location,setLocation]=useState(null),[input,setInput]=useState(''),[filter,setFilter]=useState(''),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[loading,setLoading]=useState(new Set());
 const [size,setSize]=useState({width:320,height:220});const list=useRef(null),tree=useRef(null),cache=useRef(new Map()),pending=useRef(new Map()),alive=useRef(true),navigation=useRef(0),reveal=useRef(null),revealed=useRef(null),selection=useRef(selected),errors=useRef(onError);errors.current=onError;selection.current=selected;
 useEffect(()=>()=>{alive.current=false;navigation.current++;},[]);
 useLayoutEffect(()=>{const node=list.current;if(!node)return;const update=()=>{const rect=node.getBoundingClientRect();if(rect.width&&rect.height)setSize({width:Math.floor(rect.width),height:Math.floor(rect.height)});};update();const observer=new ResizeObserver(update);observer.observe(node);return()=>observer.disconnect();},[]);
 async function load(path,force=false){
  if(!force&&cache.current.has(path))return cache.current.get(path);
  if(pending.current.has(path)){const value=await pending.current.get(path);return force?load(path,true):value;}
  if(alive.current)setLoading(current=>new Set(current).add(path));
  const request=api('browseDirectory',{projectId:project.projectId,path,taskId}).then(value=>{if(alive.current){cache.current.set(value.relative,value);setRevision(current=>current+1);}return value;}).finally(()=>{pending.current.delete(path);if(alive.current)setLoading(current=>{const next=new Set(current);next.delete(path);return next;});});
  pending.current.set(path,request);return request;
 }
 useEffect(()=>{if(!visible||!project)return;const request=++navigation.current;setBusy(true);load(cwd).then(value=>{if(alive.current&&request===navigation.current){setLocation(value);setInput(value.absolute);}}).catch(error=>{if(alive.current&&request===navigation.current)errors.current(error);}).finally(()=>{if(alive.current&&request===navigation.current)setBusy(false);});},[api,project?.projectId,cwd,visible]);
 useEffect(()=>{if(!visible||!selected||!location)return;let cancelled=false;
  const base=location.relative;if(base&&!selected.startsWith(base+'/'))return;
  const parts=selected.split('/').slice(0,-1),start=base?base.split('/').length:0;
  const explicit=revealRequest?.path===selected&&revealRequest.id!==revealed.current;
  if(explicit)setFilter('');
  void (async()=>{const parents=[];if(explicit){await load(base,true);if(cancelled||!alive.current)return;}for(let index=start;index<parts.length;index++){const path=parts.slice(0,index+1).join('/');parents.push(path);await load(path,explicit);if(cancelled||!alive.current)return;}reveal.current={parents,path:selected,scroll:true};if(explicit)revealed.current=revealRequest.id;setRevision(current=>current+1);})().catch(error=>{if(!cancelled&&alive.current)errors.current(error);});
  return()=>{cancelled=true;};
 },[selected,location?.relative,visible,revealRequest?.id]);
 const data=useMemo(()=>hierarchy(location?cache.current.get(location.relative)?.entries||[]:[],cache.current),[location,revision]);
 useLayoutEffect(()=>{const request=reveal.current,instance=tree.current;if(!request||!instance)return;for(const path of request.parents)instance.open(path);if(request.scroll){request.scroll=false;void instance.scrollTo(request.path,'smart').then(()=>{if(alive.current&&reveal.current===request&&selection.current===request.path)instance.select(request.path,{focus:false,align:'smart'});});}},[data]);
 async function navigate(value){const request=++navigation.current;setBusy(true);try{const result=await load(value);if(!alive.current||request!==navigation.current)return;onDirectory(result.relative);setLocation(result);setInput(result.absolute);setFilter('');reveal.current=null;}catch(error){if(alive.current&&request===navigation.current)errors.current(error);}finally{if(alive.current&&request===navigation.current)setBusy(false);}}
 async function refresh(){if(!location||busy)return;setBusy(true);try{await load(location.relative,true);for(const path of cache.current.keys()){if(path!==location.relative&&tree.current?.isOpen(path))await load(path,true);}}catch(error){if(alive.current)errors.current(error);}finally{if(alive.current)setBusy(false);}}
 function activateOnEnter(event){
  if(event.key!=='Enter'||!(event.target instanceof Element)||!event.target.closest('[role="tree"]'))return;
  const node=tree.current?.focusedNode;if(!node)return;
  event.preventDefault();event.stopPropagation();
  if(node.isInternal)node.toggle();else onOpen(node.data.path);
 }
 const parts=(location?.relative||'').split('/').filter(Boolean),actions={open:onOpen,loading};
 const matches=filter.trim()&&!includesName(data,filter.trim().toLowerCase());
 return <section className="desktop-explorer" aria-label="파일 탐색기">
  <form className="desktop-path-bar" onSubmit={event=>{event.preventDefault();void navigate(input);}}><FolderMark size={16}/><CxInput aria-label="폴더 경로" title={location?.absolute} value={input} onChange={event=>setInput(event.target.value)}/>{parts.length>0&&<CxButton type="button" aria-label="상위 폴더" title="상위 폴더" disabled={busy} onClick={()=>void navigate(parts.slice(0,-1).join('/'))}><Icon name="arrowUp" size={14}/></CxButton>}<CxButton type="button" aria-label="파일 목록 새로고침" title="파일 목록 새로고침" disabled={busy} onClick={()=>void refresh()}><Icon name="refresh" size={14}/></CxButton></form>
  <div className="desktop-explorer-filter"><Icon name="search" size={14}/><CxInput aria-label="파일 이름 필터" placeholder="파일 필터링…" value={filter} onChange={event=>setFilter(event.target.value)}/></div>
  <div ref={list} className="desktop-explorer-list" aria-busy={busy} onKeyDownCapture={activateOnEnter}>
   <ExplorerActions.Provider value={actions}><Tree ref={tree} data={data} width={size.width} height={size.height} rowHeight={30} indent={14} disableDrag disableDrop disableEdit disableMultiSelection openByDefault={false} selection={selected} searchTerm={filter} searchMatch={(node,term)=>node.data.name.toLowerCase().includes(term.toLowerCase())} renderRow={FileRow} onToggle={id=>{if(tree.current?.isOpen(id))void load(id).catch(error=>{if(alive.current)errors.current(error);});}} onActivate={node=>{if(node.isInternal)node.toggle();else actions.open(node.data.path);}} aria-label="폴더의 파일 목록">{FileNode}</Tree></ExplorerActions.Provider>
   {!busy&&location&&!data.length&&<p className="desktop-empty">이 폴더는 비어 있어요.</p>}
   {matches&&<p className="desktop-empty">불러온 폴더에 일치하는 파일이 없어요.</p>}
  </div>{[...cache.current.values()].some(value=>value.truncated)&&<p className="desktop-hint">일부 폴더는 처음 2,000개 항목만 표시해요.</p>}
 </section>;
}
