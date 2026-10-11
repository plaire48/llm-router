import React, {useEffect, useId, useRef, useState} from 'react';
import {ActionButton, DetailPanel, Icon, notifyToast} from '@e2e/cx-design-system';
import {readCapture} from '../capture-store.js';
import {IMAGE_TYPES} from '../image-files.js';
import {QuestionForm} from './QuestionForm.jsx';
import './captures.css';

const sizeLabel = bytes => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const imageLabel = capture => capture.source === 'page-image' ? capture.label || capture.filename : capture.mode === 'page' ? '전체 페이지 캡처' : capture.mode === 'region' ? '화면 일부 캡처' : '브라우저 캡처';
function useCapture(id) {
  const [media, setMedia] = useState({}), [revision, retry] = useState(0);
  useEffect(() => {
    let disposed = false, url;
    setMedia({});
    readCapture(id).then(blob => {
      if (disposed) return;
      if (!IMAGE_TYPES[blob?.type]) throw new Error('missing');
      url = URL.createObjectURL(blob); setMedia({id, url, blob});
    }).catch(() => {if (!disposed) setMedia({id, error: true});});
    return () => {disposed = true; if (url) URL.revokeObjectURL(url);};
  }, [id, revision]);
  return {...(media.id === id ? media : {}), retry: () => retry(value => value + 1), fail: () => setMedia(value => ({...value, id, error: true}))};
}
function DownloadCapture({capture, blob}) {
  const [status, setStatus] = useState('idle');
  const timer = useRef(null), id = useId();
  useEffect(() => () => clearTimeout(timer.current), []);
  function download() {
    if (!blob) return;
    let url, link;
    try {
      url = URL.createObjectURL(blob);
      link = document.createElement('a'); link.href = url; link.download = capture.filename;
      document.body.append(link); link.click();
      const objectURL = url; setTimeout(() => URL.revokeObjectURL(objectURL), 60000); url = null;
      setStatus('started'); notifyToast('다운로드를 시작했습니다.');
      clearTimeout(timer.current); timer.current = setTimeout(() => setStatus('idle'), 2200);
    } catch {
      setStatus('error'); notifyToast('다운로드하지 못했습니다. 다시 눌러주세요.', {error: true});
    } finally {link?.remove(); if (url) URL.revokeObjectURL(url);}
  }
  return <span className="capture-download" data-download-state={status}>
    <ActionButton action="download" label="이미지 다운로드" title={status === 'error' ? '다운로드 다시 시도' : `${capture.format || 'PNG'} 다운로드`}
      disabled={!blob} aria-describedby={status === 'error' ? id : undefined} onClick={download}/>
    {status === 'error' && <span className="capture-error" role="alert" id={id}>다시 눌러주세요.</span>}
  </span>;
}
function MissingCapture({retry}) {
  return <div className="capture-unavailable"><Icon name="image" size={24}/><span>이미지를 불러오지 못했습니다.</span><ActionButton action="refresh" label="이미지 다시 불러오기" onClick={retry}/></div>;
}
function CaptureCard({capture, onOpen, choice, selected, disabled, onChoose, inline}) {
  const media = useCapture(capture.id);
  return <figure className="capture-card" data-image-source={capture.source} data-selected={selected || undefined}>
    {media.error ? <MissingCapture retry={media.retry}/> : <button type="button" className="capture-preview" data-choice={!!choice} aria-label={choice ? `${choice} 선택` : `${imageLabel(capture)} 확대`} aria-haspopup={choice ? undefined : 'dialog'} disabled={!media.url || !!choice && disabled} onClick={choice ? onChoose : onOpen}>
      {media.url ? <img src={media.url} alt={imageLabel(capture)} width={capture.width || undefined} height={capture.height || undefined} onError={media.fail}/> : <span className="status-spinner" role="status" aria-label="이미지 불러오는 중"/>}
    </button>}
    <figcaption className="capture-caption">{!inline && <span className="capture-name" title={imageLabel(capture)}>{choice || imageLabel(capture)}</span>}<DownloadCapture capture={capture} blob={media.blob}/></figcaption>
  </figure>;
}
function CaptureViewer({captures, index, onSelect, onClose}) {
  const capture = captures[index], media = useCapture(capture.id);
  const [actualSize, setActualSize] = useState(false);
  const viewport = useRef(null);
  useEffect(() => {setActualSize(false); viewport.current?.scrollTo(0, 0);}, [capture.id]);
  const date = new Date(capture.capturedAt).toLocaleString('ko-KR', {month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'});
  const original = capture.source === 'page-image';
  return <DetailPanel className="deck-dialog capture-dialog" title={original ? '페이지 이미지' : imageLabel(capture)} variant="modal" hideHelp onClose={onClose}
    footer={<div className="capture-viewer-footer"><span className="capture-facts">{capture.width > 0 && capture.height > 0 && <span>{capture.width} × {capture.height} px</span>}<span>{capture.format || 'PNG'}</span><span>{sizeLabel(capture.bytes)}</span></span><div className="capture-viewer-actions">
      {captures.length > 1 && <><ActionButton action="previousMedia" label={original ? '이전 이미지' : '이전 캡처'} disabled={index === 0} onClick={() => onSelect(index - 1)}/><span className="capture-count">{index + 1} / {captures.length}</span><ActionButton action="nextMedia" label={original ? '다음 이미지' : '다음 캡처'} disabled={index === captures.length - 1} onClick={() => onSelect(index + 1)}/></>}
      <ActionButton action={actualSize ? 'fit' : 'zoomIn'} label={actualSize ? '화면에 맞추기' : '원본 크기로 보기'} aria-pressed={actualSize} disabled={!media.url} onClick={() => setActualSize(value => !value)}/>
      <DownloadCapture key={capture.id} capture={capture} blob={media.blob}/>
    </div></div>}>
    <div className="capture-viewer-stage" data-actual-size={actualSize} data-full-page={capture.mode === 'page' || undefined} ref={viewport} tabIndex={actualSize || capture.mode === 'page' ? 0 : undefined} aria-label={actualSize || capture.mode === 'page' ? '이미지 스크롤 영역' : undefined}>
      {media.error ? <MissingCapture retry={media.retry}/> : media.url ? <img src={media.url} width={capture.width || undefined} height={capture.height || undefined} alt={imageLabel(capture)} onError={media.fail}/> : <span className="status-spinner" role="status" aria-label="이미지 불러오는 중"/>}
    </div>
    <p className="capture-time">{original ? capture.filename : date}</p>
  </DetailPanel>;
}
export function CaptureGallery({captures = [], question, disabled, onChoose, onDraft, inline = false}) {
  const [selected, setSelected] = useState(null);
  const images = captures.filter(capture => ['browser-tab', 'page-image'].includes(capture.source));
  if (!images.length && !question) return null;
  const pending = question && !question.answer;
  const gallery = (choose, blocked) => !!images.length && <div className="capture-gallery" data-inline={inline || undefined} data-choices={!!question?.options.length} aria-label={pending ? '이미지 선택지' : '첨부 이미지'}>{images.map((capture, index) => {
      const optionIndex = question?.options.findIndex(option => option.id === capture.id) ?? -1;
      return <CaptureCard key={capture.id} capture={capture} inline={inline} onOpen={() => setSelected(index)}
        choice={pending && optionIndex >= 0 ? `${optionIndex + 1}. ${question.options[optionIndex].label}` : null}
        selected={question?.answer?.optionId === capture.id} disabled={blocked}
        onChoose={() => choose({optionId: capture.id})}/>;
    })}</div>;
  return <>{question ? <QuestionForm key={question.id} question={question} disabled={disabled} onChoose={onChoose} onDraft={onDraft}>
    {({onChoose: choose, disabled: blocked}) => gallery(choose, blocked)}
  </QuestionForm> : gallery(null, disabled)}
    {selected !== null && images[selected] && <CaptureViewer captures={images} index={selected} onSelect={setSelected} onClose={() => setSelected(null)}/>}
  </>;
}
