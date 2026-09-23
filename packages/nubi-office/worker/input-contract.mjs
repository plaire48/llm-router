// Shared by the worker and task pane; never accept more than the worker can retain.
export const INPUT_TEXT_LIMIT = 10000;
export const INPUT_HISTORY_LIMIT = 64000;

export function retainedAnswers(records = []) {
  if (!Array.isArray(records) || records.length > 64) throw new Error('invalid_question');
  const accepted = [];
  for (const record of records) {
    if (typeof record?.question !== 'string' || !record.question.trim() || record.question.length > 900) throw new Error('invalid_question');
    validateAnswer({text:record.text}, answerLimit(accepted, record.question));
    accepted.push({question:record.question,text:record.text});
  }
  return accepted;
}

export function answerLimit(history = [], question = '') {
  const used = history.reduce((size, answer) => size + answer.question.length + answer.text.length, 0);
  return Math.max(0, Math.min(INPUT_TEXT_LIMIT, INPUT_HISTORY_LIMIT - used - question.length));
}

export function validateAnswer(result, limit = INPUT_TEXT_LIMIT) {
  if (result?.cancelled === true) return;
  if (typeof result?.text !== 'string' || !result.text.trim() || result.text.length > INPUT_TEXT_LIMIT) throw new Error('invalid_question');
  if (result.text.length > limit) throw new Error('input_context_limit');
}
