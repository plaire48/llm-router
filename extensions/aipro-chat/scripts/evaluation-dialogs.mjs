// The evaluator observes product-owned dialogs. It must not answer them.
// Installing a listener disables Playwright's implicit auto-dismiss, which can
// race another CDP client or Nubi's own dialog/HITL handler.
export function observeEvaluationDialogs(context, events = []) {
  const listener = dialog => {
    events.push({at: new Date().toISOString(), type: dialog.type(), action: 'observed_only'});
    if (events.length > 100) events.splice(0, events.length - 100);
  };
  context.on('dialog', listener);
  return () => context.off('dialog', listener);
}
