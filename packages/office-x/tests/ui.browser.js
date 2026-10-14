async (page) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    // Test-only WebView2 host. Never included in the shipped UI.
    const listeners=[];window.officeFixture={sent:[],receive:message=>listeners.forEach(fn=>fn({data:structuredClone(message)}))};
    const state={provider:'aipro',connected:false,initializing:false,pending:null,models:[],model:'',providers:[{id:'aipro',connected:false},{id:'chatgpt',connected:false},{id:'fabrix',connected:false}],catalogs:[]};
    const emit=m=>window.officeFixture.receive(m);
    function connected(provider='aipro'){Object.assign(state,{provider,connected:true,models:[{id:'fixture-qwen',label:'Qwen · 테스트 모델',contextLength:262144},{id:'fixture-sol',label:'Sol · 테스트 모델',contextLength:128000}],model:'fixture-qwen',reasoningEffort:'medium',reasoningOptions:['low','medium','xhigh'],providers:[{id:'aipro',connected:true,connectionId:1},{id:'chatgpt',connected:false},{id:'fabrix',connected:false}]});state.catalogs=[{provider:'aipro',models:state.models,model:state.model}];}
    window.chrome ||= {};window.chrome.webview={addEventListener:(_,fn)=>listeners.push(fn),postMessage:m=>{
      window.officeFixture.sent.push(m);
      if(m.type==='ready'){window.officeFixture.completeInit=()=>emit({type:'provider_state',state});}
      if(m.type==='provider'){
        if(m.method==='login'){connected(m.input);if(m.input==='claude'){state.models=[{id:'fixture-sonnet',label:'Sonnet · 테스트 모델'},{id:'fixture-opus',label:'Opus · 테스트 모델'}];state.model='fixture-sonnet';state.providers.push({id:'claude',connected:true,connectionId:2});state.catalogs=[{provider:'claude',models:state.models,model:state.model}];}}if(m.method==='model'){state.model=m.input;state.catalogs[0].model=m.input;}
        if(m.method==='reasoning'){if(window.officeFixture.failReasoning){window.officeFixture.failReasoning=false;setTimeout(()=>emit({type:'reply',id:m.id,error:'reasoning_failed'}),5);return;}state.reasoningEffort=m.input;}
        if(m.method==='disconnect')state.connected=false;
        const reply=()=>{emit({type:'provider_state',state});emit({type:'reply',id:m.id,result:state});};if(m.method==='login'&&window.officeFixture.holdLogin)window.officeFixture.finishLogin=reply;else setTimeout(reply,5);
      }
      if(m.type==='inspect')emit({type:'view',running:false,target:'견적서.xlsx / 견적 / C1:E4',status:'선택 범위를 확인했습니다.'});
      if(m.type==='start'){
        emit({type:'started',runId:'fixture-run',conversationId:m.conversationId});
        emit({type:'view',running:true,target:'견적서.xlsx / 견적 / C1:E4',status:'변경안을 확인해 주세요.'});
        emit({type:'text',runId:'fixture-run',data:'선택한 표를 확인했습니다. 빈 금액 셀 3개에 수식을 넣겠습니다.'});
        emit({type:'review',runId:'fixture-run',planId:'fixture-plan',target:'견적서.xlsx / 견적 / C1:E4',plan:{before:{cells:[{address:'C2',value:2},{address:'D2',value:1500}]},operations:[2,3,4].map(r=>({address:'E'+r,formula:'=C'+r+'*D'+r}))}});
      }
      if(m.type==='approve'){
        emit({type:'review_closed'});emit({type:'receipt',runId:'fixture-run',receipt:{status:m.approved?'verified':'rejected',cells:m.approved?[{address:'E2'},{address:'E3'},{address:'E4'}]:[]}});
        emit({type:'done',runId:'fixture-run',result:{text:m.approved?'**금액 열 3개**의 수식과 계산값을 확인했습니다.\n\nExcel에서 저장해 주세요.':'변경을 적용하지 않았습니다.',cancelled:false}});
        emit({type:'view',running:false,target:'견적서.xlsx / 견적 / C1:E4',status:'응답 완료'});
      }
      if(m.type==='cancel'){emit({type:'review_closed'});emit({type:'done',runId:'fixture-run',result:{text:'작업을 중지했습니다.',cancelled:true}});emit({type:'view',running:false,status:'중지됨'});}
    }};
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:410,height:860});await page.goto('http://127.0.0.1:4178/index.html');
  await page.getByRole('button',{name:'Claude',exact:true}).waitFor();
  if(!await page.getByRole('button',{name:'Claude',exact:true}).isDisabled())throw Error('login enabled before host readiness');
  if(await page.evaluate(()=>officeFixture.sent.some(m=>m.type==='provider'&&m.method==='login')))throw Error('automatic login on startup');
  await page.evaluate(()=>officeFixture.completeInit());
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Claude')?.disabled);
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:'/Users/ganadi/Documents/office_x/verification/login.png'});
  await page.getByRole('button',{name:'AI Pro',exact:true}).click();
  await page.getByRole('button',{name:'선택 범위 확인',exact:true}).click();
  await page.getByRole('button',{name:'모델 변경',exact:true}).click();
  await page.getByRole('textbox',{name:'모델 검색',exact:true}).fill('Sol');
  await page.getByRole('radio',{name:'Sol 테스트 모델',exact:true}).click();
  if(await page.evaluate(()=>officeFixture.sent.some(m=>m.method==='model')))throw Error('model was applied before confirmation');
  await page.getByRole('button',{name:'적용',exact:true}).click();
  await page.getByRole('textbox',{name:'모델 검색',exact:true}).waitFor({state:'detached'});
  await page.getByRole('textbox',{name:'메시지',exact:true}).fill('수량과 단가를 곱해서 금액 열을 채워줘.');
  await page.waitForFunction(()=>!document.querySelector('[aria-label=보내기]').disabled);
  // IME composition Enter must not send.
  await page.getByRole('textbox',{name:'메시지',exact:true}).evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true})));
  if(await page.evaluate(()=>window.officeFixture.sent.some(m=>m.type==='start')))throw Error('IME sent too early');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.getByRole('button',{name:'변경 적용',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'메시지',exact:true}).fill('다음 요청을 미리 입력');if((await page.getByRole('textbox',{name:'메시지',exact:true}).inputValue())!=='다음 요청을 미리 입력')throw Error('busy composer locked');
  await page.evaluate(()=>window.officeFixture.receive({type:'text',runId:'fixture-run',data:Array(60).fill('스크롤 동작 확인 문장입니다.').join('\n\n')}));
  await page.waitForFunction(()=>{const v=document.querySelector('.conversation');return v.scrollHeight>v.clientHeight+200&&v.scrollHeight-v.scrollTop-v.clientHeight<25;});
  await page.locator('.conversation').evaluate(v=>{v.scrollTop=0;v.dispatchEvent(new Event('scroll',{bubbles:true}));});
  await page.getByRole('button',{name:'최근 답변으로 이동',exact:true}).click();
  await page.evaluate(()=>window.officeFixture.receive({type:'text',runId:'fixture-run',data:'선택한 표를 확인했습니다. 빈 금액 셀 3개에 수식을 넣겠습니다.'}));
  await page.screenshot({path:'/Users/ganadi/Documents/office_x/verification/chat-review.png'});
  await page.getByRole('button',{name:'변경 적용',exact:true}).click();
  await page.getByText('적용됨',{exact:true}).waitFor();
  await page.screenshot({path:'/Users/ganadi/Documents/office_x/verification/chat-result.png'});
  for(const name of ['새 대화','대화 이력','검색과 이미지 설정','GenOffice 편집기 열기'])if(await page.getByRole('button',{name,exact:true}).count())throw Error('removed header action remains: '+name);
  await page.getByRole('button',{name:'연결 설정',exact:true}).click();
  if(await page.getByRole('button',{name:'계정 변경',exact:true}).count())await page.getByRole('button',{name:'계정 변경',exact:true}).click();await page.getByRole('radio',{name:'Claude',exact:true}).click();
  await page.evaluate(()=>officeFixture.holdLogin=true);
  await page.getByRole('button',{name:'연결',exact:true}).click();
  await page.getByText('Claude 연결 확인 중',{exact:true}).waitFor();
  await page.evaluate(()=>{officeFixture.holdLogin=false;officeFixture.finishLogin();});
  await page.getByRole('radio',{name:'Opus 테스트 모델',exact:true}).click();
  await page.getByRole('button',{name:'적용',exact:true}).click();
  await page.getByRole('textbox',{name:'모델 검색',exact:true}).waitFor({state:'detached'});
  await page.screenshot({path:'/Users/ganadi/Documents/office_x/verification/readability-chat.png'});
  await page.getByRole('button',{name:'추론 정도',exact:true}).click();
  await page.getByRole('slider',{name:'추론 정도',exact:true}).press('ArrowRight');
  await page.waitForFunction(()=>window.officeFixture.sent.some(m=>m.method==='reasoning'&&m.input==='xhigh'));
  await page.getByRole('button',{name:'추론 정도를 기본값으로 되돌리기',exact:true}).click();
  await page.waitForFunction(()=>window.officeFixture.sent.filter(m=>m.method==='reasoning').at(-1)?.input==='medium');
  await page.waitForFunction(()=>{const slider=document.querySelector('.nubi-reasoning-slider');return slider&&!slider.disabled&&slider.getAttribute('aria-valuetext')==='Medium';});
  await page.evaluate(()=>window.officeFixture.failReasoning=true);
  await page.getByRole('slider',{name:'추론 정도',exact:true}).press('ArrowRight');
  await page.waitForFunction(()=>window.officeFixture.sent.filter(m=>m.method==='reasoning').length===3);
  await page.waitForFunction(()=>{const slider=document.querySelector('.nubi-reasoning-slider');return slider&&!slider.disabled&&slider.getAttribute('aria-valuetext')==='Medium';});
  await page.getByRole('button',{name:'추론 창 닫기',exact:true}).click();
  await page.getByText('추론 설정을 완료하지 못했습니다. 다시 시도해 주세요.',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'메시지',exact:true}).fill('중지 동작 확인');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  if(!(await page.getByRole('button',{name:'추론 정도',exact:true}).isDisabled()))throw Error('busy reasoning enabled');
  await page.getByRole('button',{name:'중지',exact:true}).click();
  await page.getByText('중지했습니다. 적용된 변경은 유지됩니다.',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'메시지',exact:true}).fill('변경 거절 확인');
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await page.getByRole('button',{name:'적용 안 함',exact:true}).click();
  await page.getByText('변경 안 함',{exact:true}).waitFor();
  const rejected=await page.locator('.receipt[data-status=rejected]').evaluate(e=>getComputedStyle(e).backgroundColor);
  const verified=await page.locator('.receipt[data-status=verified]').first().evaluate(e=>getComputedStyle(e).backgroundColor);
  if(rejected===verified)throw Error('rejection uses success styling');
  await page.screenshot({path:'/Users/ganadi/Documents/office_x/verification/claude-selected.png'});
  await page.setViewportSize({width:320,height:640});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow)throw Error('horizontal overflow at 320px');
  await page.evaluate(()=>officeFixture.receive({type:'handoff',app:'excel',runId:'old-run',conversationId:'old-session',request:'이전 작업',running:false}));await page.getByRole('textbox',{name:'메시지',exact:true}).fill('재시도');await page.getByRole('button',{name:'보내기',exact:true}).click();await page.evaluate(()=>officeFixture.receive({type:'host_error',operation:'start',error:'시작 오류'}));await page.getByRole('textbox',{name:'메시지',exact:true}).fill('다시 입력 가능');if(await page.getByRole('button',{name:'중지',exact:true}).count())throw Error('startup error left busy lock');await page.getByRole('button',{name:'연결 설정',exact:true}).click();await page.getByRole('button',{name:'취소',exact:true}).click();
  await page.evaluate(()=>{officeFixture.receive({type:'started',runId:'diagnostic-run'});officeFixture.receive({type:'tool_executed',runId:'diagnostic-run',data:{name:'execute_office_operations',isError:true,output:JSON.stringify({error:'office_operation_failed',failedMember:'Font.Bold',nativeCode:'0x800A03EC',failureStage:'execute_step'})}});});
  if(await page.locator('.tool-errors').last().getAttribute('open')!==null)throw Error('raw fault details distract from the answer');await page.locator('.tool-errors').last().locator('summary').click();
  await page.getByText('Font.Bold',{exact:true}).waitFor();
  await page.getByText('office_operation_failed',{exact:true}).waitFor();
  if(errors.length)throw Error(errors.join('\n'));
  return {passed:['login request immediately displays progress','startup login disabled until ready','no automatic login','visible member and HRESULT','provider login fixture','model search and selection','IME composition','native approval payload','typing during a run','startup error unlocks input and clicks','busy send/model mutation guards','verified receipt','simplified header without new/history/image/external buttons','320px layout','Claude login and model picker','stream auto-scroll and latest jump','reasoning apply and reset','reasoning failure rollback','busy reasoning guard and stop','rejected receipt state'],pageErrors:errors};
}
