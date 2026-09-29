import React, {useId, useRef, useState} from 'react';
import {ActionButton,CxButton,CxField,CxInput,CxTextarea,CxNotice,DetailPanel,Icon,notifyToast} from '@e2e/cx-design-system';
import {exportKnowledge} from '../browser-knowledge.js';
import {zipSync,strToU8} from 'fflate';

export function downloadWiki(wiki, candidate) {
  const markdown=exportKnowledge({entries:[{...candidate,title:wiki.title,markdown:wiki.markdown}]});
  const archive=zipSync({'README.md':strToU8('# 누비 사이트 위키\n\nsite.md를 연결된 OpenWiki 문서 폴더에 추가하세요. 원본 사이트를 다시 확인한 뒤 활용하세요.\n'),'site.md':strToU8(markdown)});
  const url=URL.createObjectURL(new Blob([archive],{type:'application/zip'})), link=documentNode();
  link.href=url;link.download='nubi-site-wiki.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notifyToast('다운로드를 시작했습니다.');
}
const documentNode=()=>document.createElement('a');

export function BrowserWiki(props) {
  return <BrowserWikiEditor key={JSON.stringify([props.conversationId, props.message.id])} {...props}/>;
}

function BrowserWikiEditor({message,conversationId,action,disabled}) {
  const formId=useId();
  const [open,setOpen]=useState(false), [draft,setDraft]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const pending=useRef(false), draftSource=useRef(null), offer=message.wikiOffer, saved=message.wikiDraft;
  const dirty=draft && (draft.title!==draftSource.current?.title || draft.markdown!==draftSource.current?.markdown);
  async function perform(type,params) {
    if(pending.current)return false;pending.current=true;setBusy(true);setError('');
    try {const ok=await action(type,{...params,conversationId});if(!ok)setError('처리하지 못했습니다. 다시 시도해 주세요.');return ok;}
    finally {pending.current=false;setBusy(false);}
  }
  if (saved) return <>
    <div className="attachment-list"><div className="attachment-chip">
      <CxButton className="attachment-open" disabled={disabled || busy} onClick={()=>{if(!dirty){draftSource.current=saved;setDraft({...saved});}setError('');setOpen(true);}} aria-label="사이트 위키 검토">
        <span className="attachment-symbol"><Icon name="file" size={20}/></span><span className="attachment-info"><span className="attachment-name">{saved.title}</span><span className="attachment-state">{saved.saved ? '저장됨' : '검토할 초안'}</span></span>
      </CxButton>
      {saved.saved && <ActionButton action="download" iconOnly label="사이트 위키 ZIP 다운로드" onClick={()=>downloadWiki(saved,message.creationSource.candidate)}/>}
    </div></div>
    {open && <DetailPanel className="deck-dialog" title="사이트 위키" variant="modal" hideHelp busy={busy} onClose={()=>{if(!busy)setOpen(false);}}
      footer={<ActionButton action="save" iconOnly className="icon-commit" label="위키 저장" type="submit" form={formId} busy={busy}/> }>
      <form id={formId} className="settings-fields" onSubmit={async event=>{event.preventDefault();if(await perform('SAVE_BROWSER_WIKI',{messageId:message.id,document:{title:draft.title,markdown:draft.markdown}})){notifyToast('위키를 저장했습니다.');setDraft(null);setOpen(false);}}}>
        <p className="reply-note">업무 기준과 개인정보를 확인한 뒤 저장하세요.</p>
        <CxField label="문서 이름"><CxInput disabled={busy} autoFocus required maxLength={100} value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></CxField>
        <CxField label="내용"><CxTextarea disabled={busy} required rows={12} maxLength={16000} value={draft.markdown} onChange={event=>setDraft({...draft,markdown:event.target.value})}/></CxField>
        {error && <CxNotice tone="danger">{error}</CxNotice>}
      </form>
    </DetailPanel>}
  </>;
  if (!offer || offer.status!=='offered') return null;
  return <section className="wiki-offer deck-subsection" aria-label="사이트 위키 만들기">
    <strong>위키에 남길까요?</strong><p className="reply-note">다음 작업에 쓸 화면 안내를 만듭니다.</p>
    <div className="wiki-offer-actions"><CxButton disabled={disabled || busy} busy={busy} onClick={()=>perform('START_AGENT',{createWiki:message.id})}><Icon name="file" size={16}/>초안 만들기</CxButton><CxButton disabled={disabled || busy} onClick={()=>perform('DISMISS_BROWSER_WIKI',{messageId:message.id})}>이번에는 건너뛰기</CxButton></div>
    {error && <CxNotice tone="danger">{error}</CxNotice>}
  </section>;
}
