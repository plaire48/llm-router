async(page)=>{
 const fixtures=await (await page.request.get('http://127.0.0.1:4182/native-wire.json')).json();
 const results=[];
 for(const packet of fixtures){
  const ctx=await page.context().browser().newContext({viewport:{width:360,height:760}});const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(packet=>{const listeners=[];window.sent=[];window.emit=m=>listeners.forEach(f=>f({data:m}));const provider={provider:'claude',connected:true,initializing:false,model:'sonnet',models:[{id:'sonnet',label:'Sonnet'}]};window.chrome={webview:{addEventListener:(_,fn)=>listeners.push(fn),postMessage:m=>{window.sent.push(m);if(m.type==='ready')setTimeout(()=>{window.emit({type:'host',app:packet.app,version:'0.7.1'});window.emit({type:'provider_state',state:provider});},0);if(m.type==='start'){window.emit({type:'started',runId:'native-run'});window.emit(packet.review);}if(m.type==='approve'){window.emit({type:'review_closed'});window.emit(packet.receipt);window.emit({type:'done',runId:'native-run',result:{text:'생성을 확인했습니다.'}});}}}};},{...packet});
  await p.goto('http://127.0.0.1:4178/index.html');await p.locator('textarea').fill('새 문서 만들어줘');await p.getByRole('button',{name:'보내기',exact:true}).click();await p.getByText('새 문서를 만들까요?',{exact:true}).waitFor();
  await p.getByRole('button',{name:'변경 적용',exact:true}).click();await p.getByText('새 문서 생성 확인',{exact:true}).waitFor();await p.getByText('생성을 확인했습니다.',{exact:true}).waitFor();
  const sent=await p.evaluate(()=>window.sent);if(sent.filter(m=>m.type==='approve').length!==1||!sent.some(m=>m.type==='ui_rendered'))throw Error('approval/paint acknowledgement missing');if(errors.length)throw Error(errors.join('\n'));
  results.push({app:packet.app,csharpPlanAndReceipt:true,approvalOnce:true});await ctx.close();
 }
 // Invalid host contracts must never erase the entire pane. Re-opening restores
 // the pending review via ready; it must not submit a document creation again.
 const ctx=await page.context().browser().newContext();const p=await ctx.newPage();const packet=fixtures[0];
 await p.addInitScript(packet=>{const listeners=[];window.sent=[];window.emit=m=>listeners.forEach(f=>f({data:m}));window.chrome={webview:{addEventListener:(_,f)=>listeners.push(f),postMessage:m=>{window.sent.push(m);if(m.type==='ready')setTimeout(()=>{window.emit({type:'provider_state',state:{connected:true,initializing:false,model:'sonnet',models:[]}});if(sessionStorage.failed){window.emit({type:'handoff',app:'excel',conversationId:'recovered',runId:'native-run',request:'새 문서 만들기',text:'',running:true});window.emit(packet.review);}else{sessionStorage.failed='true';window.emit({type:'handoff',app:'excel',conversationId:'recovered',runId:'native-run',request:'새 문서 만들기',text:'',running:true});window.emit({type:'review',runId:'native-run',plan:{Kind:'create_document',Content:{}}});}},0);}}};},packet);
 await p.goto('http://127.0.0.1:4178/index.html');await p.getByText('Agent 화면을 다시 열어주세요',{exact:true}).waitFor();await p.getByRole('button',{name:'화면 다시 열기',exact:true}).click();await p.getByText('새 문서를 만들까요?',{exact:true}).waitFor();const sent=await p.evaluate(()=>window.sent);if(sent.some(m=>['start','approve'].includes(m.type)))throw Error('screen recovery replayed a document operation');
 await p.evaluate(()=>window.emit({type:'handoff',app:'excel',request:null,conversationId:null,runId:null,running:false}));await p.locator('textarea').waitFor();if(!(await p.locator('#root').innerText()).trim())throw Error('empty root after null handoff');results.push({malformedReviewVisibleRecovery:true,recoveryWithoutWrites:true,nullHandoff:true});await ctx.close();
 return {scope:'actual C# serialized packets and WebView bridge fixture; no Office COM',results};
}
