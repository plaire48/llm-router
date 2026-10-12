import React,{useState} from 'react';
import {QuestionForm} from '../../../extensions/aipro-chat/src/QuestionForm.jsx';
import {DecisionPrompt} from './DecisionPrompt.jsx';

export function QuestionDecision({question,disabled,blocked,onChoose,onDraft}){
 const [answering,setAnswering]=useState(false);
 return <DecisionPrompt id={question.id} title="확인이 필요해요" summary={question.text} label="답변하기" blocked={blocked||disabled||answering}>
  <QuestionForm question={question} disabled={disabled} onDraft={onDraft} onChoose={async choice=>{setAnswering(true);try{return await onChoose(choice);}finally{setAnswering(false);}}}/>
 </DecisionPrompt>;
}
