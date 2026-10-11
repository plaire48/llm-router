import React,{useRef,useState} from 'react';
import {CxButton,CxInput,CxNotice,Icon} from '@e2e/cx-design-system';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';

const messages={voc_invalid:'VOC JSON 형식을 확인해 주세요. 파일은 1MB까지 가져올 수 있어요.',voc_changed:'저장된 자료가 바뀌었어요. 원본을 확인해 주세요.',voc_scope:'VOC 저장 폴더를 확인해 주세요.',voc_busy:'자료를 확인하고 있어요. 잠시 후 다시 시도해 주세요.',agent_busy:'진행 중인 분석을 마친 뒤 가져와 주세요.'};
export function VocLibrary({api,openPath,onError,onNotice}){
  const input=useRef(null),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[result,setResult]=useState(null),[readError,setReadError]=useState('');
  const lock=useRef(false);
  const mounted=useRef(true);React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function run(fn){if(lock.current)return;lock.current=true;setBusy(true);try{await fn();}catch(e){if(mounted.current)onError(messages[e.message]||'VOC 자료를 확인하지 못했어요.');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
  async function search(value=query){try{const next=await api('queryVoc',{query:value});if(mounted.current){setResult(next);setReadError('');}}catch{if(mounted.current)setReadError('자료 목록을 읽지 못했어요. 검색을 다시 시도해 주세요.');}}
  async function upload(file){if(!file)return;await run(async()=>{
    if(file.size>1024*1024)throw Error('voc_invalid');
    const saved=await api('importVoc',{json:await file.text()});
    if(!mounted.current)return;
    onNotice(saved.noChange?'이미 보관한 자료예요.':'VOC 자료를 보관했어요.');
    setQuery('');await search('');
  });}
  return <DeckDisclosure title="VOC 자료">
    <p className="nubi-muted">VOC JSON을 작업 공간의 voc 폴더에 보관합니다.</p>
    <form className="nubi-inline" onSubmit={e=>{e.preventDefault();run(()=>search());}}>
      <CxInput aria-label="VOC 검색" placeholder="티켓이나 처리 내용 검색" value={query} onChange={e=>setQuery(e.target.value)}/>
      <CxButton className="nubi-icon-button" type="submit" aria-label="VOC 검색 실행" title="검색" disabled={busy}><Icon name="search" size={18}/></CxButton>
      <CxButton className="nubi-icon-button" type="button" aria-label="VOC 자료 가져오기" title="JSON 가져오기" disabled={busy} onClick={()=>input.current?.click()}><Icon name="upload" size={18}/></CxButton>
      <input ref={input} hidden type="file" accept=".json,application/json" aria-label="VOC JSON 파일" onChange={e=>{const file=e.target.files?.[0];e.target.value='';void upload(file);}}/>
    </form>
    {readError&&<CxNotice tone="danger">{readError}</CxNotice>}
    {result?.results.map(row=><CxButton key={row.id} className="nubi-search-result nubi-voc-result" onClick={()=>run(()=>openPath(row.path))}><Icon name="message" size={16}/><strong>{row.key} {row.title}</strong><span>{row.excerpt}</span></CxButton>)}
    {result&&!result.results.length&&<p className="nubi-muted">일치하는 자료가 없어요.</p>}
    {(result?.unavailable>0||result?.omitted>0||result?.hasMore)&&<p className="nubi-muted">일부 자료만 표시합니다. 검색어를 좁히거나 원본을 확인해 주세요.</p>}
  </DeckDisclosure>;
}
