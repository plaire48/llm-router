async (page) => {
 const results=[];
 for(const app of ['word','powerpoint']){
  const context=await page.context().browser().newContext({viewport:{width:360,height:760}});const p=await context.newPage();
  await p.addInitScript(({app})=>{
   const listeners=[];const emit=m=>listeners.forEach(fn=>fn({data:m}));window.sent=[];
   window.chrome={webview:{addEventListener:(_,fn)=>listeners.push(fn),postMessage:m=>{
    window.sent.push(m);
    if(m.type==='ready')setTimeout(()=>{emit({type:'host',app});emit({type:'provider_state',state:{provider:'claude',connected:true,initializing:false,models:[{id:'sonnet',label:'Sonnet'}],model:'sonnet',providers:[{id:'claude',connected:true}],catalogs:[]}});},0);
    if(m.type==='start'){emit({type:'started',runId:'text-run',target:app+' / 선택한 문장'});emit({type:'review',runId:'text-run',planId:'text-plan',target:app+' / 선택한 문장',plan:{before:{blocks:[{id:'p1',label:'문단 1',text:'이 보고서는 다양한 정보를 전달하고 있습니다.'},{id:'p2',label:'문단 2',text:'두 번째 문단입니다.'}]},operations:[{blockId:'p1',text:'이 보고서는 핵심 정보를 전합니다.'},{blockId:'p2',text:'둘째 문단입니다.'}]}});}
    if(m.type==='approve'){emit({type:'review_closed'});emit({type:'receipt',runId:'text-run',receipt:{status:'verified',count:2,saved:false}});emit({type:'done',runId:'text-run',result:{text:'선택한 문장 변경을 확인했습니다.'}});}
   }}};
  },{app});
  await p.goto('http://127.0.0.1:4178/index.html');await p.getByRole('button',{name:app==='word'?'문단 다듬기':'발표 문구 다듬기',exact:true}).click();await p.getByRole('button',{name:'보내기',exact:true}).click();
  await p.getByText('문단을 바꿀까요?',{exact:true}).waitFor();await p.getByText('이 보고서는 다양한 정보를 전달하고 있습니다.',{exact:true}).waitFor();await p.getByText('이 보고서는 핵심 정보를 전합니다.',{exact:true}).waitFor();
  await p.screenshot({path:'/Users/ganadi/Documents/office_x/verification/'+app+'-review.png'});
  await p.getByRole('button',{name:'변경 적용',exact:true}).click();await p.getByText('문장 변경 확인',{exact:true}).waitFor();
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(app+' horizontal overflow');
  const approval=await p.evaluate(()=>window.sent.find(m=>m.type==='approve'));if(approval.planId!=='text-plan'||approval.runId!=='text-run')throw Error('approval not bound');results.push(app+' before/after approval and receipt');await context.close();
 }
 return {passed:results};
}
