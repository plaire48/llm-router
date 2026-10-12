import React from 'react';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';

// A quiet, successful empty result. Loading and failures keep their own UI.
export function GitEmptyState({title='표시할 변경이 없어요'}){
  return <div className="nubi-git-empty-state" role="status"><AgentMark size={96} mood="idle" lively/><strong>{title}</strong></div>;
}
