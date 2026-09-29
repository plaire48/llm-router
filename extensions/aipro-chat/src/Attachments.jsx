import React, {useEffect, useRef, useState} from 'react';
import {ActionButton, CxNotice, DetailPanel, Icon, notifyToast} from '@e2e/cx-design-system';
import {ATTACHMENT_ACCEPT} from '../attachments.js';
import {prepareFiles} from './document-parser.js';
import {readAttachment} from '../attachment-store.js';
import {ERROR_TEXT} from '../core.js';
import {CodeBlock} from './CodeBlock.jsx';
import {CopyButton} from './CopyButton.jsx';
import './attachments.css';

const sizeLabel = bytes => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const extension = file => file.name.split('.').at(-1).toLowerCase();
const isCode = file => file.kind === 'text' && !['txt', 'md', 'mdx', 'log'].includes(extension(file));
const formatLabel = file => extension(file).toUpperCase();
function useFile(id) {
  const [value, setValue] = useState({});
  useEffect(() => {
    let disposed = false, url;
    setValue({});
    readAttachment(id).then(async file => {
      const text = file.kind === 'image' ? null : file.extractedText ?? await file.blob.text();
      if (disposed) return;
      url = URL.createObjectURL(file.blob); setValue({id, file, url, text});
    }).catch(() => {if (!disposed) setValue({id, error: true});});
    return () => {disposed = true; if (url) URL.revokeObjectURL(url);};
  }, [id]);
  return value.id === id ? value : {};
}
function FileItem({file, disabled, onRemove, onOpen}) {
  const media = useFile(file.id);
  return <div className="attachment-chip" data-kind={file.kind}>
    <button type="button" className="attachment-open" aria-label={`${file.name} 미리보기`} title={file.name} aria-haspopup="dialog" onClick={onOpen}>
      <span className="attachment-symbol" aria-hidden="true">{file.kind === 'image' && media.url ? <img src={media.url} alt=""/> : <Icon name={file.kind === 'image' ? 'image' : isCode(file) ? 'code' : 'file'} size={20}/>}</span>
      <span className="attachment-info"><span className="attachment-name">{file.name}</span><span className="attachment-meta"><span>{formatLabel(file)}</span><span>{sizeLabel(file.bytes)}</span></span></span>
    </button>
    {onRemove && <ActionButton action="close" label={`${file.name} 제거`} disabled={disabled} onClick={() => onRemove(file.id)}/>}
  </div>;
}
function FileViewer({file, onClose}) {
  const media = useFile(file.id);
  const download = () => {
    if (!media.url) return;
    const link = document.createElement('a'); link.href = media.url; link.download = file.name;
    document.body.append(link); link.click(); link.remove(); notifyToast('다운로드를 시작했습니다.');
  };
  return <DetailPanel className="deck-dialog attachment-dialog" title={file.name} variant="modal" hideHelp onClose={onClose}
    footer={<div className="attachment-footer"><span className="attachment-facts" title={file.source === 'user-paste' ? '붙여넣은 자료' : undefined}><span>{formatLabel(file)}{file.kind === 'document' ? ' 텍스트' : ''}</span><span>{sizeLabel(file.bytes)}</span></span><div className="attachment-actions">
      {typeof media.text === 'string' && <CopyButton text={media.text} label="내용 복사"/>}<ActionButton action="download" label="첨부 파일 다운로드" disabled={!media.url} onClick={download}/></div></div>}>
    <div className="attachment-viewer-stage" data-kind={file.kind}>
      {media.error ? <CxNotice tone="danger">{ERROR_TEXT.attachment_missing}</CxNotice> : !media.url ? <span role="status" aria-label="첨부 파일 불러오는 중" className="status-spinner"/> : file.kind === 'image'
        ? <img className="attachment-image" src={media.url} alt={file.name}/>
        : isCode(file) ? <CodeBlock showToolbar={false}><code className={`language-${extension(file)}`}>{media.text}</code></CodeBlock>
          : <div className="attachment-document"><pre tabIndex={0} role="region" aria-label={`${file.name} 내용`}>{media.text}</pre></div>}
    </div>
  </DetailPanel>;
}
export function AttachmentList({files = [], disabled, onRemove}) {
  const [selected, setSelected] = useState(null);
  if (!files.length) return null;
  const file = files.find(file => file.id === selected);
  return <><div className="attachment-list" aria-label={onRemove ? '전송할 첨부 파일' : '첨부 파일'}
    onFocusCapture={event => event.target.closest('.attachment-chip')?.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'instant'})}>{files.map(file => <FileItem key={file.id} file={file} disabled={disabled} onRemove={onRemove} onOpen={() => setSelected(file.id)}/>)}</div>
    {file && <FileViewer file={file} onClose={() => setSelected(null)}/>}</>;
}
export function AttachmentPicker({disabled, loading, count, onAdd, onBusy, onError, menuItem = false}) {
  const input = useRef(null), [busy, setBusy] = useState(false);
  async function choose(event) {
    const selected = [...event.target.files]; event.target.value = '';
    if (!selected.length) return;
    setBusy(true); onBusy(true);
    try {
      const files = await prepareFiles(selected, count);
      await onAdd(files);
    } catch (error) {onError(ERROR_TEXT[error.message] || ERROR_TEXT.attachment_storage);}
    finally {setBusy(false); onBusy(false);}
  }
  return <><input className="attachment-input" type="file" ref={input} accept={ATTACHMENT_ACCEPT} multiple tabIndex={-1} aria-label="첨부 파일 선택" onChange={choose}/>
    <ActionButton action="attachment" iconOnly={!menuItem} className={menuItem ? 'composer-add-item' : ''} label="파일 첨부" title="이미지 또는 문서 첨부" busy={busy || loading} disabled={disabled || busy || loading} onClick={() => input.current?.click()}/></>;
}
