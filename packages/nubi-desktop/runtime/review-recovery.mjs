import {REVIEW_RECOVERY_GUIDANCE} from '../../../extensions/aipro-chat/review-recovery.js';

// Browser review recovery keeps reads available but never replays actions.
// Desktop uses an explicit host allowlist rather than trusting tool labels.
export const REVIEW_RECOVERY_TOOLS=new Set([
  'ask_user','update_plan','discover_capabilities','use_skill','read_skill','list_skill_resources',
  'read_conversation','read_source','source_search','inspect_path','code_outline',
  'wiki_query','knowledge_query','personal_mail_query','read_personal_mail',
  'inspect_environment','inspect_workspace_changes','read_process_output','read_document_analysis',
  'recovery_snapshot','computer_checkpoint','read_computer_result','observe_computer',
  'verify_computer_value','verify_computer_outcome','list_computer_apps',
]);
export const DESKTOP_REVIEW_RECOVERY_GUIDANCE=REVIEW_RECOVERY_GUIDANCE+
  ' This Desktop recovery may only read current project evidence and stored receipts, verify already-observed controls, update its provisional plan, or ask_user. Do not prepare edits, setup commands, command repairs, app actions, launches or batches. Tool discovery and skill instructions never expand this allowlist. Preserve original requests, corrections, approvals and uncertain outcomes. A fresh read is not permission to repeat an action.';
export const reviewRecoveryTools=tools=>tools.filter(tool=>REVIEW_RECOVERY_TOOLS.has(tool.function.name));
