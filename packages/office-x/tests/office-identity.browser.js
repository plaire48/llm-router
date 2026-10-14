async(page)=>{
 const reports=[];const failures=[];
 for(const width of [320,420])for(const scale of [1,1.5]){
  let excel;
  for(const app of ['excel','word','powerpoint']){
   const context=await page.context().browser().newContext({viewport:{width,height:860},deviceScaleFactor:scale});const p=await context.newPage();await p.emulateMedia({reducedMotion:'reduce'});
   await p.addInitScript(({app})=>{
    const listeners=[];const emit=m=>listeners.forEach(f=>f({data:m}));window.fixture={emit};
    window.chrome={webview:{addEventListener:(_,fn)=>listeners.push(fn),postMessage:m=>{
     if(m.type==='ready')setTimeout(()=>{emit({type:'host',app,version:'0.4.0'});emit({type:'provider_state',state:{connected:true,provider:'claude',model:'sonnet',models:[{id:'sonnet',label:'Sonnet'}],providers:[{id:'claude',connected:true}],catalogs:[]}});},0);
     if(m.type==='start'){emit({type:'started',runId:'identity'});emit({type:'done',runId:'identity',result:{text:'**핵심 내용**을 확인했습니다.\n\n같은 누비 Agent 화면입니다.'}});}
    }}};
   },{app});
   const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.goto('http://127.0.0.1:4178/index.html');await p.getByRole('textbox',{name:'메시지',exact:true}).fill('같은 누비 화면 확인');await p.getByRole('button',{name:'보내기',exact:true}).click();await p.getByText('핵심 내용',{exact:true}).waitFor();await p.evaluate(()=>document.fonts.ready);
   await p.mouse.move(0,0);await p.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));for(const animation of document.getAnimations()){if(Number.isFinite(animation.effect.getComputedTiming().iterations))animation.finish();}});
   const styles=await p.evaluate(()=>{
    const selectors=['.office-agent-identity','.office-content','.nubi-user-bubble','.assistant .message-body','.assistant .message-body strong','.office-permission-row','.document-context','.nubi-composer-surface','.aipro-message-input','.model-trigger','[aria-label="보내기"]'];
    const props=['fontFamily','fontSize','fontWeight','lineHeight','color','backgroundColor','borderRadius'];
    return Object.fromEntries(selectors.map(selector=>{const style=getComputedStyle(document.querySelector(selector));return [selector,Object.fromEntries(props.map(k=>[k,style[k]]))];}));
   });
   if(!excel)excel=styles;else if(JSON.stringify(styles)!==JSON.stringify(excel))failures.push({app,width,scale,styles,excel});
   if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))failures.push({app,width,scale,overflow:true});
   if(errors.length)failures.push({app,errors});
   if(width===420&&scale===1)await p.screenshot({path:'/Users/ganadi/Documents/office_x/verification/'+app+'-identity.png'});
   reports.push({app,width,scale,properties:77,styles});await context.close();
  }
 }
 if(failures.length)throw Error(JSON.stringify(failures));
 return {passed:true,states:reports.length,propertiesPerState:77,comparison:'Word and PowerPoint against Excel, shared CSS fixture only',reports};
}
