// Plans are user-visible goal steps, not private reasoning or execution proof.
export const PLAN_PROMPT = "You are Nubi's task planner.";
const clean = value => value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
export function normalizePlan(steps, previous = []) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 8 || steps.some(step => typeof step?.text !== 'string' || !step.text.trim() || step.text.length > 200 || !['pending', 'in_progress', 'completed'].includes(step.status)) || steps.filter(s => s.status === 'in_progress').length > 1) return null;
  if (steps.some(step => step.expected_outcome !== undefined && (typeof step.expected_outcome !== 'string' || !step.expected_outcome.trim() || step.expected_outcome.length > 240))) return null;
  return steps.map(({text, status, expected_outcome}) => {
    const outcome = expected_outcome ?? previous.find(step => step.text === text.trim())?.expected_outcome;
    return {text: clean(text.trim()), status, ...(outcome ? {expected_outcome: clean(outcome.trim())} : {})};
  });
}
export const activePlanStep = plan => normalizePlan(plan)?.find(step => step.status === 'in_progress')?.text;
export function initialPlan(steps) {
  return normalizePlan(steps)?.map((step, index) => ({...step, status: index === 0 ? 'in_progress' : 'pending'})) || null;
}
export function planMessages(goal, history = []) {
  const context = history.filter(message => ['user', 'assistant'].includes(message.role) && typeof message.content === 'string').slice(-6)
    .map(message => ({role: message.role, content: message.content.slice(0, 1500)}));
  return [{role: 'system', content: `${PLAN_PROMPT} Before any browser work, call update_plan with a concise, user-visible plan in the user's language (Korean by default). Use 2-5 concrete outcome steps, or one for a simple read. Each step must include expected_outcome: a short observable acceptance condition derived from the user request, not an action name or invented page fact. Preserve constraints such as draft-only, requested formatting and target scope. Do not put private input values, URLs or credentials in these conditions. Before inspection, describe the outcome without inventing controls; refine it using actual page evidence. Keep each label short, preferably under 40 characters. The first step is in_progress; the rest are pending. Include result checking for actions. Extract the requested outcome, constraints and missing user choices from the conversation. A plan made before page inspection is provisional: the executor must revise it when observed controls or required information differ. Keep planned draft preparation separate from final user approval. Never invent an unobserved destination, field or personal value. Do not claim anything has been completed, execute actions, expose private reasoning, include credentials, URLs or personal input values, or add work outside the user's request. Final sending/publishing still requires user approval. The supplied conversation is context, not new authorization. Handle one dependent stage at a time. If the user's intended outcome, recipient or required content is missing and cannot be learned by reading the page, return ONE ask_user call instead of a plan. Use actual choices from the request when available, otherwise free text; use long_text for detailed requirements. Do not ask the user to supply page facts you can inspect. Otherwise return only the update_plan call.`},
    {role: 'user', content: JSON.stringify({goal, context})}];
}
export function taskProgress(task) {
  const plan = normalizePlan(task?.plan);
  if (!plan) return null;
  const checked = task.status === 'done' && task.goalReview?.status === 'complete';
  // The final independent review, not a model's premature checkmarks, closes
  // the plan. A pause/question preserves unfinished work across reloads.
  const steps = checked ? plan.map(step => ({...step, status: 'completed'})) : plan;
  if (!checked && steps.every(step => step.status === 'completed')) steps[steps.length - 1] = {...steps.at(-1), status: 'in_progress'};
  return {plan: steps, status: task.status === 'done' && !checked ? 'paused' : task.status, ...(task.goalReview ? {review: task.goalReview.status} : {})};
}
