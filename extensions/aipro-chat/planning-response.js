// Bundled inference-side validation. Raw worker modules must not import this
// module or its package dependencies. Plans remain data, never execution.
import {initialPlan, planningFailure} from './task-plan.js';
import {textQuestionArgs} from './user-question.js';
import {toolArgumentIssues} from './tool-validation.js';

export function parsePlanningResponse(response, tools) {
  if (response?.finishReason === 'length') throw planningFailure('plan_output_limit');
  if (response?.calls != null && !Array.isArray(response.calls)) throw planningFailure('plan_tool_calls');
  const calls = response?.calls || [];
  let name = 'update_plan', args;
  if (calls.length) {
    if (calls.length !== 1 || !['update_plan', 'ask_user'].includes(calls[0]?.function?.name)) throw planningFailure('plan_tool_calls');
    name = calls[0].function.name;
    try {args = JSON.parse(calls[0].function.arguments);} catch {throw planningFailure('plan_json_invalid');}
  } else {
    // A complete JSON plan is data. It cannot dispatch an action or supply a
    // question/approval through an alternate unvalidated envelope.
    if (typeof response?.content !== 'string' || response.content.length > 32000) throw planningFailure('plan_json_invalid');
    try {args = JSON.parse(response.content.trim());} catch {throw planningFailure('plan_json_invalid');}
  }
  const definition = tools.find(tool => tool.function.name === name)?.function;
  if (!definition || toolArgumentIssues(definition.parameters, args)) throw planningFailure('plan_arguments_invalid');
  if (name === 'ask_user') {
    try {return {question: textQuestionArgs(args)};} catch {throw planningFailure('plan_question_invalid');}
  }
  const plan = initialPlan(args.steps, {requireOutcomes: true});
  if (!plan) throw planningFailure('plan_steps_invalid');
  return plan;
}
