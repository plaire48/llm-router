async (page) => {
 const context=await page.context().browser().newContext({viewport:{width:410,height:800}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.addInitScript(()=>{
  const listeners=[];window.sent=[];window.emit=m=>listeners.forEach(f=>f({data:structuredClone(m)}));window.failLogin=true;window.failCatalog=true;
  let state={provider:'claude',connected:false,initializing:false,model:'',models:[],providers:[{id:'claude',connected:false},{id:'aipro',connected:false}],catalogs:[]};
  const connect=provider=>{state={...state,provider,connected:true,model:provider+'-fixture',models:[{id:provider+'-fixture',label:'테스트 모델'}],providers:[{id:provider,connected:true,connectionId:1}],catalogs:[{provider,model:provider+'-fixture',models:[{id:provider+'-fixture',label:'테스트 모델'}]}]};};
  window.connectAIPro=()=>{connect('aipro');emit({type:'provider_state',state});};
  window.chrome={webview:{addEventListener:(_,f)=>listeners.push(f),postMessage:m=>{sent.push(m);if(m.type==='ready')queueMicrotask(()=>emit({type:'provider_state',state}));if(m.type==='provider'){
   if(m.method==='login'&&window.failLogin){window.failLogin=false;queueMicrotask(()=>emit({type:'reply',id:m.id,error:'network_timeout',operation:'login'}));return;}
   if(m.method==='login')connect(m.input);
   if(m.method==='refreshModels'&&m.input.silent&&window.failCatalog){window.failCatalog=false;queueMicrotask(()=>emit({type:'reply',id:m.id,error:'network_error',operation:'refreshModels'}));return;}
   queueMicrotask(()=>{emit({type:'provider_state',state});emit({type:'reply',id:m.id,result:state});});
  }}}};
 });
 await p.goto('http://127.0.0.1:4178/index.html');await p.getByRole('button',{name:'Claude',exact:true}).click();
 await p.getByText('계정 연결: 서버 응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.',{exact:true}).waitFor();
 if(!(await p.getByRole('button',{name:'Claude',exact:true}).isEnabled()))throw Error('login cannot be retried');
 await p.getByRole('button',{name:'Claude',exact:true}).click();await p.getByRole('textbox',{name:'메시지',exact:true}).fill('현재 문서를 읽어줘');
 if(await p.getByText('계정 연결: 서버 응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.',{exact:true}).count())throw Error('stale login error after success');
 if(!(await p.getByRole('button',{name:'보내기',exact:true}).isEnabled()))throw Error('send disabled after reconnect');
 await p.evaluate(()=>connectAIPro());await p.getByRole('button',{name:'연결 설정',exact:true}).click();
 await p.getByText('모델 목록 조회: 서버와 연결이 잠깐 끊겼습니다. 다시 시도해 주세요. 기존 모델 목록을 유지했습니다.',{exact:true}).waitFor();
 await p.getByRole('radio',{name:'테스트 모델',exact:true}).waitFor();
 await p.getByRole('button',{name:'모델 목록 새로고침',exact:true}).click();
 await p.getByText('모델 목록 조회: 서버와 연결이 잠깐 끊겼습니다. 다시 시도해 주세요. 기존 모델 목록을 유지했습니다.',{exact:true}).waitFor({state:'detached'});
 await p.getByRole('button',{name:'취소',exact:true}).click();
 if(!(await p.getByRole('button',{name:'보내기',exact:true}).isEnabled()))throw Error('catalog failure disconnected active account');
 if((await p.locator('body').innerText()).includes('모델 연결을 완료하지 못했습니다'))throw Error('generic login error remains');
 if(errors.length)throw Error(errors.join('\n'));await context.close();return {passed:true,scope:'browser with mock WebView host; no real Windows account',loginErrorClassified:true,retryAfterClick:true,successClearsError:true,silentCatalogFailureKeepsModels:true,manualCatalogRefreshClearsWarning:true,sendRemainsAvailable:true};
}
