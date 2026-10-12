async(page)=>{
 const results=[];
 for(const app of ['excel','word','powerpoint'])for(const kind of ['create_document','office_operations']){
  const ctx=await page.context().browser().newContext({viewport:{width:360,height:760},reducedMotion:'reduce'});const p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  await p.addInitScript(({app,kind})=>{const listeners=[];const emit=m=>listeners.forEach(fn=>fn({data:m}));window.sent=[];window.chrome={webview:{addEventListener:(_,fn)=>listeners.push(fn),postMessage:m=>{window.sent.push(m);
   if(m.type==='ready')setTimeout(()=>{emit({type:'host',app,version:'0.5.0'});emit({type:'provider_state',state:{provider:'claude',connected:true,initializing:false,models:[{id:'sonnet',label:'Sonnet'}],model:'sonnet',providers:[{id:'claude',connected:true}],catalogs:[]}});},0);
   if(m.type==='start'){emit({type:'started',runId:'create-run',target:app});const content=app==='word'?{title:'주간 보고서',paragraphs:[{style:'Title',text:'주간 보고서'},{rows:[['현황','계획'],['진행 중','다음 주 검토']]}]}:app==='powerpoint'?{title:'프로젝트 착수',slides:[{title:'목적',body:['문서 작업의 효율 향상']},{title:'다음 단계',body:['검토 및 실행']}]}:{title:'매출 관리',sheets:[{name:'분기 매출',rows:[['분기','매출'],['1분기','1000']]}]};emit({type:'review',runId:'create-run',planId:'plan',target:app,plan:kind==='create_document'?{kind,content}:{kind,summary:'문서 내용을 수정하고 제목에 강조 서식을 적용합니다.',steps:[{target:'본문',action:'set',member:'Text',value:'핵심 내용을 정리했습니다.'},{target:'제목',action:'set',member:'Bold',value:true}]}});}
   if(m.type==='approve'){emit({type:'review_closed'});emit({type:'receipt',runId:'create-run',receipt:{kind,status:m.approved?'verified':'rejected',count:2,document:kind==='create_document'?'새 문서':null,saved:false}});emit({type:'done',runId:'create-run',result:{text:'내용을 확인했습니다.'}});}
  }}};},{app,kind});
  await p.goto('http://127.0.0.1:4178/index.html');await p.locator('textarea').fill('문서를 작성해줘');await p.getByRole('button',{name:'보내기',exact:true}).click();
  await p.getByText(kind==='create_document'?'새 문서를 만들까요?':'문서에 적용할까요?',{exact:true}).waitFor();
  if(kind==='office_operations')await p.getByText('변경 내용 확인',{exact:true}).click();
  if(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error(app+' horizontal overflow');
  await p.screenshot({path:'/Users/ganadi/Documents/office_x/verification/'+app+'-'+kind+'.png'});
  await p.getByRole('button',{name:'변경 적용',exact:true}).click();await p.getByText(kind==='create_document'?'새 문서 생성 확인':'문서 변경 확인',{exact:true}).waitFor();
  if(errors.length)throw Error(errors.join('\n'));const msg=await p.evaluate(()=>window.sent.find(m=>m.type==='approve'));if(msg.planId!=='plan')throw Error('approval binding');results.push({app,kind,passed:true});await ctx.close();
 }
 return {scope:'mock WebView host, not Office COM',results};
}
