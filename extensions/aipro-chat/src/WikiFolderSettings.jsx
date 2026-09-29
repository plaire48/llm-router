import React, {useEffect, useRef, useState} from 'react';
import {ActionButton, CxNotice, Icon, notifyToast} from '@e2e/cx-design-system';
import {ERROR_TEXT} from '../core.js';
import {loadWikiFolder, stageWikiFolder, discardWikiFolderStage} from '../wiki-folder.js';
import {DeckSectionLabel} from './DeckSurfaces.jsx';

const folderError = cause => ({project_permission: '폴더 접근을 허용해 주세요.',
  project_not_found: '폴더를 찾지 못했습니다. 다시 선택해 주세요.',
  project_unavailable: '폴더를 열지 못했습니다. 다시 선택해 주세요.'}[cause.message]) || ERROR_TEXT[cause.message] || '폴더를 열지 못했습니다. 접근 권한을 확인해 주세요.';

export function WikiFolderSettings({folder, statusError, serverProject, rpc, clientId, disabled, initialOpen, initialServerOpen, onBusy, onChanged, onServerOpen}) {
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [needsTab, setNeedsTab] = useState(false);
  const [loading, setLoading] = useState(true);
  const stored = useRef(null), alive = useRef(true), pending = useRef(false), loadVersion = useRef(0);
  useEffect(() => {
    alive.current = true; setLoading(true); const version = ++loadVersion.current;
    loadWikiFolder().then(record => {if (alive.current && loadVersion.current === version) stored.current = record;})
      .catch(() => {if (alive.current && loadVersion.current === version) stored.current = null;})
      .finally(() => {if (alive.current && loadVersion.current === version) setLoading(false);});
    return () => {alive.current = false;};
  }, [folder?.id, folder?.status]);

  async function selectFolder() {
    if (pending.current || disabled) return;
    let stage;
    try {
      // Keep the native picker on this click's transient user activation.
      if (typeof window.showDirectoryPicker !== 'function') {setNeedsTab(true); setError(''); return;}
      const picked = window.showDirectoryPicker({id: 'nubi-openwiki', mode: 'read'});
      pending.current = true; setBusy('select'); onBusy(true); setError('');
      const handle = await picked;
      if (!alive.current) return;
      stage = await stageWikiFolder(handle, {clientId});
      if (!alive.current) return;
      await rpc('WIKI_FOLDER_COMMIT', {stageId: stage.stageId});
      stage = null;
      stored.current = await loadWikiFolder().catch(() => null);
      if (!alive.current) return;
      await onChanged(); setNeedsTab(false);
      notifyToast('폴더를 연결했습니다.');
    } catch (cause) {
      if (alive.current && cause.name !== 'AbortError') {
        if (['SecurityError', 'NotSupportedError'].includes(cause.name)) {setNeedsTab(true); setError('');}
        else setError(folderError(cause));
      }
    } finally {
      if (stage) await discardWikiFolderStage(stage.stageId, {clientId}).catch(() => {});
      pending.current = false; if (alive.current) setBusy(''); onBusy(false);
    }
  }

  async function allowFolder() {
    if (pending.current || disabled || loading) return;
    try {
      const handle = stored.current?.handle;
      if (!handle || typeof handle.requestPermission !== 'function') {setError('폴더를 다시 선택해 주세요.'); return;}
      // The handle is preloaded; awaiting IndexedDB here would lose the gesture.
      const permission = handle.requestPermission({mode: 'read'});
      pending.current = true; setBusy('allow'); onBusy(true); setError('');
      if (await permission !== 'granted') {setError('폴더 접근을 허용해 주세요.'); return;}
      await rpc('WIKI_FOLDER_STATUS'); await onChanged();
      if (alive.current) {setNeedsTab(false); notifyToast('폴더 접근을 허용했습니다.');}
    } catch (cause) {
      if (alive.current) {
        if (['SecurityError', 'NotSupportedError'].includes(cause.name)) {setNeedsTab(true); setError('');}
        else setError(folderError(cause));
      }
    } finally {pending.current = false; if (alive.current) setBusy(''); onBusy(false);}
  }

  async function clearFolder() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy('clear'); onBusy(true); setError('');
    try {
      await rpc('WIKI_FOLDER_CLEAR'); stored.current = null;
      await onChanged(); if (alive.current) {setNeedsTab(false); notifyToast('폴더 연결을 해제했습니다.');}
    } catch (cause) {if (alive.current) setError(folderError(cause));}
    finally {pending.current = false; if (alive.current) setBusy(''); onBusy(false);}
  }

  async function openInTab() {
    try {await rpc('OPEN_TAB', {hash: '#settings-wiki'});}
    catch (cause) {setError(folderError(cause));}
  }
  const blocked = disabled || !!busy;
  const displayedError = error || (statusError ? folderError({message: statusError}) : '');
  return <details className="wiki-folder-settings" open={initialOpen || undefined}>
    <summary><DeckSectionLabel icon="file" tone="violet">OpenWiki 폴더</DeckSectionLabel></summary>
    <div className="wiki-folder-content">
      <div className="wiki-folder-row">
        <Icon name="file" size={20}/>
        <span className="wiki-folder-name" title={folder?.name || ''}>{folder?.name || '폴더 선택'}</span>
        <div className="wiki-folder-actions">
          {folder?.status === 'permission_required' && <ActionButton action="login" iconOnly className="icon-commit" label="OpenWiki 폴더 접근 허용" title="폴더 접근 허용" busy={busy === 'allow'} disabled={blocked || loading} onClick={allowFolder}/>}
          <ActionButton action={folder ? 'edit' : 'add'} iconOnly className={folder ? undefined : 'icon-commit'} label={folder ? 'OpenWiki 폴더 변경' : 'OpenWiki 폴더 선택'} title={folder ? '폴더 변경' : 'OpenWiki 폴더 선택'} busy={busy === 'select'} disabled={blocked} onClick={selectFolder}/>
          {folder && <ActionButton action="close" label="OpenWiki 폴더 연결 해제" title="폴더 연결 해제" busy={busy === 'clear'} disabled={blocked} onClick={clearFolder}/>}
        </div>
      </div>
      <p className="wiki-folder-disclosure">필요한 문서 발췌를 선택한 모델에 전달합니다.</p>
      {folder?.status === 'permission_required' && !displayedError && <CxNotice tone="info">폴더 접근을 다시 허용해 주세요.</CxNotice>}
      {displayedError && <CxNotice tone="danger">{displayedError}</CxNotice>}
      {needsTab && <div className="wiki-folder-fallback"><span>전체 화면에서 폴더를 선택해 주세요.</span><ActionButton action="openExternal" label="전체 화면에서 폴더 선택" title="전체 화면에서 폴더 선택" disabled={blocked} onClick={openInTab}/></div>}
      <details className="wiki-server-settings deck-subsection" open={initialServerOpen || undefined}><summary>서버 연결</summary><div className="wiki-folder-row"><span className="wiki-folder-name">{serverProject?.name || 'OpenWiki 서버'}</span><ActionButton action="login" iconOnly label="프로젝트 연결" title="OpenWiki 서버 연결" disabled={blocked} onClick={onServerOpen}/></div></details>
    </div>
  </details>;
}
