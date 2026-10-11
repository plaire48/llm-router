// The lifecycle of the Electron host (2026-10-05): one running instance, the window where the user left it, the
// service worker restarted when it dies, and the worker's errors kept for a report. Pure decisions and the supervisor
// live here, without Electron, so that tests/electron-lifecycle.test.mjs can run them under node.
const {EventEmitter}=require('node:events');
const {randomUUID}=require('node:crypto');

const WINDOW_DEFAULTS=Object.freeze({width:1480,height:960,minWidth:620,minHeight:540});
// The part of a saved window that must still be on a display for its position to be kept.
const VISIBLE_WIDTH=160,VISIBLE_HEIGHT=80;
const finite=value=>Number.isFinite(value);
// A saved window state applied to the displays present now: the size within the minimum, the position only when that
// much of the window is on some display (a monitor that is gone leaves the window centered), maximized as it was.
function restoreWindowState(saved,displays=[],defaults=WINDOW_DEFAULTS){
  const state={width:defaults.width,height:defaults.height,maximized:false};
  if(!saved||typeof saved!=='object')return state;
  if(finite(saved.width)&&finite(saved.height)){state.width=Math.max(defaults.minWidth,Math.round(saved.width));state.height=Math.max(defaults.minHeight,Math.round(saved.height));}
  if(finite(saved.x)&&finite(saved.y)){
    const x=Math.round(saved.x),y=Math.round(saved.y);
    const visible=displays.some(display=>{const area=display?.workArea||display?.bounds;if(!area)return false;
      const left=Math.max(x,area.x),top=Math.max(y,area.y),right=Math.min(x+state.width,area.x+area.width),bottom=Math.min(y+state.height,area.y+area.height);
      return right-left>=VISIBLE_WIDTH&&bottom-top>=VISIBLE_HEIGHT;});
    if(visible){state.x=x;state.y=y;}
  }
  state.maximized=saved.maximized===true;
  return state;
}
// What to save of a window: its normal bounds (the size behind a maximized window) and whether it is maximized.
function windowStateOf(window){
  const bounds=window.isMaximized()?window.getNormalBounds():window.getBounds();
  return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,maximized:window.isMaximized()};
}
// Whether a worker that died may start again: up to `limit` unexpected exits in `windowMs`, each later one after a longer
// pause. Beyond the limit the host stops restarting and says so; a worker that keeps dying is a defect, not a hiccup.
function restartDecision(exits,now,{limit=3,windowMs=10*60*1000}={}){
  const recent=exits.filter(at=>now-at<windowMs);
  if(recent.length>limit)return {restart:false,delayMs:0,recent:recent.length};
  return {restart:true,delayMs:Math.min(5000,500*2**(recent.length-1)),recent:recent.length};
}
// The service worker behind the window: started, asked, restarted. `spawn` returns a forked child (connected, send, on,
// kill, disconnect). In-flight requests of a dead worker are rejected (their effect is unknown: a receipt lookup, not a
// replay, is the recovery); requests that arrive while the worker restarts wait for it.
class WorkerSupervisor extends EventEmitter{
  constructor({spawn,timeoutMs=240000,restartWaitMs=15000,now=Date.now,schedule=(fn,ms)=>setTimeout(fn,ms),onMessage=()=>{}}){
    super();this.spawn=spawn;this.timeoutMs=timeoutMs;this.restartWaitMs=restartWaitMs;this.now=now;this.schedule=schedule;this.onMessage=onMessage;
    this.child=null;this.pending=new Map();this.exits=[];this.stopping=false;this.generation=0;this.ready=null;this.failed=false;
  }
  start(){
    const child=this.spawn();this.child=child;const generation=++this.generation;this.failed=false;this.ready=null;
    child.on('message',message=>{
      const request=message&&this.pending.get(message.id);
      if(!request){this.onMessage(message,child);return;}
      clearTimeout(request.timer);this.pending.delete(message.id);
      message.error?request.reject(new Error(message.error)):request.resolve(message.result);
    });
    child.on('error',()=>this.emit('fault',{component:'worker',reason:'launch-failed'}));
    child.on('exit',(exitCode,signal)=>{
      if(this.child!==child)return;
      this.child=null;
      for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('host_disconnected'));}
      this.pending.clear();
      if(this.stopping||exitCode===0&&!signal){this.emit('exit',{exitCode,signal,expected:true});return;}
      this.emit('fault',{component:'worker',exitCode,reason:signal?'killed':'abnormal-exit'});
      this.exits.push(this.now());
      const decision=restartDecision(this.exits,this.now());
      if(!decision.restart){this.failed=true;this.emit('failed',{exitCode,signal,restarts:decision.recent-1});return;}
      this.emit('restarting',{exitCode,signal,delayMs:decision.delayMs,restarts:decision.recent});
      let settle;this.ready=new Promise(resolve=>{settle=resolve;});this.ready.generation=generation;
      this.schedule(()=>{if(this.stopping||this.generation!==generation){settle();return;}this.start();this.emit('restarted',{restarts:decision.recent});settle();},decision.delayMs);
    });
    return child;
  }
  async invoke(method,args={}){
    if(this.ready&&!this.child){
      const wait=this.ready;let timer;
      await Promise.race([wait,new Promise(resolve=>{timer=this.schedule(resolve,this.restartWaitMs);})]);clearTimeout(timer);
    }
    const child=this.child;
    if(!child?.connected)throw new Error('host_disconnected');
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('host_timeout'));},this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer});child.send({id,method,args});
    });
  }
  send(message){if(this.child?.connected)this.child.send(message);}
  // Asks the worker to leave (it disposes and exits on disconnect) and kills it when it has not left in `graceMs`.
  // Resolves when the worker has exited: the project store's lock is released with the process, so a quit that waits
  // for this lets an immediate relaunch open the same project (quit-relaunch race seen in the lifecycle check, 2026-10-07).
  stop({graceMs=2500}={}){
    this.stopping=true;const child=this.child;if(!child)return Promise.resolve();
    try{child.disconnect();}catch{}
    return new Promise(resolve=>{
      const timer=this.schedule(()=>{if(this.child===child||child.exitCode===null&&!child.killed)child.kill();},graceMs);
      child.once('exit',()=>{clearTimeout(timer);resolve();});
    });
  }
}
// A text log that never grows past `maxBytes`: when it does, the file becomes `.1` and a new file starts. Secrets are
// never written here by the host: the worker's stderr is what it prints on its own.
function boundedLog({file,maxBytes=2*1024*1024,fs=require('node:fs')}){
  let size=null,queue=Promise.resolve();
  return text=>{queue=queue.then(async()=>{
    try{
      if(size===null)size=await fs.promises.stat(file).then(stat=>stat.size,()=>0);
      const chunk=Buffer.from(String(text));
      if(size+chunk.length>maxBytes){await fs.promises.rename(file,file+'.1').catch(()=>{});size=0;}
      await fs.promises.appendFile(file,chunk,{mode:0o600});size+=chunk.length;
    }catch{}
  });return queue;};
}
// The startup prompt "메일을 연결해 주세요" is shown only when automatic mail summaries are on and no account is connected
// (user decision 2026-10-05). A user without mail, or with mail connected, is not asked at every start.
function startupMailPrompt(status){return status?.autoWiki===true&&status.connected!==true;}
module.exports={WINDOW_DEFAULTS,restoreWindowState,windowStateOf,restartDecision,WorkerSupervisor,boundedLog,startupMailPrompt};
