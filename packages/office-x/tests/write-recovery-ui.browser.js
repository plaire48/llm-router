async(page)=>{
 const results=[];
 for(const app of ['excel','word','powerpoint']){
  const ctx=await page.context().browser().newContext({viewport:{width:320,height:700}}),p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(app=>{const ls=[];window.sent=[];window.emit=m=>ls.forEach(f=>f({data:m}));window.chrome={webview:{addEventListener:(_,f)=>ls.push(f),postMessage:m=>{sent.push(m);if(m.type==='ready')queueMicrotask(()=>{emit({type:'host',app,version:'0.8.14'});emit({type:'provider_state',state:{provider:'claude',connected:true,model:'sonnet',models:[{id:'sonnet',label:'Sonnet'}]}});});}}};},app);
  await p.goto('http://127.0.0.1:4178/index.html');await p.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  await p.evaluate(app=>{emit({type:'handoff',app,conversationId:'hitl',runId:'run',request:'문서를 작성해줘',text:'문서에 내용을 입력했습니다. 결과를 확인합니다.',running:true});emit({type:'receipt',runId:'run',receipt:{kind:'office_operations',status:'partial',mutated:true,completedWrites:1,nativeCode:'0x800A03EC',checkpoint:{available:false}}});emit({type:'question',kind:'write_recovery',runId:'run',questionId:'q1',detail:'현재 문서를 다시 읽었습니다. 이어가면 남은 변경안을 확인받고 적용합니다.',questions:[{id:'writeRecovery',options:['현재 상태에서 이어가기','다시 확인','여기서 마치기']}]});},app);
  await p.getByRole('button',{name:'현재 상태에서 이어가기',exact:true}).waitFor();
  if(await p.getByText('이 변경의 복원 사본은 없습니다.',{exact:true}).count())throw Error('duplicate backup warning');
  if(await p.getByText('실제 적용 여부를 확인하지 못했습니다. 입력 완료로 판정하지 않았습니다.').count())throw Error('verbose warning');
  if(await p.locator('.receipt').count())throw Error('partial receipt competes with HITL card');
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('horizontal overflow');
  if(app==='excel')await p.screenshot({path:'/Users/ganadi/Documents/office_x/verification/write-recovery-0.8.14.png'});
  await p.getByRole('button',{name:'현재 상태에서 이어가기',exact:true}).click();
  const answer=await p.evaluate(()=>sent.filter(m=>m.type==='answer_question'));
  if(answer.length!==1||answer[0].questionId!=='q1'||answer[0].answers.writeRecovery!=='현재 상태에서 이어가기')throw Error('wrong answer');
  if(!await p.getByRole('button',{name:'현재 상태에서 이어가기',exact:true}).isDisabled())throw Error('double submit enabled');
  await p.evaluate(()=>{emit({type:'question_closed',runId:'run'});emit({type:'write_recovery_resumed',runId:'run'});emit({type:'receipt',runId:'run',receipt:{kind:'office_operations',status:'verified',mutated:true,count:1}});emit({type:'done',runId:'run',result:{text:'남은 작업을 처리했습니다.'}});});
  await p.getByText('적용됨',{exact:true}).waitFor();if(await p.getByText('문서 상태 확인이 필요합니다.',{exact:true}).count())throw Error('stale warning');
  if(errors.length)throw Error(errors.join('\n'));results.push({app,waitingCard:true,oneClick:true,noOverflow:true,noDuplicateWarning:true});await ctx.close();
 }
 return {passed:true,scope:'mock WebView host, not actual Office',results};
}
