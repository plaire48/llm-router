import {DeckField} from './DeckSurfaces.jsx';
import React, {useEffect, useRef, useState} from 'react';
import {CxButton,  CxInput, CxTextarea, CxNotice, DetailPanel, ActionButton, Icon, notifyToast} from '@e2e/cx-design-system';
import {skillCreationSource} from '../skill-creator.js';
import {exportSkillArchive, importSkillArchive} from '../skill-archive.js';
import {skillCommand} from '../skill-command.js';
import {importSkill, importSkillFolder} from '../skills.js';
import {skillRecordText} from '../skill-stats.js';

export function SkillPicker(props) {
  return <SkillPickerEditor key={props.data.chat.sessionId} {...props}/>;
}

function SkillPickerEditor({data, action, draftReview, onReviewOpened, menuItem = false}) {
  const [open, setOpen] = useState(false), [editor, setEditorValue] = useState(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const editorDrafts = useRef(new Map()), editorTarget = useRef('new'), editorSource = useRef(null);
  function setEditor(value) {
    setEditorValue(value);
    if (value) {
      if (JSON.stringify(value) === JSON.stringify(editorSource.current)) editorDrafts.current.delete(editorTarget.current);
      else editorDrafts.current.set(editorTarget.current, value);
    }
  }
  function editSkill(skill) {
    editorTarget.current = skill.id || (skill.draftMessageId ? `draft:${skill.draftMessageId}` : 'new');
    editorSource.current = skill;
    setEditorValue(editorDrafts.current.get(editorTarget.current) || skill); setError('');
  }
  function importEditor(skill) {
    if (!editor) {editorTarget.current = 'new'; editorSource.current = null;}
    setEditor({...skill, id: editor?.id, ...(editor?.draftMessageId ? {draftMessageId: editor.draftMessageId} : {})}); setError('');
  }
  useEffect(() => {if (draftReview && !saving) {editSkill({...draftReview.skill, id: draftReview.saved ? draftReview.skill.id : undefined, draftMessageId: draftReview.messageId}); setOpen(true); onReviewOpened();}}, [draftReview, saving]);
  let canCreate = false;
  try {canCreate = !!skillCreationSource(data.chat);} catch { /* No completed browser work yet. */ }
  async function create() {
    setSaving(true); setError('');
    try {if (await action('START_AGENT', {createSkill: true, conversationId: data.chat.sessionId})) setOpen(false); else setError('초안을 만들지 못했습니다. 다시 시도해 주세요.');}
    finally {setSaving(false);}
  }
  const file = useRef(null), folder = useRef(null), selected = data.skills?.find(skill => skill.id === data.activeSkillId);
  const folderButton = <CxButton className="composer-icon" aria-label="스킬 폴더 불러오기" title="스킬 폴더 불러오기" disabled={saving} onClick={() => folder.current?.click()}><Icon name="package" size={20}/></CxButton>;
  async function select(id) {if (saving) return; setSaving(true); try {if (await action('SELECT_SKILL', {id})) setOpen(false); else setError('스킬을 선택하지 못했습니다. 다시 시도해 주세요.');} finally {setSaving(false);}}
  function download(skill) {try {downloadSkill(skill);} catch {setError('내보내지 못했습니다. 스킬 파일 크기를 확인하세요.');}}
  return <>
    <CxButton className={menuItem ? 'composer-add-item' : 'composer-icon'} data-active={!!selected} aria-label="스킬 선택" title={selected ? `스킬: ${selected.name}` : '스킬 선택'} aria-haspopup="dialog" aria-expanded={open} disabled={data.busy || saving} onClick={() => {setEditor(null); setError(''); setOpen(true);}}><Icon name="layers" size={20}/>{menuItem && <><span>스킬 선택</span>{selected && <Icon name="check" size={16}/>}</>}</CxButton>
    {open && <DetailPanel className="deck-dialog" title={editor ? editor.id ? '스킬 편집' : '스킬 등록' : '스킬'} variant="modal" hideHelp busy={saving} onClose={() => {if (!saving) setOpen(false);}}>
      {error && <CxNotice tone="danger">{error}</CxNotice>}
      {editor ? <form className="settings-fields" onSubmit={async event => {
        event.preventDefault(); event.stopPropagation(); if (saving) return; setSaving(true);
        try {
          const share = event.nativeEvent.submitter?.dataset.export === 'zip';
          const skill = {...editor, toolMode:'automatic'};
          const archive = share ? exportSkillArchive(skill) : null;
          if (await action('SAVE_SKILL', {skill, draftMessageId:editor.draftMessageId, conversationId:data.chat.sessionId})) {editorDrafts.current.delete(editorTarget.current); setEditor(null); if (share) downloadSkill(skill, archive); setOpen(false);} else setError('저장하지 못했습니다. 다시 시도해 주세요.');
        } catch {setError('스킬 내용과 파일 크기를 확인해 주세요.');}
        finally {setSaving(false);}
      }}>
        <DeckField icon="tag" label="이름"><CxInput disabled={saving} autoFocus value={editor.name} maxLength={64} required onChange={event => setEditor({...editor, name: event.target.value})}/></DeckField>
        <DeckField icon="automation" label="사용할 때"><CxInput disabled={saving} value={editor.description === '내 스킬' ? '' : editor.description || ''} maxLength={1024} placeholder="예: 고객 문의를 표로 정리한다. 문의 현황을 물을 때 사용" onChange={event => setEditor({...editor, description: event.target.value})}/></DeckField>
        {skillRecordText(data.skillStats?.[editor.id]) && <p className="workspace-mode-note">{skillRecordText(data.skillStats?.[editor.id])}</p>}
        <DeckField icon="taskList" label="지침"><CxTextarea disabled={saving} value={editor.instructions} maxLength={16000} rows={9} required placeholder="할 일과 완료 기준" onChange={event => setEditor({...editor, instructions: event.target.value})}/></DeckField>
        {!!editor.resources?.length && <details className="skill-detail deck-subsection"><summary>참고 자료 {editor.resources.length}개</summary><div className="settings-fields">{editor.resources.map((resource, index) => <DeckField key={resource.path} label={({terms:'용어', inputs:'입력 변수', procedure:'절차', checks:'완료 기준'})[resource.path.match(/^references\/(\w+)\.md$/)?.[1]] || resource.path}><CxTextarea disabled={saving} rows={5} value={resource.content} maxLength={40000} onChange={event => setEditor({...editor, resources: editor.resources.map((item, i) => i === index ? {...item, content: event.target.value} : item)})}/></DeckField>)}</div></details>}
        <div className="skill-editor-actions"><ActionButton action="upload" label="스킬 파일 불러오기" disabled={saving} onClick={() => file.current?.click()}/>{folderButton}<span/><ActionButton action="cancel" label="취소" disabled={saving} onClick={() => setEditor(null)}/><ActionButton action="download" label="저장하고 ZIP 다운로드" type="submit" data-export="zip" disabled={saving}/><ActionButton action="save" iconOnly className="icon-commit" label="저장" type="submit" busy={saving}/></div>
      </form> : <>
        <div className="skill-toolbar"><CxButton disabled={saving || !canCreate} title={canCreate ? "완료한 작업으로 검토할 스킬 초안을 만듭니다." : "브라우저 작업을 완료한 뒤 사용할 수 있습니다."} onClick={create}><Icon name="layers" size={18}/>작업으로 만들기</CxButton><span/>{folderButton}<ActionButton action="upload" label="스킬 불러오기" disabled={saving} onClick={() => file.current?.click()}/><ActionButton action="add" label="스킬 등록" disabled={saving} onClick={() => editSkill({name: '', description: '', instructions: ''})}/></div>
        <div className="skill-list">
          <CxButton className="skill-option" aria-pressed={!selected} title="요청에 맞춰 도구를 선택합니다." disabled={saving} onClick={() => select('')}><Icon name="message" size={20}/><span><strong>자동</strong></span>{!selected && <Icon name="check" size={18}/>}</CxButton>
          {data.skills.map(skill => <div className="skill-row" key={skill.id}><CxButton className="skill-option" aria-pressed={selected?.id === skill.id} title={[`${skill.description} /${skillCommand(skill)}`, skillRecordText(data.skillStats?.[skill.id])].filter(Boolean).join('\n')} disabled={saving} onClick={() => select(skill.id)}>
            <Icon name={skill.id === 'source' || skill.id === 'playwright' ? 'code' : skill.id === 'form' ? 'pencil' : 'layers'} size={20}/><span><strong>{skill.name}</strong></span>{selected?.id === skill.id && <Icon name="check" size={18}/>}</CxButton>
            <ActionButton action="download" label={`${skill.name} 내보내기`} disabled={saving} onClick={() => download(skill)}/>
            {skill.id.startsWith('custom-') && <><ActionButton action="edit" label={`${skill.name} 편집`} disabled={saving} onClick={() => editSkill(skill)}/><ActionButton action="delete" label={`${skill.name} 삭제`} disabled={saving} onClick={() => action('DELETE_SKILL', {id: skill.id})}/></>}
          </div>)}
        </div>
      </>}
      <input ref={file} type="file" accept=".zip,.md,.json,application/zip,text/markdown,application/json,text/plain" hidden disabled={saving} onChange={async event => {
        const source = event.target.files?.[0]; event.target.value = '';
        if (!source || saving) return;
        setSaving(true);
        try {if (source.size > 216000) throw new Error(); const skill = /\.zip$/i.test(source.name) ? await importSkillArchive(new Uint8Array(await source.arrayBuffer())) : importSkill(await source.text(), source.name); importEditor(skill);}
        catch {setError('스킬 ZIP, SKILL.md 또는 JSON을 확인하세요. 최대 200KB까지 가져옵니다.');}
        finally {setSaving(false);}
      }}/>
      <input ref={folder} type="file" webkitdirectory="" multiple hidden disabled={saving} onChange={async event => {
        const files = Array.from(event.target.files || []); event.target.value = '';
        if (!files.length || saving) return;
        setSaving(true);
        try {const skill = await importSkillFolder(files); importEditor(skill);}
        catch {setError('SKILL.md와 references, scripts, assets의 텍스트 파일을 확인하세요. 폴더는 200KB까지 가져올 수 있습니다.');}
        finally {setSaving(false);}
      }}/>
    </DetailPanel>}
  </>;
}

export function FillReview({plan, onResolve}) {
  return <DetailPanel className="deck-dialog fill-review-dialog" title="입력 내용 확인" variant="modal" hideHelp onClose={() => onResolve(false)} footer={<><ActionButton action="cancel" label="취소" onClick={() => onResolve(false)}/><CxButton variant="primary" onClick={() => onResolve(true)}>페이지에 입력</CxButton></>}>
    <p className="fill-page-title">{plan.title}</p>
    <dl className="fill-fields">{plan.fields.map((field, index) => <div className="interaction-editor-field" key={index}><dt>{field.label}</dt><dd>{field.value || '(비우기)'}</dd></div>)}</dl>
  </DetailPanel>;
}

export function SkillCommands({items, onSelect}) {
  if (!items.length) return null;
  return <div id="skill-command-menu" className="skill-command-menu" role="group" aria-label="슬래시 명령" onKeyDown={event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  }}>{items.map(item => <CxButton key={item.shortcut?.id || item.skill.id} className="skill-command-option" onClick={() => onSelect(item)} title={item.shortcut ? '프롬프트를 입력창에 불러옵니다.' : item.skill.description}><Icon name={item.shortcut ? 'save' : 'layers'} size={16}/><span>{item.shortcut?.name || item.skill.name}</span><small>/{item.command}</small></CxButton>)}</div>;
}

function downloadSkill(skill, archive = exportSkillArchive(skill)) {
  const url = URL.createObjectURL(new Blob([archive], {type:'application/zip'}));
  const link = document.createElement('a'); link.href = url; link.download = `${skill.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}.skill.zip`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); notifyToast('다운로드를 시작했습니다.');
}
export function SkillArtifact({draft, onReview, disabled}) {
  const [error, setError] = useState('');
  if (!draft.saved) return <CxButton className="skill-draft-review" disabled={disabled} onClick={onReview}><Icon name="layers" size={18}/>스킬 초안 검토</CxButton>;
  return <><div className="attachment-list"><div className="attachment-chip">
    <button type="button" className="attachment-open" aria-label={`${draft.skill.name} 스킬 보기`} title={draft.skill.name} disabled={disabled} onClick={onReview}>
      <span className="attachment-symbol"><Icon name="package" size={20}/></span><span className="attachment-info"><span className="attachment-name">{draft.skill.name}</span><span className="attachment-meta">ZIP</span></span>
    </button>
    <ActionButton action="download" label={`${draft.skill.name} ZIP 다운로드`} onClick={() => {try {downloadSkill(draft.skill); setError('');} catch {setError('다운로드하지 못했습니다. 스킬을 확인해 주세요.');}}}/>
  </div></div>{error && <CxNotice tone="danger">{error}</CxNotice>}</>;
}
