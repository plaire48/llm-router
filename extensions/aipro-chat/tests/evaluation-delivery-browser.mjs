import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {inspectEvaluationDelivery,renderedDeliveryMatches,waitForEvaluationDelivery} from '../scripts/evaluation-delivery.mjs';
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
try {
 const ui=await browser.newPage();
 const plan='<div class="task-plan"><details data-plan-overview><ol><li data-status="completed">Step</li></ol></details></div>';
 await ui.setContent(`<form class="composer" data-conversation-id="chat"></form><article class="message-assistant" data-message-id="old" data-state="done"><div class="message-body">Previous answer</div></article><article class="message-assistant" data-message-id="request" data-state="done"><section><div class="message-body">Progress only</div></section></article>${plan}`);
 let view=await ui.evaluate(inspectEvaluationDelivery,{conversationId:'chat',requestId:'request'});
 assert.equal(view.answerVisible,false);assert.equal(renderedDeliveryMatches(view,1),false);
 console.log('PASS progress markdown and an earlier final answer cannot establish delivery');
 await ui.evaluate(()=>setTimeout(()=>{const body=document.createElement('div');body.className='message-body';body.textContent='Current final answer';document.querySelectorAll('.message-assistant')[1].append(body);},200));
 view=await waitForEvaluationDelivery({ui,conversationId:'chat',requestId:'request',planLength:1,timeoutMs:1500});
 assert.equal(view.renderSettled,true);assert(view.answerCharacters>0);
 console.log('PASS waits for the exact current message body and completed plan');
 for(const input of [{conversationId:'other',requestId:'request'},{conversationId:'chat',requestId:'old'}])assert.equal(renderedDeliveryMatches(await ui.evaluate(inspectEvaluationDelivery,input),1),false);
 console.log('PASS wrong conversation or request identity cannot pass');
 await ui.evaluate(()=>{document.querySelector('.task-plan li').dataset.status='in_progress';const spinner=document.createElement('span');spinner.className='status-spinner';document.querySelector('.task-plan').append(spinner);});
 view=await waitForEvaluationDelivery({ui,conversationId:'chat',requestId:'request',planLength:1,timeoutMs:200});
 assert.equal(view.answerVisible,true);assert.equal(view.renderSettled,false);assert.equal(view.planCompleted,0);
 console.log('PASS a visible answer cannot conceal an unfinished or spinning plan');
}finally{await browser.close();}
