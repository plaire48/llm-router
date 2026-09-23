import {questionArgs} from '../../../extensions/aipro-chat/user-question.js';

export const questionProperties={question:{type:'string',maxLength:180},choices:{type:'array',maxItems:4,items:{type:'object',properties:{label:{type:'string',maxLength:80},description:{type:'string',maxLength:160}},required:['label'],additionalProperties:false}},input_mode:{type:'string',enum:['text','long_text']}};
export function officeQuestion(input) {
  // Planner legacy strings remain compatible. New questions use the same
  // grounded-choice/free-text contract as Nubi's existing QuestionForm.
  if(typeof input==='string')return{text:input,options:[],kind:'text',inputMode:input.includes('\n')?'long_text':'text'};
  const parsed=questionArgs(input);if(parsed.refs.length)throw new Error('tool_arguments_invalid');
  return{text:parsed.question,options:parsed.choices.map((c,i)=>({...c,id:'option-'+(i+1)})),kind:parsed.choices.length?'choice':'text',inputMode:parsed.inputMode};
}
