async (page) => {
 const results=[];
 for(const app of ['excel','word','powerpoint']){
  const context=await page.context().browser().newContext({viewport:{width:320,height:700}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(app=>{const listeners=[];window.sent=[];window.emit=m=>listeners.forEach(f=>f({data:m}));window.chrome={webview:{addEventListener:(_,f)=>listeners.push(f),postMessage:m=>{window.sent.push(m);if(m.type==='ready')queueMicrotask(()=>{emit({type:'host',app,version:'0.8.4'});emit({type:'provider_state',state:{provider:'claude',connected:true,model:'sonnet',models:[{id:'sonnet',label:'Sonnet'}]}});});}}};},app);
  await p.goto('http://127.0.0.1:4178/index.html');await p.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  if((await p.locator('.topbar').innerText()).includes('누비 Agent'))throw Error('header title still visible');
  for(const approved of [false,true]){
   await p.evaluate(app=>{emit({type:'handoff',app,conversationId:'cp-session',runId:'cp-run',request:'현재 문서 수정',text:'',running:true});emit({type:'started',runId:'cp-run'});emit({type:'review',runId:'cp-run',planId:'cp-plan',checkpoint:{available:false,error:'checkpoint_copy_unavailable',failedMember:'SaveCopyAs',nativeCode:'0x800A03EC'},plan:{kind:'office_operations',summary:'셀과 본문에 내용을 입력합니다.',steps:[{target:'text',action:'set',member:'Text',value:'작성 내용'}]}});},app);
   await p.getByText('복원 사본을 만들지 못했습니다. 적용하면 이 변경을 누비에서 복원할 수 없습니다.',{exact:true}).waitFor();
   if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('approval overflow at 320px');
   await p.getByRole('button',{name:approved?'복원 사본 없이 적용':'적용 안 함',exact:true}).click();
   const decision=await p.evaluate(()=>sent.filter(m=>m.type==='approve').at(-1));if(decision.approved!==approved)throw Error('approval choice mismatch');
   await p.evaluate(approved=>{emit({type:'review_closed'});emit({type:'receipt',runId:'cp-run',receipt:{kind:'office_operations',status:approved?'verified':'rejected',mutated:approved,count:1,checkpoint:{available:false}}});emit({type:'done',runId:'cp-run',result:{text:approved?'입력 내용을 확인했습니다.':'변경하지 않았습니다.'}});},approved);
  }
  await p.getByText('이 변경의 복원 사본은 없습니다.',{exact:true}).waitFor();
  await p.evaluate(()=>{emit({type:'started',runId:'cp-run'});emit({type:'tool_executed',runId:'cp-run',data:{name:'create_document',isError:true,output:JSON.stringify({error:'document_content_invalid',inputPath:'sheets[0].rows[1][2]',inputRule:'max_length_2000',invocationStarted:false})}});});
  await p.getByText('1번째 시트 2행 3열: 한 번에 2000자까지 작성할 수 있습니다. 아직 문서를 변경하지 않았습니다.',{exact:true}).waitFor();
  if(errors.length)throw Error(errors.join('\n'));results.push({app,headerTextRemoved:true,copyFailureDisclosed:true,rejectionPreserved:true,explicitApproval:true,receiptShowsNoBackup:true,validationLocationVisible:true});await context.close();
 }
 return {passed:true,scope:'browser with mock WebView host; not real Office or live Claude',results};
}
