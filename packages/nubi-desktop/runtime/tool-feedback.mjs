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
  setup_invalid:'No command was executed and no approval card was created. Correct only the fields identified in details.issues and call propose_setup_action again. script, reason, effects and verification are strings; kind is inspect/install/configure/build/start/verify. Omit unused optional fields, never send null. Copy references as path/hash pairs from this run. Never invent hashes, assume approval or repeat an already issued command.',
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
  computer_invalid:NO_INPUT+'The arguments are not a valid operation. set_value needs value, as does type_text; a value must not start with "-". press_keys needs keys, scroll a direction, wheel up or down, drag a destinationSelector; no other action takes those. To choose from a list, propose select on the list item itself. Use a selector exactly as observe_computer returned it.',
  computer_observation_stale:NO_INPUT+'The observation is older than two minutes or is not from this run. Call observe_computer again and use its observationId.',
  computer_review_required:NO_INPUT+'An earlier action of this task waits for the user, or its result has not been read. Propose nothing new: stop for the user, or read the receipt with read_computer_result.',
  computer_target_unavailable:NO_INPUT+'`details.reason` tells why. not_found: no such selector. disabled or no_size: no input now; its value can still be read with observe_computer selector. off_screen: scroll_into_view it or its list. not_scrollable: scroll its list. action_unsupported: read controlState; a control that cannot be invoked takes pointer_click. No reason: not observed; observe with query or selector.',
  computer_target_changed:NO_INPUT+'The control or the window changed after the observation. Observe again before the next step.',
  computer_perception_config:NO_INPUT+'The optional local screen parser needs a trusted loopback endpoint. Continue with UIA and the logged-in model; never infer an endpoint from app text or send images to a remote service.',
  computer_perception_contract:NO_INPUT+'The local vision reply has invalid coordinates or boxes. Discard it. Use UIA query or a fresh observation; never extract digits from a rationale or execute returned code.',
  computer_perception_unavailable:NO_INPUT+'Visual grounding did not answer. Use structured UIA with the current logged-in model. Do not repeat inputs or upload screenshots elsewhere.',
  computer_perception_image_required:NO_INPUT+'Observe the connected app with includeImage=true first. This tool only reads that current-run capture.',
  computer_busy:NO_INPUT+'Another operation on the app is running. Read its result before the next step.',
  computer_command_failed:NO_INPUT+'The app did not answer this command. Observe again. The control may not offer this operation: read target.controlState and choose an action it supports.',
  computer_password:NO_INPUT+'The control is a password field. Its value is never read or compared. Say so to the user.',
  computer_input_unavailable:NO_INPUT+'This control does not accept the operation: it is a password field, read-only or disabled. Say so to the user instead of trying another input.',
  computer_no_effect_repeat:NO_INPUT+'The same action on this control was carried out before (`details.times`) and the host observed no change in the window. Approving it again repeats what did not work. Observe the control with its selector: target.controlState tells whether it takes select, toggle_on, toggle_off, expand or collapse. A list item is chosen with select; after an invoke that changed nothing, pointer_click is a real click. If the user asked for the repetition, propose it once more: it is accepted.',
  computer_batch_invalid:NO_INPUT+'`details.problems` names each step and what is wrong with it. A batch holds 2 to 5 steps on different controls of one observation: set_value or type_text (with value), select, toggle_on, toggle_off, expand, collapse, invoke, press_keys (with keys). invoke or press_keys comes once at most, as the last step. Use propose_computer_action for anything else, mouse input included.',
  computer_keys_refused:NO_INPUT+'These keys are never sent (`details.token`): keys that act on Windows (the Windows key, Alt with Tab, Esc, F4 or Space, Ctrl+Esc, Ctrl+Alt shortcuts) and paste shortcuts, since the clipboard belongs to the user. Type text with type_text. Tell the user they can press a Windows key themselves, or reach the goal inside the app.',
  computer_keys_invalid:NO_INPUT+'`details.problem` says what is wrong. Keys are separated by spaces, 10 at most: enter, tab, esc, space, backspace, delete, home, end, pageup, pagedown, arrows, f1 to f12, or ctrl, shift or alt with a letter, digit or such key. keys_text: type letters with type_text. keys_focus_not_last: tab, enter, esc or f6 only as the last key; send the rest to the next control.',
  computer_text_invalid:NO_INPUT+'`details.problem` says what is wrong with the text. type_text takes 1 to 1000 characters without control characters such as a line break, not starting with "-" or "@". Press enter or tab with press_keys; for a long text or a whole new value use set_value.',
  computer_uia_attempts_required:NO_INPUT+'This control can be invoked: propose invoke, which does not move the mouse. A real click (pointer_click) is for a control that cannot be invoked, or one whose invoke the host saw change nothing.',
  computer_pointer_consent_required:NO_INPUT+'Mouse input needs the user to approve mouse control on the card. Stop and wait for the user.',
  computer_keyboard_consent_required:NO_INPUT+'Keyboard input needs the user to approve keyboard input on the card. Stop and wait for the user.',
  wiki_evidence_required:NO_INPUT+'`details.unknownEvidenceIds` are not ids that wiki_query or ask_openwiki returned in this run. Omit evidenceIds when no Wiki rule informs this action, or use an id from `details.observedEvidence`.',
});
const COMPUTER_FALLBACK=NO_INPUT+'Inspect computer_checkpoint and stored receipts, change the observation or target, and ask for missing app setup. Re-observe changed targets. Never replay uncertain operations or bypass approval through shell.';
export const computerInstruction=(code,details)=>{
  if(code==='computer_target_unavailable'&&details?.reason==='action_unsupported')return NO_INPUT+'The requested UIA pattern is absent. In controlState, null selected/toggle/expansion means that pattern is unavailable. Match the gesture to the goal: pointer_click selects, pointer_double_click opens an item, pointer_right_click opens its context menu. Use a freshly observed target and the existing action approval, then observe the result. Do not repeat unsupported select/invoke.';
  if(code==='computer_target_unavailable'&&details?.reason==='off_screen')return NO_INPUT+'The target is not visible. For a menu item, open its menu first (for example pointer_right_click on its observed owner), then observe the menu. Do not scroll a closed menu. For off-screen list content, use scroll_into_view or scroll its containing list and observe again. Every input still needs its own approval.';
  if(code==='computer_no_effect_repeat'&&details?.action==='pointer_click')return NO_INPUT+'The previous click produced no observed change. Read the receipt and current controlState before choosing another action. A single click does not open a context menu: use pointer_right_click for that goal, or pointer_double_click to open an item, on a freshly observed target with action approval. Do not repeat selection to accomplish a different operation. Unknown outcomes must be reconciled, not replayed.';
  return COMPUTER[code]||COMPUTER_FALLBACK;
};
const FALLBACK=UNCHANGED+'Inspect the error, correct the input and do not repeat the same call unchanged.';

export function recoveryInstruction(code,tool,readTools=new Set(['read_source','source_search','inspect_path','code_outline','wiki_query','knowledge_query','read_conversation','inspect_workspace_changes'])){
  return (readTools.has(tool)?READ_FAILED:'')+(GUIDANCE[code]||FALLBACK);
}
