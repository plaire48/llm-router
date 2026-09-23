import {ContainerModule} from '@theia/core/shared/inversify';
import {ConnectionHandler, RpcConnectionHandler} from '@theia/core/lib/common/messaging';
import {fork, ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import * as path from 'node:path';
import {NUBI_SERVICE_PATH, NubiService} from '../common/protocol';

class Host implements NubiService {
  private child: ChildProcess;
  private pending = new Map<string,{resolve:(result:unknown)=>void;reject:(error:Error)=>void}>();
  clients=0;
  root?:string;
  get connected(){return this.child.connected;}
  constructor() {
    this.child = fork(path.join(__dirname,'service-entry.mjs'),[],{stdio:['ignore','pipe','pipe','ipc']});
    this.child.stdout?.on('data',()=>{}); this.child.stderr?.on('data',data=>{if(process.env.NUBI_DEBUG) process.stderr.write(data);});
    this.child.on('message',(message:any)=>{const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(new Error(message.error)):pending.resolve(message.result);});
    this.child.on('exit',()=>{for(const item of this.pending.values())item.reject(new Error('host_disconnected'));this.pending.clear();});
  }
  invoke(method:string,args:Record<string,unknown>={}) {return new Promise((resolve,reject)=>{if(!this.child.connected)return reject(new Error('host_disconnected'));if(method==='open'&&this.root&&args.root!==this.root&&this.clients>1)return reject(new Error('project_busy'));const id=randomUUID();this.pending.set(id,{resolve:result=>{if(method==='open')this.root=String(args.root);resolve(result);},reject});this.child.send({id,method,args});});}
  dispose(){if(this.child.connected)this.child.disconnect();}
}
export default new ContainerModule(bind=>{
  bind(ConnectionHandler).toDynamicValue(()=>{
    let current:Host|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    return new RpcConnectionHandler(NUBI_SERVICE_PATH,client=>{
      clearTimeout(timer);if(!current?.connected)current=new Host();const host=current;host.clients++;
      // Renderer reloads keep the same memory-only login and owned run. Never replay an RPC.
      client.onDidCloseConnection(()=>{host.clients--;if(!host.clients){timer=setTimeout(()=>{if(!host.clients){host.dispose();if(current===host)current=undefined;}},30000);timer.unref();}});
      return host;
    });
  }).inSingletonScope();
});
