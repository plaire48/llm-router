// Serialized in the evaluation UI. Progress markdown is not the final answer.
export function inspectEvaluationDelivery({conversationId, requestId}) {
  const form=document.querySelector('form.composer');
  const messages=[...document.querySelectorAll('.message-assistant')];
  const message=messages.at(-1);
  const body=message?.querySelector(':scope > .message-body');
  const plan=[...document.querySelectorAll('.task-plan')].at(-1);
  const visible=!!body?.getClientRects().length && getComputedStyle(body).visibility!=='hidden';
  return {identityVersion:1,conversationMatches:form?.dataset.conversationId===conversationId,
    requestMatches:message?.hasAttribute('data-message-id') ? message.dataset.messageId===requestId : null, documentVisible:!document.hidden,
    answerVisible:message?.dataset.state==='done' && visible && !!body.innerText.trim(),
    answerCharacters:body?.innerText.trim().length||0,
    planTotal:plan?.querySelectorAll(':scope > details[data-plan-overview] > ol > li').length||0,
    planCompleted:plan?.querySelectorAll(':scope > details[data-plan-overview] > ol > li[data-status="completed"]').length||0,
    runningPlanIndicators:plan?.querySelectorAll('.status-spinner').length||0};
}
export function renderedDeliveryMatches(view, planLength) {
  return view.conversationMatches && view.requestMatches && view.documentVisible && view.answerVisible &&
    planLength>0 && view.planTotal===planLength && view.planCompleted===planLength && view.runningPlanIndicators===0;
}
export async function waitForEvaluationDelivery({ui,conversationId,requestId,planLength,timeoutMs=5000}) {
  // Nubi refreshes a background view on re-entry. Observe it in the foreground
  // rather than treating the stored done event as a rendered completion.
  await ui.bringToFront();
  const deadline=Date.now()+timeoutMs;let view;
  do {
    view=await ui.evaluate(inspectEvaluationDelivery,{conversationId,requestId});
    if(renderedDeliveryMatches(view,planLength))return {...view,renderSettled:true};
    if(Date.now()>=deadline)break;
    await ui.waitForTimeout(100);
  }while(true);
  return {...view,renderSettled:false};
}
