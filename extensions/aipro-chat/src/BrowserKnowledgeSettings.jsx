import React, {useEffect, useRef, useState} from 'react';
import {ActionButton, CxCheckbox, CxNotice, notifyToast} from '@e2e/cx-design-system';
import {DeckConfirmation, DeckDisclosure, DeckGuidance, DeckSectionLabel} from './DeckSurfaces.jsx';
import {MessageBody} from './MessageBody.jsx';
import {exportKnowledge} from '../browser-knowledge.js';

export function BrowserKnowledgeSettings({rpc}) {
  const [data,setData] = useState(null), [busy,setBusy] = useState(false), [error,setError] = useState(''), [confirm,setConfirm] = useState(false);
  const alive = useRef(true), pending = useRef(false), generation = useRef(0);
  async function refresh() {
    const id = ++generation.current;
    try {const next = await rpc('GET_BROWSER_KNOWLEDGE'); if(alive.current && id === generation.current) {setData(next);setError('');}}
    catch {if(alive.current && id === generation.current) setError('위키를 불러오지 못했습니다. 다시 시도해 주세요.');}
  }
  useEffect(() => {
    alive.current=true; void refresh();
    const changed = (changes, area) => {if(area === 'local' && changes.browserKnowledge) void refresh();};
    chrome.storage.onChanged.addListener(changed);
    return () => {alive.current=false; generation.current++; chrome.storage.onChanged.removeListener(changed);};
  }, []);
  async function update(patch) {
    if(pending.current) return;
    pending.current=true;setBusy(true);setError('');
    try {
      const next=await rpc('UPDATE_BROWSER_KNOWLEDGE',patch);
      if(alive.current) {setData(next);setConfirm(false);notifyToast(patch.restore ? '이전 관찰로 되돌렸습니다.' : patch.autoUpdate !== undefined ? next.autoUpdate ? '자동 갱신을 켰습니다.' : '자동 갱신을 껐습니다.' : patch.clear || patch.url ? '위키를 삭제했습니다.' : next.enabled ? '위키 활용을 켰습니다.' : '위키 활용을 껐습니다.');}
    } catch {if(alive.current) setError('저장하지 못했습니다. 다시 시도해 주세요.');}
    finally {pending.current=false;if(alive.current)setBusy(false);}
  }
  function download() {
    const url=URL.createObjectURL(new Blob([exportKnowledge(data)],{type:'text/markdown;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='nubi-browser-knowledge.md';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);notifyToast('다운로드를 시작했습니다.');
  }
  return <>
    <details className="integration-settings browser-knowledge-settings"><summary><DeckSectionLabel icon="list" tone="teal">사이트 위키</DeckSectionLabel></summary>
      <div className="integration-content">
        {data && <>
          <div className="connection-row"><CxCheckbox label="위키 제안과 활용" checked={data.enabled} disabled={busy} onChange={event=>update({enabled:event.target.checked})}/>
            <div className="integration-actions">
              <ActionButton action="download" iconOnly label="위키 Markdown 다운로드" disabled={busy || !data.entries.length} onClick={download}/>
              <ActionButton action="delete" iconOnly label="사이트 위키 모두 삭제" disabled={busy || !data.entries.length} onClick={()=>setConfirm(true)}/>
            </div>
          </div>
          <CxCheckbox label="저장된 위키 자동 갱신" checked={data.autoUpdate} disabled={busy || !data.enabled} onChange={event=>update({autoUpdate:event.target.checked})}/>
          <DeckGuidance icon="refresh" lead={<>확인한 화면 정보를 <strong>승인 없이 갱신</strong>합니다.</>}>업무 규칙은 유지합니다.</DeckGuidance>
          {data.entries.length > 0 && <ul className="browser-knowledge-list">{data.entries.map(item=><li key={`${item.provider}:${item.url}`}>
            <div><DeckDisclosure title={item.title} icon="file">
              <p className="wiki-document-date">화면 확인 {new Date(item.verifiedAt).toLocaleDateString()}</p>
              {item.invalidated || Date.now()-item.verifiedAt>30*24*60*60*1000 ? <p className="wiki-document-state">다시 확인 필요</p> : null}
              {item.autoUpdatedAt && <p className="wiki-document-date">자동 갱신 {new Date(item.autoUpdatedAt).toLocaleDateString()}</p>}
              {item.markdown && (item.markdownNeedsReview || Date.now()-item.reviewedAt>30*24*60*60*1000) && <p className="wiki-document-state">본문은 재확인 전까지 검색에서 제외합니다.</p>}
              {data.procedures?.filter(card=>card.url===item.url && card.provider===item.provider).map(card=><p className="wiki-document-state" key={card.id}>{card.kind==='link_read'?'조회 절차':`입력 절차 ${card.fields}개 항목`} {card.status==='needs_review' ? '재확인 필요' : '연결됨'}</p>)}
              <MessageBody content={item.markdown || '본문이 없습니다. /wiki로 다시 작성하세요.'}/>
              <DeckDisclosure title="화면 정보" icon="list"><ul>
                {item.document.headings.map(name=><li key={`heading:${name}`}>{name}</li>)}
                {item.document.fields.map((field,index)=><li key={`field:${index}`}>{field.name}{field.required ? ' (필수)' : ''}</li>)}
                {item.document.controls.map(name=><li key={`control:${name}`}>{name}</li>)}
              </ul></DeckDisclosure>
              <DeckDisclosure title="출처" icon="link"><p>{item.url}</p></DeckDisclosure>
            </DeckDisclosure></div>
            <div className="integration-actions">
            {item.previousObservation && <ActionButton action="undo" iconOnly label={`${item.title} 자동 갱신 되돌리기`} disabled={busy} onClick={()=>update({restore:true,url:item.url,provider:item.provider,version:item.documentVersion})}/>}
            <ActionButton action="delete" iconOnly label={`${item.title} 문서 삭제`} disabled={busy} onClick={()=>update({url:item.url,provider:item.provider})}/></div>
          </li>)}</ul>}
        </>}
        {error && <CxNotice tone="danger">{error}<ActionButton action="refresh" iconOnly label="사이트 위키 다시 불러오기" onClick={refresh}/></CxNotice>}
      </div>
    </details>
    {confirm && <DeckConfirmation title="사이트 위키 삭제" message="저장한 경로와 화면 문서를 모두 삭제합니다." confirmLabel="삭제" busy={busy} onCancel={()=>setConfirm(false)} onConfirm={()=>update({clear:true})}/>}
  </>;
}
