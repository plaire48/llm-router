import {pickerWidth} from './picker-width.mjs';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {DriftLabel} from './DriftLabel.jsx';
import {FileKindIcon} from './FileKindIcon.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {useAnchoredModal} from './useAnchoredModal.js';

function Counts({stats}){return stats?.state==='counted'?<span className="nubi-applied-counts"><span>+{stats.added}</span><span>−{stats.removed}</span></span>:null;}
export function AppliedFileChanges({api,taskId,receipts,onOpen}){
  const [open,setOpen]=useState(false),[packet,setPacket]=useState(null),[loading,setLoading]=useState(false),[opening,setOpening]=useState(false);
  const [position,setPosition]=useState(null);
  const trigger=useRef(null),dialog=useRef(null),epoch=useRef(0);
  useAnchoredModal(dialog,trigger,open&&!!position,'.nubi-modal-close');
  const revision=receipts.map(row=>row.id+':'+row.afterHash).join('|'),total=new Set(receipts.map(row=>row.path)).size;
  useEffect(()=>{
    const request=++epoch.current;setPacket(null);setOpen(false);setLoading(false);setOpening(false);
    if(total)void api('appliedFileSummary',{taskId}).then(value=>{if(request===epoch.current)setPacket(value);}).catch(()=>{});
    return()=>{epoch.current++;};
  },[api,taskId,revision]);
  useEffect(()=>()=>{epoch.current++;},[]);
  useLayoutEffect(()=>{
    if(!open){setPosition(null);return;}
    const place=()=>{
      const anchor=trigger.current?.getBoundingClientRect(),menu=dialog.current;if(!anchor||!menu)return;
      const inset=12,gap=8,width=pickerWidth(innerWidth-inset*2),maxHeight=Math.min(320,innerHeight-inset*2),height=Math.min(menu.scrollHeight,maxHeight),above=anchor.top-gap-height;
      const next={width,maxHeight,left:Math.max(inset,Math.min(anchor.left,innerWidth-width-inset)),top:Math.max(inset,Math.min(above>=inset?above:anchor.bottom+gap,innerHeight-height-inset))};
      setPosition(previous=>previous&&Object.keys(next).every(key=>previous[key]===next[key])?previous:next);
    };
    place();const observer=new ResizeObserver(place);
    if(dialog.current)observer.observe(dialog.current);if(trigger.current)observer.observe(trigger.current);
    window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);};
  },[open]);
  if(!total)return null;
  const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
  async function show(){
    if(open){close();return;}
    setOpen(true);setLoading(true);const request=++epoch.current;
    try{const value=await api('appliedFileSummary',{taskId});if(request===epoch.current)setPacket(value);}
    catch{if(request===epoch.current){close();notifyWorkspaceToast('반영한 파일을 확인하지 못했어요. 다시 눌러 주세요.',{error:true});}}
    finally{if(request===epoch.current)setLoading(false);}
  }
  return <div className="nubi-applied-files">
    <CxButton ref={trigger} className="nubi-applied-trigger" aria-label="변경한 파일 보기" aria-haspopup="dialog" aria-expanded={open} onClick={show}><Icon name="file" size={14}/><span>{total}개 파일 변경됨</span>{packet?.totals&&<Counts stats={{state:'counted',...packet.totals}}/>}</CxButton>
    {open&&createPortal(<div ref={dialog} className="nubi-applied-menu" style={{...position,visibility:position?'visible':'hidden'}} role="dialog" aria-modal="true" aria-label="변경한 파일" onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!opening)close();return;}
    }}>
      <header><strong>변경한 파일</strong><CxButton className="nubi-modal-close" aria-label="반영 파일 창 닫기" title="닫기" disabled={opening} onClick={close}><Icon name="xClose" size={18}/></CxButton></header>
      {loading?<p role="status"><span className="status-spinner"/>파일 확인 중</p>:<div className="nubi-applied-list">{packet?.files.map(row=><CxButton key={row.path} className="nubi-applied-row" disabled={opening} title={row.path} onClick={async()=>{
        const request=epoch.current,canPresent=()=>request===epoch.current;setOpening(true);try{await onOpen(row,{canPresent});if(canPresent())close();}catch{if(canPresent())notifyWorkspaceToast('파일이 바뀌었거나 열 수 없어요. 현재 파일을 다시 확인해 주세요.',{error:true});}finally{if(canPresent())setOpening(false);}
      }}><FileKindIcon name={row.path}/><DriftLabel>{row.path}</DriftLabel><Counts stats={row.stats}/>{row.partial?<small>최근 반영</small>:row.state!=='verified'||row.stats.state!=='counted'?<small>확인 필요</small>:null}</CxButton>)}</div>}
      {packet?.truncated&&<small>먼저 100개 파일을 표시해요.</small>}
    </div>,document.body)}
  </div>;
}
