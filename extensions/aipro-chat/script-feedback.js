// Only fixed categories cross into saved UI state. Never persist generated
// code, selectors, page values or raw Playwright exception messages.
export const SCRIPT_FAILURES = Object.freeze({
  browser_dialog: ['브라우저 확인 필요', 'A native browser confirmation or prompt interrupted the operation. It was not accepted by Nubi; dismissal is not task completion and prior side effects may remain. Do not replay the opening click, bypass the dialog or claim success. Pause for the user to handle this unsupported native confirmation, then re-observe actual state before continuing. This is not an approval token.'],
  approval_required: ['승인 필요', 'Prepare the requested draft first. Verify the actual fields, then use request_approval for the observed final button. Never bypass approval via another script or tool.'],
  approval_verification_required: ['초안 검증 필요', 'The final action was not executed. Call verify_page for the complete draft first, then request_approval with the freshly observed final button.'],
  script_syntax: ['코드 문법 오류', 'Use a short JavaScript function body with await. Do not include Markdown fences, imports or TypeScript.'],
  script_unawaited: ['동작 대기 누락', 'Await every browser/locator call before returning. Some calls may already have run: inspect the fresh observation and repair only missing work, never replay the whole script.'],
  script_api: ['지원하지 않는 동작', 'Use only the run_playwright facade methods listed in its schema. No evaluate, DOM globals, Node, imports or page.keyboard. Use locator.fill/press/appendText and browser.snapshot instead.'],
  script_attribute: ['읽기 항목 확인', 'getAttribute supports only the page metadata listed in the script API guide. Use inputValue for an ordinary visible field. Do not read arbitrary attributes or authentication data.'],
  script_locator: ['대상 구분 필요', 'Inspect the fresh observation and choose one exact observed role/label or the correct frame. Do not guess nth() or force a click.'],
  script_missing: ['대상을 찾지 못함', 'The target is absent in the current frame after waiting. Inspect the fresh observation and browser.tabs() for a new tab or popup. Choose an observed target in the correct frame; do not invent a selector or repeat the opening click.'],
  script_obscured: ['다른 요소에 가림', 'Another element intercepted pointer events. Inspect the current dialog or overlay and its observed controls. Resolve that layer only within the requested task, then re-observe the target. Never use force, Enter/Space, direct URL navigation or DOM removal to bypass it.'],
  script_disabled: ['사용할 수 없는 항목', 'The target is disabled. Inspect required fields, validation messages and current loading state. Complete only missing prerequisites and verify them before trying again; never remove disabled attributes.'],
  script_hidden: ['보이지 않는 항목', 'The target is hidden. Inspect the active dialog, tab or expanded section and use a visible observed control. Do not force a click on a hidden duplicate.'],
  script_timeout: ['대상 응답 지연', 'Inspect the current page and any popup/frame before correcting the locator. The timed-out action may already have happened; verify it before any new write.'],
  script_target: ['입력 대상 확인', 'Inspect the actual editable input or contenteditable element and its enabled state, including its frame. Use fill only on an editable control.'],
  script_focus: ['입력 위치 확인', 'Keyboard focus moved away from the exact target. Inspect the fresh focused control and any dialog or suggestions. Check inputValue and command receipts for a retained prefix before continuing only missing text. Never send keys to the unrelated focused field or replay a partial input.'],
  script_control_state: ['상태 변화 확인', 'Read the fresh checked/pressed state before another action. Use setChecked(true/false) for observed switches, checkboxes and toggle buttons; it is a no-op when already correct. If state is missing or unchanged, inspect a fresh screenshot when available and correct the target. Never blindly repeat a toggle click.'],
  editor_ambiguous: ['선택할 문구 구분', 'The text occurs more than once. Read editorState with a unique passage or inspect the editor selection controls. Do not choose an arbitrary occurrence or overwrite the body. Ask the user only if the intended passage remains unclear.'],
  editor_text_missing: ['본문 다시 확인', 'The exact passage was not found. Read editorState from the current editor, then select a unique observed passage with its fresh digest. Do not retype or replace the whole draft.'],
  editor_selection_lost: ['본문 선택 확인', 'The editor did not retain the text selection. Inspect the page and native editor controls before applying formatting. Do not apply a shortcut to an uncertain selection.'],
  editor_too_large: ['본문 범위 확인', 'The editor exceeds the bounded text scan. Use observed editor find/selection controls to work on a smaller section. Do not replace or truncate the existing document.'],
  browser_stale: ['페이지 변경됨', 'Re-observe the current page. Verify earlier input before choosing the next action; do not replay an uncertain write.'],
  capture_too_large: ['구간별 캡처 필요', 'The page image exceeds the dimension or byte budget. Do not repeat the same full-page capture. Read the page structure, scroll the relevant observed page/inner scroll area and capture viewport sections one at a time. Report actual coverage; never claim one section is the full page.'],
  capture_incomplete: ['캡처 범위 확인', 'The returned image did not match the observed document dimensions. Re-observe and use viewport sections of the relevant page or inner scroll area. Do not claim a complete page capture or reuse image coordinates.'],
  scroll_target_required: ['스크롤 영역 확인', 'No clear wheel target for this scroll area was observed. No wheel was issued. Inspect the fresh observation and choose the relevant element ref with scroll metadata. Do not reuse an arbitrary mouse position or repeat unchanged.'],
  scroll_not_moved: ['스크롤 위치 확인', 'A wheel event was issued but the intended area did not move. Inspect the returned observation and scroll receipt for overlays or another scroll area. Do not repeat unchanged or claim new content was read.'],
  script_secret_field: ['보호된 입력란', 'This input is protected. Do not bypass the guard or read authentication data.'],
  script_cpu_limit: ['코드 실행 시간 초과', 'Split the script into small awaited steps. Remove busy loops and inspect results between steps.'],
  script_invalid: ['코드 형식 오류', 'Use the declared schema and a short complete JavaScript function body.'],
  fill_not_retained: ['입력 반영 확인', 'Read the current field and visible save state. Do not append or fill the same content again without checking what was retained.'],
  cancelled: ['취소', 'The task was cancelled. Do not repeat or resume its actions.'],
  script_failed: ['코드 실행 실패', 'Inspect the current page, then correct the next small script using the declared methods. Do not replay completed or uncertain actions.'],
});
export function scriptFailure(error, evidence) {
  const message = String(error?.message || error || ''), name = error?.name || '';
  // Playwright prefixes fixed errors raised by static page helpers with the
  // RPC method and an Error line. Keep only our registered category.
  const wrapped = message.match(/\bError: ([a-z_]+)(?:\s|$)/)?.[1];
  const reason = Object.hasOwn(SCRIPT_FAILURES, error?.reason) ? error.reason : Object.hasOwn(SCRIPT_FAILURES, message) ? message : Object.hasOwn(SCRIPT_FAILURES, wrapped) ? wrapped :
    /strict mode violation|resolved to \d+ elements/i.test(message) ? 'script_locator' :
    /detached|not attached|closed|browser_stale/i.test(message) ? 'browser_stale' :
    /intercepts? pointer events|intercepted pointer events/i.test(message) ? 'script_obscured' :
    evidence === 'missing' ? 'script_missing' :
    evidence === 'disabled' || /element is not enabled/i.test(message) ? 'script_disabled' :
    evidence === 'hidden' || /element is not visible/i.test(message) ? 'script_hidden' :
    /not.*(?:input|textarea|contenteditable)|not editable|readonly|read.only|fill_invalid/i.test(message) ? 'script_target' :
    name === 'TimeoutError' || /timeout|timed out/i.test(message) ? 'script_timeout' :
    name === 'SyntaxError' || /SyntaxError|unexpected token|expecting/i.test(message) ? 'script_syntax' :
    /not a function|not defined|undefined|unsupported.*method/i.test(message) ? 'script_api' : 'script_failed';
  return {error: reason === 'script_timeout' ? 'Playwright timeout: inspect current page before another action.' : reason, reason, instruction: SCRIPT_FAILURES[reason][1]};
}
