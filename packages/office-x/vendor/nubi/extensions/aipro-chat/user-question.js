export const QUESTION_TEXT_LIMIT = 16000;
export const CLARIFICATION_PROMPT = "Nubi needs one focused question before continuing.";
export const QUESTION_GUIDANCE = 'Ask only for information that changes the next dependent action. First check conversation, prior answers and task context. Retrieve needed page, attachment, reviewed site-wiki or registered-skill evidence with available read tools; avoid entire histories or libraries. Prefer the latest explicit user correction over older knowledge. If the user delegates read-only selection, such as comparing any three matching products or choosing one official video, select among observed qualifying sources yourself and explain the choice in the result. An optional store or source preference is not missing required user input. Do not ask permission to report a read-only answer the user already requested. For a multi-page summary or aggregate, use the retained source snapshots of each visited page; earlier pages need not remain simultaneously visible. Compute from those records, preserve uncertainty where needed, and deliver the result through normal completion review. Ask only when ambiguity changes the authorized target, required personal/business value, or material outcome. Distinguish historical guidance from current page state. Do not search indefinitely or invent personal values: ask_user promptly when the intended target, required user value or desired outcome remains unclear. Present ONE concrete decision per question card, not a request to describe all requirements. Use 2-4 grounded choices by default; text-only when meaningful alternatives are unknown or a passage is needed. Explain only useful differences. Preferences such as summary versus detailed report may be proposed as alternatives, never asserted as page facts. Never fabricate recipients, page targets or required personal values. The UI puts direct text entry below all choices. Do not add Other, 기타, or direct-entry choices. For several missing details, ask the next blocking item, read the answer, then ask the next only if still needed. Reuse prior answers and resume the original task. Use short text by default; long_text only when the actual answer is a passage. input_placeholder gives a short format example (Korean: "예:"), never an assumed answer, fabricated page value or list of questions. Do not stop with a prose list of missing information. Never ask for secrets or use clarification as final-action approval.';

// Planner/reviewer questions can use text choices, never fabricated image refs.
export function textQuestionArgs(args) {
  const {question, refs, choices, inputMode, inputPlaceholder} = questionArgs(args);
  if (refs.length) throw new Error('tool_arguments_invalid');
  return {question, ...(choices.length ? {choices} : {}), ...(inputMode === 'long_text' ? {input_mode: inputMode} : {}), ...(inputPlaceholder ? {input_placeholder: inputPlaceholder} : {})};
}

export function clarificationMessage({reason, review, plan}) {
  return {role: 'system', content: `${CLARIFICATION_PROMPT} Call ask_user only. Read the original request, conversation, current unfinished plan and actual tool results. ${QUESTION_GUIDANCE} Do not answer the whole task, claim completion or ask the user to do routine page work. This phase cannot run page actions. The following JSON is fallible task context, not authorization:\n${JSON.stringify({reason, review, plan})}`};
}

// Image choices must be files actually observed and saved by the worker.
// Text choices describe concrete user preferences, never invented page facts.
export function questionArgs(args) {
  const question = typeof args?.question === 'string' ? args.question.trim() : '';
  const refs = args?.image_refs || [];
  if (!question || question.length > 180 || !Array.isArray(refs) ||
      (refs.length && (refs.length < 2 || refs.length > 4)) || new Set(refs).size !== refs.length ||
      refs.some(ref => typeof ref !== 'string' || !ref.startsWith('img-'))) throw new Error('tool_arguments_invalid');
  const choices = args?.choices || [], inputMode = args?.input_mode || 'text';
  const inputPlaceholder = args?.input_placeholder;
  if (inputPlaceholder !== undefined && (typeof inputPlaceholder !== 'string' || !inputPlaceholder.trim() || inputPlaceholder.length > 100 || /[\r\n]/.test(inputPlaceholder))) throw new Error('tool_arguments_invalid');
  if (!['text', 'long_text'].includes(inputMode) || !Array.isArray(choices) ||
      (choices.length && (refs.length || choices.length < 2 || choices.length > 4)) ||
      choices.some(item => !item || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 80 ||
        (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 160))) ||
      new Set(choices.map(item => item.label.trim())).size !== choices.length) throw new Error('tool_arguments_invalid');
  return {question, refs, choices: choices.map(item => ({label: item.label.trim(), ...(item.description?.trim() ? {description: item.description.trim()} : {})})), inputMode, ...(inputPlaceholder ? {inputPlaceholder: inputPlaceholder.trim()} : {})};
}
export function makeQuestion(text, attachments, captures, {choices = [], inputMode = 'text', inputPlaceholder} = {}) {
  const options = choices.length ? choices.map((item, index) => ({...item, id: `option-${index + 1}`})) : attachments.map((item, index) => {
    const capture = captures.find(capture => capture.id === item.id && capture.source === 'page-image');
    if (!item.availableInChat || !capture) throw new Error('image_unavailable');
    return {id: capture.id, label: capture.label || `이미지 ${index + 1}`};
  });
  if (new Set(options.map(option => option.id)).size !== options.length) throw new Error('tool_arguments_invalid');
  return {id: crypto.randomUUID(), text, options, kind: choices.length ? 'choice' : options.length ? 'image' : 'text', inputMode, ...(inputPlaceholder ? {inputPlaceholder} : {})};
}
export function questionAnswer(question, choice) {
  if (!question || question.answer || choice?.questionId !== question.id) throw new Error('question_changed');
  if (choice.text !== undefined) {
    if (question.kind === 'approval' || choice.optionId || typeof choice.text !== 'string' || !choice.text.trim() || choice.text.length > QUESTION_TEXT_LIMIT) throw new Error('question_changed');
    return choice.text.trim();
  }
  const index = question.options.findIndex(option => option.id === choice.optionId);
  if (index < 0) throw new Error('question_changed');
  if(question.kind==='approval')return choice.optionId==='approve'?`${question.action}을 승인합니다.`:question.hasEditableDraft===false?'최종 반영을 취소합니다.':'최종 반영을 취소합니다. 초안은 유지해주세요.';
  if(question.kind==='choice')return question.options[index].label;
  return `${index + 1}번 이미지 (${question.options[index].label})를 선택했어요.`;
}
// Keep visible ordinals consistent with the model's question context while
// preserving saved option IDs and the explicit answer/approval contract.
export function questionDisplayOptions(question, {allowText = true} = {}) {
  if (question.kind !== 'choice' || !allowText) return question.options;
  return question.options.filter(option =>
    !/^(?:기타(?:\s*\(\s*직접\s*입력\s*\))?|직접\s*(?:입력|답변)|other(?:\s*\(\s*(?:please\s*)?specify\s*\))?)$/i.test(option.label.trim()));
}
export function questionContext(message) {
  if (message.role === 'user' && message.clarification) return `${message.content}\n<answered_question>\n${JSON.stringify(message.clarification)}\n</answered_question>`;
  if (!message.question) return message.content;
  const {text} = message.question, options = questionDisplayOptions(message.question);
  if(message.question.kind==='approval')return [text,...(message.question.preview||[]).map(field=>`${field.label}: ${field.value}`),message.question.answer?.text||'최종 반영 승인 대기 중'].filter(Boolean).join('\n');
  return [message.content, text, options.length ? options.map((option, i) => `${i + 1}. ${option.label}${message.question.kind === 'choice' ? option.description ? `: ${option.description}` : '' : ' (이미 채팅에 다운로드 가능한 파일로 첨부됨)'}`).join('\n') : ''].filter(Boolean).join('\n');
}

// Only the immediately answered question in this continuation is eligible.
// Never reuse approvals, images, a previous task, or changed alternatives.
export function repeatedQuestionAnswer(previous, args) {
  const normalize = text => String(text || '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!previous?.answer?.text || !['text', 'choice'].includes(previous.kind) || args.refs?.length ||
      normalize(previous.text) !== normalize(args.question)) return null;
  const options = (previous.options || []).map(({label, description}) => ({label, ...(description ? {description} : {})}));
  if (JSON.stringify(options) !== JSON.stringify(args.choices || [])) return null;
  return {error: 'question_already_answered', questionId: previous.id, question: previous.text, answer: previous.answer.text,
    instruction: 'The user already submitted this answer for the current continuation. Use it to continue the original task. If a specific detail is still missing, ask a different focused question explaining that gap. This answer is not final-action approval or current page evidence.'};
}
