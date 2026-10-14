async page=>{
 const results=[];
 for(const app of ['excel','word','powerpoint'])for(const approved of [false,true]){
  const context=await page.context().browser().newContext({viewport:{width:320,height:700}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  try{
   await p.addInitScript(app=>{const listeners=[];window.sent=[];window.emit=m=>listeners.forEach(f=>f({data:m}));window.chrome={webview:{addEventListener:(_,f)=>listeners.push(f),postMessage:m=>{sent.push(m);if(m.type==='ready')setTimeout(()=>{emit({type:'host',app,version:'0.8.17'});emit({type:'provider_state',state:{provider:'claude',connected:true,initializing:false,model:'sonnet',models:[{id:'sonnet',label:'Sonnet'}]}});},0);if(m.type==='context')emit({type:'reply',id:m.id,result:{}});}}};},app);
   await p.goto('http://127.0.0.1:4178/index.html');await p.getByRole('button',{name:'보내기',exact:true}).waitFor();await p.getByRole('img',{name:'누비 Agent',exact:true}).waitFor();
   await p.evaluate(app=>emit({type:'handoff',app,conversationId:'cp-session',runId:'cp-run',request:'현재 문서 수정',text:'',running:true}),app);
   await p.getByText('현재 문서 수정',{exact:true}).waitFor();
   await p.evaluate(()=>emit({type:'review',runId:'cp-run',planId:'cp-plan',checkpoint:{available:false},plan:{kind:'office_operations',summary:'셀과 본문에 내용을 입력합니다.',steps:[{target:'text',action:'set',member:'Text',value:'작성 내용'}]}}));
   await p.getByText('복원 사본 없이 적용됩니다.',{exact:true}).waitFor();await p.getByRole('button',{name:approved?'복원 사본 없이 적용':'적용 안 함',exact:true}).click();
   const decision=await p.evaluate(()=>sent.filter(m=>m.type==='approve').at(-1));if(decision.approved!==approved)throw Error('approval choice mismatch');
   await p.evaluate(approved=>{emit({type:'review_closed'});emit({type:'receipt',runId:'cp-run',receipt:{kind:'office_operations',status:approved?'verified':'rejected',document:'업무 양식',mutated:approved,count:1,checkpoint:{available:false}}});},approved);
   await p.waitForTimeout(100);if(!await p.locator('.receipt').count())throw Error('no receipt: '+await p.locator('body').innerText()+' ERRORS '+JSON.stringify(errors));await p.getByText(approved?'적용됨':'변경 안 함',{exact:true}).waitFor();
   await p.locator('details.tool-errors summary').click();await p.getByText('복원 사본 없음',{exact:true}).waitFor();await p.locator('details.tool-errors summary').click();
   if((await p.locator('.topbar').innerText()).includes('누비 Agent'))throw Error('text identity remains');if((await p.locator('details.tool-errors summary').innerText()).trim())throw Error('details not icon-only');if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('horizontal overflow');
   await p.evaluate(()=>emit({type:'tool_executed',runId:'cp-run',data:{name:'create_document',isError:true,output:JSON.stringify({error:'document_content_invalid',inputPath:'sheets[0].rows[1][2]',inputRule:'max_length_2000',invocationStarted:false})}}));
   await p.locator('details.tool-errors summary').click();await p.getByText('1번째 시트 2행 3열: 한 번에 2000자까지 작성할 수 있습니다. 아직 문서를 변경하지 않았습니다.',{exact:true}).waitFor();await p.getByRole('button',{name:'문서 작업 오류 복사',exact:true}).waitFor();
   if(errors.length)throw Error(errors.join('\n'));if(app==='excel'&&approved)await p.screenshot({path:'/Users/ganadi/Documents/office_x/verification/icons-receipt-0.8.17.png'});results.push({app,approved,backupDisclosed:true,receiptVerified:true,iconIdentity:true,accessibleDetails:true});
  }finally{await context.close();}
 }
 return {passed:true,scope:'mock WebView, not real Office',results};
}
