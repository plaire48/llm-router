import {ERROR_TEXT} from './core.js';
import {SCRIPT_FAILURES} from './script-feedback.js';

// Thrown transport/host exceptions can contain page input or credentials. Only
// known codes and HTTP status enter model feedback; returned command receipts
// already follow their host-specific contract and are not rewritten here.
export function toolException(error, {mutating = false} = {}) {
  const reason = Object.hasOwn(SCRIPT_FAILURES, error?.reason) ? error.reason :
    Object.hasOwn(SCRIPT_FAILURES, error?.message) ? error.message : null;
  const code = reason || (Object.hasOwn(ERROR_TEXT, error?.message) ? error.message : 'tool_execution_failed');
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : undefined;
  const cancelled = code === 'cancelled';
  const notStarted = error?.actionIssued === false;
  const uncertain = mutating && !cancelled && !notStarted;
  const connection = ['workspace_changed', 'workspace_unavailable', 'page_permission', 'page_restricted', 'unauthorized', 'forbidden', 'no_credential', 'expired_token'].includes(code);
  return {ok: false, error: code, ...(reason ? {reason} : {}), ...(status ? {status} : {}), ...(cancelled ? {cancelled: true} : {}),
    ...(mutating ? {actionIssued: notStarted ? false : null} : {}),
    recovery: {strategy: cancelled ? 'stop' : connection ? 'user_action' : uncertain ? 'observe_before_action' : 'replan', execution: uncertain ? 'unknown' : notStarted ? 'not_started' : 'read_failed'},
    instruction: cancelled ? 'Do not resume or repeat cancelled work.' : connection ? 'The connection or permission needs user attention. Do not bypass it or request credentials in chat. Use the existing connection UI or ask one focused question.' :
      uncertain ? 'This action may already have taken effect. Its receipt was lost. Read the current page and verify its outcome before any further write. Do not repeat the call or the whole script. Continue only work shown to be missing; final transactions still require approval.' :
      reason ? SCRIPT_FAILURES[reason][1] : 'The tool failed. Inspect the current evidence and declared tool schema, then choose a corrected next step. Do not blindly repeat the same call.'};
}

export function rejectedToolFeedback(unavailable = false, issues) {
  return {error: unavailable ? 'tool_unavailable' : 'tool_arguments_invalid', actionIssued: false,
    recovery: {strategy: 'replan', execution: 'not_started'},
    ...(!unavailable && issues?.length ? {issues} : {}),
    instruction: unavailable ? 'This tool is not connected and was NOT executed. Choose from the currently declared tools, or select_tools to inspect existing authorized groups. Never invent another tool or assume extra permissions.' :
      'The tool was NOT executed. Correct its arguments using the declared JSON schema and observed targets, then request only the corrected next step.' +
      (issues?.some(issue => issue.objectSchemas?.length) ? ' objectSchemas lists only host-declared property names at objectSchemaPath. Remove unsupported fields and supply the required fields of the applicable schema. These are separate schema fragments: satisfy the applicable anyOf/oneOf branch and every allOf condition, not a merged set of required fields. When schemaHintsTruncated is true, consult the full declared schema for omitted names. No arguments were automatically removed, converted or executed. Correct this tool call; a successful page read does not repair its argument format.' : '')};
}
