import React, {useRef, useState} from 'react';
import {CxButton, CxField, CxInput, CxTextarea, CxNotice, DetailPanel, ActionButton, Icon} from '@e2e/cx-design-system';
import {importSkill, importSkillFolder, exportSkill} from '../skills.js';

export function SkillPicker({data, action}) {
  const [open, setOpen] = useState(false), [editor, setEditor] = useState(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const file = useRef(null), folder = useRef(null), selected = data.skills?.find(skill => skill.id === data.activeSkillId);
  const folderButton = <CxButton aria-label="스킬 폴더 불러오기" title="스킬 폴더 불러오기" disabled={saving} onClick={() => folder.current?.click()}><Icon name="package" size={20}/></CxButton>;
  async function select(id) {if (saving) return; setSaving(true); try {if (await action('SELECT_SKILL', {id})) setOpen(false); else setError('스킬을 선택하지 못했습니다. 다시 시도해 주세요.');} finally {setSaving(false);}}
  function download(skill) {
    const url = URL.createObjectURL(new Blob([exportSkill(skill)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = `${skill.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}.skill.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <CxButton className="composer-icon" data-active={!!selected} aria-label="스킬 선택" title={selected ? `스킬: ${selected.name}` : '스킬 선택'} aria-haspopup="dialog" aria-expanded={open} disabled={data.busy} onClick={() => {setEditor(null); setError(''); setOpen(true);}}><Icon name="layers" size={20}/></CxButton>
    {open && <DetailPanel className="deck-dialog" title={editor ? editor.id ? '스킬 편집' : '스킬 등록' : '스킬'} variant="modal" hideHelp busy={saving} onClose={() => {if (!saving) setOpen(false);}}>
      {error && <CxNotice tone="danger">{error}</CxNotice>}
      {editor ? <form className="settings-fields" onSubmit={async event => {
        event.preventDefault(); event.stopPropagation(); setSaving(true);
        try {if (await action('SAVE_SKILL', {skill: {...editor, toolMode: 'automatic'}})) setOpen(false); else setError('저장하지 못했습니다. 다시 시도해 주세요.');}
        finally {setSaving(false);}
      }}>
        <CxField label="이름"><CxInput autoFocus value={editor.name} maxLength={64} required onChange={event => setEditor({...editor, name: event.target.value})}/></CxField>
        <CxField label="사용할 때"><CxInput value={editor.description === '내 스킬' ? '' : editor.description || ''} maxLength={1024} placeholder="어떤 요청에 사용할지 적어주세요." onChange={event => setEditor({...editor, description: event.target.value})}/></CxField>
        <CxField label="지침"><CxTextarea value={editor.instructions} maxLength={16000} rows={9} required placeholder="할 일과 답변 방식을 적어주세요." onChange={event => setEditor({...editor, instructions: event.target.value})}/></CxField>
        {!!editor.resources?.length && <details className="skill-detail"><summary>참고 자료 {editor.resources.length}개</summary><ul>{editor.resources.map(resource => <li key={resource.path}>{resource.path}</li>)}</ul><p>필요한 자료만 읽습니다. PC 스크립트는 실행하지 않습니다.</p></details>}
        <div className="skill-editor-actions"><ActionButton action="upload" label="스킬 파일 불러오기" disabled={saving} onClick={() => file.current?.click()}/>{folderButton}<span/><ActionButton action="cancel" label="취소" disabled={saving} onClick={() => setEditor(null)}/><ActionButton action="save" iconOnly className="icon-commit" label="저장" type="submit" busy={saving}/></div>
      </form> : <>
        <div className="skill-toolbar"><span/>{folderButton}<ActionButton action="upload" label="스킬 불러오기" onClick={() => file.current?.click()}/><ActionButton action="add" label="스킬 등록" onClick={() => setEditor({name: '', description: '', instructions: ''})}/></div>
        <div className="skill-list">
          <CxButton className="skill-option" aria-pressed={!selected} title="요청에 맞춰 도구를 선택합니다." disabled={saving} onClick={() => select('')}><Icon name="message" size={20}/><span><strong>자동</strong></span>{!selected && <Icon name="check" size={18}/>}</CxButton>
          {data.skills.map(skill => <div className="skill-row" key={skill.id}><CxButton className="skill-option" aria-pressed={selected?.id === skill.id} title={skill.description} disabled={saving} onClick={() => select(skill.id)}>
            <Icon name={skill.id === 'source' || skill.id === 'playwright' ? 'code' : skill.id === 'form' ? 'pencil' : 'layers'} size={20}/><span><strong>{skill.name}</strong></span>{selected?.id === skill.id && <Icon name="check" size={18}/>}</CxButton>
            <ActionButton action="download" label={`${skill.name} 내보내기`} onClick={() => download(skill)}/>
            {skill.id.startsWith('custom-') && <><ActionButton action="edit" label={`${skill.name} 편집`} onClick={() => setEditor(skill)}/><ActionButton action="delete" label={`${skill.name} 삭제`} onClick={() => action('DELETE_SKILL', {id: skill.id})}/></>}
          </div>)}
        </div>
      </>}
      <input ref={file} type="file" accept=".md,.json,text/markdown,application/json,text/plain" hidden onChange={async event => {
        const source = event.target.files?.[0]; event.target.value = '';
        if (!source) return;
        try {if (source.size > 216000) throw new Error(); const skill = importSkill(await source.text(), source.name); setEditor({...skill, id: editor?.id}); setError('');}
        catch {setError('SKILL.md 또는 스킬 JSON 파일을 선택하세요.');}
      }}/>
      <input ref={folder} type="file" webkitdirectory="" multiple hidden disabled={saving} onChange={async event => {
        const files = Array.from(event.target.files || []); event.target.value = '';
        if (!files.length || saving) return;
        setSaving(true);
        try {const skill = await importSkillFolder(files); setEditor({...skill, id: editor?.id}); setError('');}
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
