const errors={claude_cli_missing:'Claude Code를 찾지 못했습니다. PowerShell에서 claude --version을 확인한 뒤 다시 연결해 주세요.',claude_cli_failed:'Claude Code를 찾았지만 실행하지 못했습니다. PowerShell에서 claude --version이 정상 실행되는지 확인해 주세요.',claude_cli_timeout:'Claude Code 실행 시간이 초과됐습니다. PowerShell에서 claude --version을 확인한 뒤 다시 연결해 주세요.',claude_cli_update:'Claude Code 업데이트가 필요합니다. 최신 버전으로 업데이트한 뒤 다시 연결해 주세요.',claude_login_required:'Claude 로그인 후 다시 연결해 주세요.',browser_unavailable:'로그인 브라우저를 열지 못했습니다.',worker_busy:'현재 작업을 마친 뒤 모델을 변경해 주세요.'};
const waiters=new Map();const listeners=new Set();
export const available=!!window.chrome?.webview;
export function send(message){if(!available)throw Error('Excel 작업창에서 열어 주세요.');window.chrome.webview.postMessage(message);}
export function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function command(method,input){return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();const timer=setTimeout(()=>{waiters.delete(id);reject(Error('연결 요청 시간이 초과됐습니다.'));},60000);
  waiters.set(id,{resolve,reject,timer});try{send({type:'provider',id,method,input});}catch(error){clearTimeout(timer);waiters.delete(id);reject(error);}
});}
window.chrome?.webview?.addEventListener('message',event=>{
  const message=event.data;
  if(message.type==='disconnected'){for(const w of waiters.values()){clearTimeout(w.timer);w.reject(Error('Agent 연결이 끊겼습니다.'));}waiters.clear();}
  if(['reply','host_error'].includes(message.type)&&waiters.has(message.id)){
    const w=waiters.get(message.id);clearTimeout(w.timer);waiters.delete(message.id);
    message.error?w.reject(Error(message.type==='host_error'?message.error:errors[message.error]||'모델 연결을 완료하지 못했습니다.')):w.resolve(message.result);
  }
  for(const listener of listeners)listener(message);
});
