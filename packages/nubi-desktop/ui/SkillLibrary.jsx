import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxNotice,ActionButton} from '@e2e/cx-design-system';

export const skillRegistrationErrors={skill_catalog_full:'스킬 목록의 조회 한도에 도달했어요. 사용하지 않는 스킬 폴더를 정리한 뒤 다시 등록해 주세요.',skill_entry_required:'SKILL.md가 하나 들어 있는 스킬 폴더나 ZIP을 선택해 주세요.',skill_invalid:'SKILL.md의 name과 description을 확인해 주세요.',skill_limit:'SKILL.md는 32KB까지 등록할 수 있어요.',skill_archive_invalid:'ZIP을 읽지 못했어요. 손상되거나 암호화된 파일인지 확인해 주세요.',skill_import_limit:'스킬은 파일당 10MB, 전체 20MB, 폴더를 포함해 1000개 항목까지 등록할 수 있어요.',skill_import_path:'심볼릭 링크, 비밀 설정 파일 또는 Windows에서 사용할 수 없는 경로가 있어요.',skill_import_duplicate:'대소문자만 다르거나 중복된 파일 경로가 있어요.',skill_import_changed:'파일이 바뀌어 등록을 확인하지 못했어요. 목록과 원본을 확인해 주세요.',skill_exists:'같은 이름의 스킬이 있어요. 기존 스킬을 열어 수정하거나 새 이름으로 등록해 주세요.',agent_busy:'진행 중인 작업을 마친 뒤 등록해 주세요.'};
export function SkillLibrary({api,taskId,openPath,onRegister,registrationError}) {
  const [catalog,setCatalog]=useState(null),[error,setError]=useState('');
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[]);
  async function load(){try{const result=await api('listSkills',{taskId});if(mounted.current)setCatalog(result);}catch{if(mounted.current)setError('스킬 목록을 불러오지 못했어요. 다시 확인해 주세요.');}}
  return <section className="nubi-skill-library" aria-label="등록한 스킬">
    <p><strong>등록한 스킬을 요청에 맞춰 사용합니다.</strong></p>
    <div className="nubi-inline">
      <CxButton onClick={()=>onRegister('zip')}>ZIP 등록</CxButton>
      <CxButton onClick={()=>onRegister('folder')}>폴더 등록</CxButton>
      <ActionButton action="refresh" label="목록 새로고침" onClick={()=>{setError('');void load();}}/>
    </div>
    <p className="nubi-muted">SKILL.md와 하위 자료를 현재 작업 공간에 함께 저장합니다.</p>
    {(registrationError||error)&&<CxNotice tone="danger">{registrationError||error}</CxNotice>}
    {catalog?.skills.map(skill=><article className="nubi-skill-card" key={skill.path}>
      <strong>{skill.name}</strong><p>{skill.description}</p>
      <ActionButton action="edit" label="지침 열기" title={`${skill.name} 지침 열기`} onClick={async()=>{try{await openPath(skill.path);}catch{setError('스킬 파일을 열지 못했어요. 목록을 새로고침해 주세요.');}}}/>
      <small>{skill.path}</small>
    </article>)}
    {catalog&&!catalog.skills.length&&<p className="nubi-muted">등록한 스킬이 없어요.</p>}
    {catalog?.issues.length>0&&<details className="deck-subsection"><summary>확인이 필요한 스킬 {catalog.issues.length}개</summary>{catalog.issues.map(issue=><p className="nubi-muted" key={issue.path}><strong>{issue.path}</strong><br/>{skillRegistrationErrors[issue.error]||'스킬 파일과 폴더 접근 권한을 확인해 주세요.'}</p>)}</details>}
    {catalog?.truncated&&<p className="nubi-muted">스킬이 많아 일부만 조회했어요. 사용하지 않는 스킬 폴더를 정리해 주세요.</p>}
  </section>;
}
