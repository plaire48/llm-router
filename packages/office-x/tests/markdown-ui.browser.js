async (page) => {
 const cases=[];
 for(const app of ['excel','word','powerpoint'])for(const viewport of [{width:280,height:480},{width:420,height:760}]){
  const context=await page.context().browser().newContext({viewport}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(app=>{const listeners=[];window.sent=[];window.emit=m=>listeners.forEach(f=>f({data:m}));window.chrome={webview:{addEventListener:(_,f)=>listeners.push(f),postMessage:m=>{sent.push(m);if(m.type==='ready')queueMicrotask(()=>{emit({type:'host',app,version:'0.8.12'});emit({type:'provider_state',state:{provider:'claude',connected:true,model:'sonnet',models:[{id:'sonnet',label:'Sonnet'}]}});});}}};},app);
  await p.goto('http://127.0.0.1:4178/index.html');await p.getByRole('textbox',{name:'메시지',exact:true}).waitFor();
  const destination='C:\\Users\\사용자\\Documents\\'+('긴 폴더 이름\\'.repeat(12))+'보고서.md';
  await p.evaluate(({app,destination})=>{emit({type:'handoff',app,conversationId:'md-cx',runId:'md-run',request:'원문을 Markdown 새 파일로 저장',text:'',running:true});emit({type:'started',runId:'md-run'});emit({type:'review',runId:'md-run',planId:'md-plan',plan:{kind:'file_operation',name:'save_markdown',destination,summary:'Markdown 저장\n'+destination,warnings:['OCR로 읽은 내용은 글자·숫자를 원문과 대조해 주세요.']}});},{app,destination});
  await p.getByText('Markdown을 저장할까요?',{exact:true}).waitFor();await p.getByRole('button',{name:'저장',exact:true}).click();
  if(!(await p.evaluate(()=>sent.findLast(m=>m.type==='approve')?.approved)))throw Error('Save approval not forwarded');
  await p.evaluate(destination=>{emit({type:'review_closed'});emit({type:'receipt',runId:'md-run',receipt:{kind:'save_markdown',status:'partial',saved:true,document:'보고서.md',destination,warnings:['OCR로 읽은 내용은 글자·숫자를 원문과 대조해 주세요.']}});emit({type:'done',runId:'md-run',result:{text:'Markdown 파일을 저장했습니다. OCR 결과를 원문과 확인해 주세요.'}});},destination);
  await p.getByText('저장됨 / 추출 확인 필요',{exact:true}).waitFor();if(await p.getByText('실제 적용 여부를 확인하지 못했습니다. 입력 완료로 판정하지 않았습니다.',{exact:true}).count())throw Error('File persistence confused with document mutation');
  if(await p.getByRole('button',{name:'문서 확인 후 이어서 요청',exact:true}).count())throw Error('OCR review must not replay Office work');
  await p.getByRole('textbox',{name:'메시지',exact:true}).fill('다음 파일 읽기');
  const geometry=await p.evaluate(()=>{const chat=document.querySelector('.conversation'),input=document.querySelector('textarea');return {overflow:document.documentElement.scrollWidth>innerWidth,chatBottom:chat.getBoundingClientRect().bottom,inputTop:input.getBoundingClientRect().top};});if(geometry.overflow||geometry.chatBottom>geometry.inputTop)throw Error('Export CX overlaps or overflows');
  if(errors.length)throw Error(errors.join('\n'));cases.push({app,viewport,saveApproval:true,requestedPathVisible:true,filePersistenceSeparated:true,ocrDisclosure:true,inputUsable:true,geometry});await context.close();
 }
 return {passed:true,scope:'owned browser fixtures, no actual Office or account',cases};
}
