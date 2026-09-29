import React from 'react';
import {ActionButton, CxButton} from '@e2e/cx-design-system';

export function SessionTabs({tasks, ids, selected, disabled = false, onSelect, onClose}) {
  const open = ids.map(id => tasks.find(task => task.id === id)).filter(Boolean);
  if (!open.length) return null;
  return <nav className="nubi-session-tabs" aria-label="열린 대화">
    <h2>열린 대화</h2>
    {open.map(task => <div className="nubi-session-tab" key={task.id} data-active={selected === task.id}>
      <CxButton className="nubi-session-select" aria-current={selected === task.id ? 'page' : undefined} title={task.request} disabled={disabled} onClick={() => onSelect(task.id)}>
        <span className="nubi-session-title">{task.request}</span>
        {['running', 'stopping', 'waiting_input'].includes(task.state) && <span className="nubi-session-state">{task.state === 'waiting_input' ? '답변 대기' : '진행 중'}</span>}
      </CxButton>
      {!['running', 'stopping'].includes(task.state) && <ActionButton action="close" label={`${task.request} 탭 닫기`} title="탭 닫기. 대화 기록은 유지됩니다." disabled={disabled} onClick={() => onClose(task.id)}/>}
    </div>)}
  </nav>;
}
