// Guidance returned with a refused tool call. One refusal gets the guidance
// for its own code only: a list covering every code buried the relevant line
// and cost context on each failure. Facts about the failure travel in
// `details`; this text says what to do with them.
const READ_FAILED='The read failed. Inspect the error and choose a narrower range or another existing path. No write occurred. Do not repeat unchanged failures. ';
const UNCHANGED='No source was changed and no proposal was created. ';
const PLAN='Use record_change_plan with the corrected input. ';
const GUIDANCE=Object.freeze({
  preview_source_required:'Read source or recovery_snapshot to find exact local server URLs, or ask if they cannot be determined.',
  preview_scope:'Compare only loopback URLs confirmed from this project. Read source or recovery_snapshot to find them.',
  preview_http_error:'Inspect the server output and propose setup only through user approval.',
  work_plan_invalid:'The first update_plan needs intent with goal, constraints, outcomes, and workflowIds and skillPaths from current host capabilities; later updates may retain it. It needs 1-5 outcome steps with exactly one in_progress and no completed steps.',
  elevation_unavailable:'Administrator execution is unavailable on this host. Choose a step that works without elevation or ask the user.',
  elevation_command_limit:'Administrator execution accepts one short command. Shorten it or use an ordinary approved setup command.',
  elevation_approval_required:'Administrator execution needs its own user approval. Prepare the exact proposal and stop for review.',
  conversation_range:'Use an index and offset returned by read_conversation.',
  file_exists:UNCHANGED+'The path already exists. Read it with read_source and plan an edit instead of a new file.',
  parent_missing:UNCHANGED+'The parent directory is missing. Creating it requires a separate user-approved setup command.',
  project_rules_changed:UNCHANGED+'Project rules changed. Read the source or inspect_path again, then refresh the change plan.',
  rules_unavailable:'Project rules could not be read. Inspect the path and report the missing rules instead of assuming them.',
  rules_limit:'Project rules exceed the readable size. Read the needed part with read_source.',
  setup_invalid:'Propose ONE exact command with observed evidence hashes, expected effects and a verification step.',
  setup_changed:'The evidence for this setup proposal changed. Inspect the environment again before proposing.',
  search_unavailable:'Search is unavailable. Use read_source or inspect_path on known paths.',
  workspace_status_invalid:'Pass no path to list changed files, or one changed file path to read its diff.',
  quality_unavailable:UNCHANGED+'The syntax check could not run. Inspect the failure before retrying. Syntax checks do not prove types, tests, or user goals.',
  proposal_invalid_syntax:UNCHANGED+'Correct the proposed text at the diagnostic locations in `quality` and submit it again against the unchanged source. Never disable validation, rename a file to evade it, or delete unrelated code.',
  wiki_evidence_required:UNCHANGED+'`details.unknownEvidenceIds` were not returned by wiki_query in this run. Use an evidenceId from `details.observedEvidence`, run wiki_query again, or omit evidenceIds for a requirement that needs no Wiki citation. '+PLAN,
  wiki_evidence_stale:UNCHANGED+'A cited Wiki page or its source changed. Query Wiki again and inspect the current references; do not remove citations just to bypass a stale reference.',
  tool_timeout:'The operation timed out. Narrow the request before trying a different operation.',
  source_missing:'The path does not exist. Use source_search or inspect_path to find the correct path.',
  source_unavailable:'The path cannot be read. Choose another path in this workspace.',
  repair_invalid:'Propose a corrected command for the failed process of this task, with the observed cause.',
  shell_unavailable:'The selected shell is unavailable on this host. Inspect the environment and choose an available shell.',
  plan_invalid:UNCHANGED+'Fix each item in `details.problems`. Every requirement needs a check, and every check and target must name an existing requirement id. '+PLAN,
  plan_criteria_missing:UNCHANGED+'Set criterionId only to an id in `details.validCriteria`, and cover every id in `details.uncoveredCriterionIds` with a requirement. Remove the ids in `details.unknownCriterionIds`. '+PLAN,
  change_plan_required:UNCHANGED+'This run has no recorded change plan. Read the target, then call record_change_plan before proposing an edit.',
  change_scope_unplanned:UNCHANGED+'The path is not a target of the current change plan. Read it and record a plan that includes it.',
  change_plan_stale:UNCHANGED+'The target changed after the plan was recorded. Read it again and refresh the change plan.',
  tool_arguments_invalid:'The arguments do not match the tool schema. Correct the input instead of repeating the same call.',
  source_read_required:UNCHANGED+'Read `details.path` with read_source in this run, including the lines to change, then repeat the call.',
  source_stale:UNCHANGED+'The file changed after it was read. Read it again and use the new hash.',
  range_invalid:'Use a start within the file length (details.lines) and an end not before it. Omit them to read from line 1.',
  edits_invalid:UNCHANGED+'Provide 1-10 edits with non-empty oldText.',
  edit_text_missing:UNCHANGED+'oldText was not found in the range read in this run. Copy the exact current text, including whitespace.',
  edit_text_ambiguous:UNCHANGED+'oldText occurs more than once. Include surrounding lines so it is unique.',
  edits_overlap:UNCHANGED+'Two edits overlap. Merge them into one edit.',
  edit_no_change:UNCHANGED+'The edit leaves the file unchanged. Check whether the change is already present.',
  content_limit:UNCHANGED+'The content exceeds the size limit. Prefer propose_patch with small exact replacements.',
  path_scope:'The path is outside this workspace or not allowed. Use a relative path inside the project.',
});
export const RECOVERABLE_CODES=Object.freeze(Object.keys(GUIDANCE));

// App control. A refused operation sent nothing to the app.
const NO_INPUT='No input was sent to the app. ';
const COMPUTER=Object.freeze({
  computer_invalid:NO_INPUT+'The arguments are not a valid operation. set_value needs value and no other action takes one; a value must not start with "-". To choose from a list, propose select on the list item itself, without value. drag needs destinationSelector and no other action takes one. Use a selector exactly as observe_computer returned it.',
  computer_observation_stale:NO_INPUT+'The observation is older than two minutes or is not from this run. Call observe_computer again and use its observationId.',
  computer_review_required:NO_INPUT+'An earlier action of this task waits for the user, or its result has not been read. Propose nothing new: stop for the user, or read the receipt with read_computer_result.',
  computer_target_unavailable:NO_INPUT+'`details.reason` tells why. Without it the selector is not among the elements of that observation: observe with query or selector so that the target is among them, then use that observationId. not_found: no control has that selector. disabled, off_screen or no_size: the control takes no input now; its value can still be read with observe_computer selector.',
  computer_target_changed:NO_INPUT+'The control or the window changed after the observation. Observe again before the next step.',
  computer_busy:NO_INPUT+'Another operation on the app is running. Read its result before the next step.',
  computer_command_failed:NO_INPUT+'The app did not answer this command. Observe again. The control may not offer this operation: read target.controlState and choose an action it supports.',
  computer_password:NO_INPUT+'The control is a password field. Its value is never read or compared. Say so to the user.',
  computer_input_unavailable:NO_INPUT+'This control does not accept the operation: it is a password field, read-only or disabled. Say so to the user instead of trying another input.',
  computer_no_effect_repeat:NO_INPUT+'The same action on this control was carried out before (`details.times`) and the host observed no change in the window. Asking the user to approve it again repeats what did not work. Observe the control with its selector: target.controlState tells whether it takes select, toggle_on, toggle_off, expand or collapse. A list item is chosen with select. If the user asked for the repetition, propose it once more: that proposal is accepted.',
  computer_batch_invalid:NO_INPUT+'`details.problems` names each step and what is wrong with it. A batch holds 2 to 5 steps on different controls of one observation. Allowed: set_value (with value), select, toggle_on, toggle_off, expand, collapse, invoke. invoke appears once at most and is the last step. Use propose_computer_action for anything else.',
  wiki_evidence_required:NO_INPUT+'`details.unknownEvidenceIds` are not ids that wiki_query or ask_openwiki returned in this run. Omit evidenceIds when no Wiki rule informs this action, or use an id from `details.observedEvidence`.',
});
const COMPUTER_FALLBACK=NO_INPUT+'Inspect computer_checkpoint and stored receipts, change the observation or target, and ask for missing app setup. Re-observe changed targets. Never replay uncertain operations or bypass approval through shell.';
export const computerInstruction=code=>COMPUTER[code]||COMPUTER_FALLBACK;
const FALLBACK=UNCHANGED+'Inspect the error, correct the input and do not repeat the same call unchanged.';

export function recoveryInstruction(code,tool,readTools=new Set(['read_source','source_search','inspect_path','code_outline','wiki_query','knowledge_query','read_conversation','inspect_workspace_changes','search_voc','read_voc'])){
  return (readTools.has(tool)?READ_FAILED:'')+(GUIDANCE[code]||FALLBACK);
}
