import React from 'react';
import {QuestionForm} from './QuestionForm.jsx';

export function NativeDialogQuestion({dialog,onAnswer}) {
  const prompt=dialog.type==='prompt';
  const question={id:dialog.id,kind:'choice',options:prompt ? [{id:'accept',label:'빈 값으로 확인'},{id:'cancel',label:'취소'}] : [{id:'accept',label:'확인'},{id:'cancel',label:'취소'}],
    text:`${dialog.site}의 ${prompt?'입력창':'확인창'}: ${dialog.message}`,
    inputPlaceholder:'입력 후 보내면 이 확인창에만 전달됩니다.'};
  return <QuestionForm key={dialog.id} question={question} allowText={prompt} maxLength={4000}
    onChoose={choice=>onAnswer({questionId:dialog.id,requestId:dialog.requestId,conversationId:dialog.conversationId,choice})} onDraft={async()=>{}}/>;
}
