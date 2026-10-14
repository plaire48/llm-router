async page=>{
 const results=[];
 for(const app of ['excel','word','powerpoint'])for(const width of [320,420]){
  const context=await page.context().browser().newContext({viewport:{width,height:700}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(app=>{const listeners=[];window.sent=[];window.emit=m=>listeners.forEach(f=>f({data:m}));window.chrome={webview:{addEventListener:(_,f)=>listeners.push(f),postMessage:m=>{sent.push(m);if(m.type==='ready')queueMicrotask(()=>{emit({type:'host',app,version:'0.8.15'});emit({type:'permission_state',mode:'confirm'});emit({type:'provider_state',state:{provider:'claude',connected:true,model:'sonnet',models:[{id:'sonnet',label:'Sonnet'}]}});});if(m.type==='permission')emit({type:'permission_state',mode:m.mode});if(m.type==='context')emit({type:'reply',id:m.id,result:{}});}}};},app);
  await p.goto('http://127.0.0.1:4178/index.html');await p.getByRole('button',{name:'작업 권한: 매번 확인',exact:true}).click();
  const menu=p.getByRole('menu',{name:'작업 권한'});await menu.waitFor();await p.getByRole('menuitemradio',{name:/자동 적용/}).click();
  await p.getByRole('button',{name:'작업 권한: 자동 적용',exact:true}).waitFor();
  if(await menu.count())throw Error('menu remains open');
  await p.getByRole('button',{name:'작업 권한: 자동 적용'}).click();await p.waitForFunction(()=>document.activeElement.getAttribute('role')==='menuitemradio');await p.keyboard.press('Home');await p.keyboard.press('Enter');await p.getByRole('button',{name:'작업 권한: 읽기 전용'}).waitFor();
  await p.getByRole('button',{name:'작업 권한: 읽기 전용'}).click();await menu.waitFor();await p.waitForFunction(()=>document.activeElement.getAttribute('role')==='menuitemradio');await p.keyboard.press('Escape');await menu.waitFor({state:'hidden'});if(!await p.getByRole('button',{name:'작업 권한: 읽기 전용'}).evaluate(el=>el===document.activeElement))throw Error('focus not restored');
  await p.getByRole('button',{name:'작업 권한: 읽기 전용'}).click();await menu.waitFor();await p.waitForFunction(()=>document.activeElement.getAttribute('role')==='menuitemradio');
  const box=await menu.boundingBox();if(box.x<0||box.y<0||box.x+box.width>width)throw Error('menu overflow');
  if(app==='excel'&&width===420)await p.screenshot({path:'/Users/ganadi/Documents/office_x/verification/permissions-0.8.15.png'});
  await p.keyboard.press('Escape');await menu.waitFor({state:'hidden'});await p.getByRole('textbox',{name:'메시지',exact:true}).fill('이 문서를 읽어줘');
  await p.evaluate(()=>emit({type:'session_busy',busy:true}));await p.waitForFunction(()=>document.querySelector('[aria-label=보내기]').disabled);if(!await p.getByRole('button',{name:'보내기',exact:true}).isDisabled())throw Error('second window can start concurrent write');if(!await p.getByRole('button',{name:'작업 권한: 읽기 전용'}).isDisabled())throw Error('mode changes mid run');
  await p.evaluate(()=>emit({type:'session_busy',busy:false}));await p.waitForFunction(()=>!document.querySelector('[aria-label=보내기]').disabled);if(await p.getByRole('button',{name:'보내기',exact:true}).isDisabled())throw Error('remains locked after other window finished');
  await p.evaluate(app=>emit({type:'handoff',app,conversationId:'existing-session',request:'새 문서 작성',runId:'run',text:'작성했습니다.',running:false}),app);
  await p.getByRole('button',{name:'보내기',exact:true}).waitFor();if(await p.getByText('사용할 모델을 연결하세요.',{exact:true}).count())throw Error('handoff reset provider');
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('page overflow');
  if(errors.length)throw Error(errors.join('\n'));results.push({app,width,permissionSelection:true,keyboard:true,busyGate:true,handoffKeepsUiProvider:true});await context.close();
 }
 return {passed:true,scope:'browser mock host, not actual Office or live login',results};
}
