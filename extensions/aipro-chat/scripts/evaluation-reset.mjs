// Isolated evaluation only. Never clear product storage or answer an approval.
export async function prepareEvaluationTrial({state, rpc, wait, stop, waitForUI, now = Date.now, timeoutMs = 15000}) {
  const previous = await state();
  let current = previous, deadline = now() + timeoutMs;
  while (current.busy && now() < deadline) {await wait(100); current = await state();}
  if (current.busy && stop) {
    await stop(); deadline = now() + timeoutMs;
    while (current.busy && now() < deadline) {await wait(100); current = await state();}
  }
  if (current.busy) throw new Error('evaluation_previous_run_busy');
  const result = await rpc({type: 'NEW_CHAT'});
  if (result?.error || !result?.data) throw new Error(`evaluation_new_chat_${result?.error || 'missing_state'}`);
  current = await state();
  if (current.busy || !current.chat?.sessionId || current.chat.sessionId === previous.chat?.sessionId ||
      current.chat.messages?.length || current.chat.task || current.chat.messages?.at(-1)?.question) throw new Error('evaluation_new_chat_not_ready');
  if (waitForUI) await waitForUI(current.chat.sessionId);
  return current;
}

// The runner reads the applied public UI contract, never React internals or
// credentials. Input text is used only for equality and never enters diagnostics.
export function evaluationComposer(ui) {
  return {
    activate: () => ui.bringToFront(),
    inspect: () => ui.evaluate(() => {
      const forms = document.querySelectorAll('form.composer');
      const form = forms.length === 1 ? forms[0] : null;
      const input = form?.querySelector('textarea');
      const buttons = form?.querySelectorAll('button[aria-label="전송"]');
      const button = buttons?.length === 1 ? buttons[0] : null;
      const rect = button?.getBoundingClientRect();
      const style = button && getComputedStyle(button);
      const visible = !!rect?.width && !!rect?.height && style.visibility !== 'hidden' && style.display !== 'none';
      const hit = visible ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
      return {conversationId: form?.getAttribute('data-conversation-id') || null,
        documentVisible: !document.hidden, composerCount: forms.length, inputValue: input?.value ?? null,
        inputEnabled: !!input && !input.disabled, buttonCount: buttons?.length || 0,
        buttonVisible: visible, buttonEnabled: !!button && !button.disabled,
        centerHitsButton: !!button && !!hit && button.contains(hit)};
    }),
    fill: value => ui.getByRole('textbox', {name: '메시지', exact: true}).fill(value),
    click: () => ui.getByRole('button', {name: '전송', exact: true}).click({timeout: 30000}),
  };
}

export function evaluationClickReasons(error) {
  const message = String(error?.message || '');
  return [
    ['not_visible', /not visible/i], ['not_enabled', /not enabled|disabled/i],
    ['not_stable', /not stable/i], ['intercepted', /intercepts pointer events/i],
    ['detached', /detached|not attached/i], ['outside_viewport', /outside.*viewport/i],
    ['timeout', /timeout|timed out/i], ['closed', /target.*closed|page.*closed/i],
  ].filter(([, expression]) => expression.test(message)).map(([reason]) => reason);
}

function publicSubmissionState(view, current, sessionId) {
  return {uiSessionMatches: view?.conversationId === sessionId, stateSessionMatches: current?.chat?.sessionId === sessionId,
    documentVisible: view?.documentVisible === true, composerCount: view?.composerCount ?? null,
    buttonCount: view?.buttonCount ?? null, buttonVisible: view?.buttonVisible === true,
    buttonEnabled: view?.buttonEnabled === true, centerHitsButton: view?.centerHitsButton === true,
    inputEnabled: view?.inputEnabled === true, inputCharacters: typeof view?.inputValue === 'string' ? view.inputValue.length : null,
    storedDraftCharacters: typeof current?.chat?.draft === 'string' ? current.chat.draft.length : null,
    busy: current?.busy === true, messageCount: current?.chat?.messages?.length ?? null};
}

export async function waitForEvaluationUI({composer, state, sessionId, wait, now = Date.now, timeoutMs = 15000}) {
  await composer.activate();
  const deadline = now() + timeoutMs;
  let view, current;
  do {
    current = await state(); view = await composer.inspect();
    if (current.chat?.sessionId !== sessionId) throw Error('evaluation_ui_session_changed');
    if (!current.busy && view.conversationId === sessionId && view.documentVisible && view.composerCount === 1 && view.inputEnabled) return;
    await wait(100);
  } while (now() < deadline);
  throw Object.assign(Error('evaluation_ui_not_ready'), {submissionDiagnostics: {stage: 'ui_ready', clickAttempted: false,
    ...publicSubmissionState(view, current, sessionId)}});
}

export async function submitEvaluationTask({composer, state, sessionId, text, wait, now = Date.now, timeoutMs = 15000}) {
  let stage = 'ui_ready', view, current, clickAttempted = false, clickFailed = false, clickReasons = [], fills = 0;
  try {
    await waitForEvaluationUI({composer, state, sessionId, wait, now, timeoutMs});
    current = await state();
    if (current.chat?.sessionId !== sessionId || current.busy || current.chat.messages?.length) throw Error('evaluation_send_not_fresh');
    stage = 'draft_ready';
    await composer.fill(text); fills = 1;
    let deadline = now() + timeoutMs, ready = false, filledAt = now();
    do {
      current = await state(); view = await composer.inspect();
      if (current.chat?.sessionId !== sessionId || view.conversationId !== sessionId) throw Error('evaluation_send_session_changed');
      if (current.busy || current.chat.messages?.length) throw Error('evaluation_send_already_started');
      ready = current.chat.draft === text && view.inputValue === text && view.documentVisible &&
        view.inputEnabled && view.buttonCount === 1 && view.buttonVisible && view.buttonEnabled;
      if (ready) break;
      // The focused composer can receive keystrokes meant for another window. Fill again
      // through the same UI path, at most twice; a lagging stored draft is only waited for.
      if (view.inputValue !== text && view.inputEnabled && fills < 3 && now() - filledAt >= Math.min(1000, timeoutMs / 5)) {
        await composer.fill(text); fills++; filledAt = now();
      }
      await wait(100);
    } while (now() < deadline);
    if (!ready) throw Error('evaluation_draft_not_ready');
    // Exactly one normal UI attempt. A timed-out click can have dispatched, so
    // reconcile the persisted request; never click again or bypass actionability.
    stage = 'send'; clickAttempted = true;
    try {await composer.click();} catch (error) {clickFailed = true; clickReasons = evaluationClickReasons(error);}
    stage = 'acknowledgement'; deadline = now() + timeoutMs;
    do {
      current = await state();
      if (current.chat?.sessionId !== sessionId) throw Error('evaluation_send_session_changed');
      const user = current.chat.messages?.find(message => message.role === 'user' && message.content === text);
      const reply = user && current.chat.messages.slice(current.chat.messages.indexOf(user) + 1).find(message => message.role === 'assistant' && message.id);
      if (user && reply) return {acknowledged: true, clickAttempts: 1, requestId: reply.id,
        ...(fills > 1 ? {draftFills: fills} : {}),
        ...(clickFailed ? {clickReasons, reconciledAfterClickError: true} : {})};
      await wait(100);
    } while (now() < deadline);
    throw Error('evaluation_send_unacknowledged');
  } catch (error) {
    view = await composer.inspect().catch(() => view);
    current = await state().catch(() => current);
    throw Object.assign(Error(/^evaluation_[a-z_]+$/.test(error.message) ? error.message : 'evaluation_submit_failed'), {
      submissionDiagnostics: {stage, clickAttempted, acknowledged: false, clickReasons,
        draftFills: fills, expectedCharacters: text.length,
        ...publicSubmissionState(view, current, sessionId)}});
  }
}
