import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Visual-only host channel. This helper has no input injection commands.
export class ComputerPointer {
  constructor({platform=process.platform,launch=spawn}={}){this.platform=platform;this.launch=launch;this.sequence=0;this.pending=new Map();}
  start(){
    if(this.child)return;
    const exe=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    this.child=this.launch(exe,['-NoProfile','-NonInteractive','-STA','-File',fileURLToPath(new URL('./computer-pointer.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let buffer='';
    this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>16000){this.dispose();return;}
      let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const reply=JSON.parse(line),pending=this.pending.get(reply.id);if(pending){clearTimeout(pending.timer);this.pending.delete(reply.id);pending.resolve(reply);}}catch{}}
    });
    this.child.stderr.on('data',chunk=>{this.diagnostic=((this.diagnostic||'')+chunk.toString()).slice(-8000);});
    this.child.stdin.on('error',()=>this.dispose());
    this.child.on('error',()=>this.dispose());this.child.on('exit',()=>this.dispose());
  }
  async command(command){
    if(this.platform!=='win32'||this.closed)return {available:false};
    try{
      this.start();const id=++this.sequence;
      return await new Promise(resolve=>{
        const timer=setTimeout(()=>this.dispose(),10000);
        this.pending.set(id,{resolve,timer});this.child.stdin.write(`${id} ${command}\n`);
      });
    }catch{this.dispose();return {available:false};}
  }
  async move(binding,target){
    const e=target.element,x=Math.round(e.x+e.width/2),y=Math.round(e.y+e.height/2);
    if(![x,y].every(Number.isSafeInteger)||Math.abs(x)>100000||Math.abs(y)>100000||!/^[a-zA-Z0-9-]+$/.test(binding.id))return {available:false};
    return this.command(`move ${x} ${y} ${binding.id}`);
  }
  pulse(){return this.command('pulse');}
  hide(){return this.child?this.command('hide'):Promise.resolve({available:false});}
  dispose(){
    this.closed=true;const child=this.child;this.child=null;
    for(const {resolve,timer} of this.pending.values()){clearTimeout(timer);resolve({available:false});}this.pending.clear();
    if(child&&!child.killed)child.kill();
  }
}
