import {providerCommandMessage} from './provider-command-errors.js';
const waiters=new Map();const listeners=new Set();
export const available=!!window.chrome?.webview;
export function send(message){if(!available)throw Error('Excel 작업창에서 열어 주세요.');window.chrome.webview.postMessage(message);}
export function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}
export function command(method,input,type='provider'){return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();const timer=setTimeout(()=>{waiters.delete(id);reject(Object.assign(Error(providerCommandMessage('connection_timeout',method,type)),{code:'connection_timeout',method}));},60000);
  waiters.set(id,{resolve,reject,timer,method,type});try{send({type,id,method,input});}catch(error){clearTimeout(timer);waiters.delete(id);reject(error);}
});}
window.chrome?.webview?.addEventListener('message',event=>{
  const message=event.data;
  if(message.type==='disconnected'){for(const w of waiters.values()){clearTimeout(w.timer);w.reject(Error('Agent 연결이 끊겼습니다.'));}waiters.clear();}
  if(['reply','host_error'].includes(message.type)&&waiters.has(message.id)){
    const w=waiters.get(message.id);clearTimeout(w.timer);waiters.delete(message.id);
    message.error?w.reject(Object.assign(Error(message.type==='host_error'?message.error:providerCommandMessage(message.error,w.method,w.type)),{code:/^[a-z_]{1,64}$/.test(message.error)?message.error:'command_failed',method:w.method})):w.resolve(message.result);
  }
  for(const listener of listeners)listener(message);
});
