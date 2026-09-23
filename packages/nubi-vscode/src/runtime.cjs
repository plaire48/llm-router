const {fork}=require('node:child_process');
const {readFileSync}=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const path=require('node:path');

class Runtime {
  constructor(directory,storageRoot){this.directory=directory;this.storageRoot=storageRoot;this.pending=new Map();this.closed=false;}
  start(){
    if(this.child?.connected)return;
    if(this.closed||this.child)throw Error('host_disconnected'); // Never replay after a crashed host.
    const folder=path.join(this.directory,'runtime'),manifest=JSON.parse(readFileSync(path.join(folder,'manifest.json'),'utf8'));
    if(manifest.platform!==process.platform||manifest.arch!==process.arch)throw Error('runtime_platform_mismatch');
    const binary=path.join(folder,process.platform==='win32'?'node.exe':'node');
    if(createHash('sha256').update(readFileSync(binary)).digest('hex')!==manifest.sha256)throw Error('runtime_hash_mismatch');
    const env={...process.env,NUBI_STORAGE_ROOT:this.storageRoot};
    for(const key of ['NODE_OPTIONS','NODE_PATH','ELECTRON_RUN_AS_NODE','NUBI_WINAPP_PATH','NUBI_WINAPP_SHA256','NUBI_BASH_PATH','NUBI_DEBUG'])delete env[key];
    if(process.platform==='win32'){
      const driver=JSON.parse(readFileSync(path.join(folder,'winapp/manifest.json'),'utf8'));
      env.NUBI_WINAPP_PATH=path.join(folder,'winapp/winapp.exe');env.NUBI_WINAPP_SHA256=driver.sha256;
    }
    this.child=fork(path.join(this.directory,'dist/service-entry.mjs'),[],{execPath:binary,execArgv:[],cwd:this.directory,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    this.child.stdout.on('data',()=>{});this.child.stderr.on('data',()=>{}); // Never log provider bodies or secrets.
    this.child.on('message',packet=>{const item=this.pending.get(packet?.id);if(!item)return;this.pending.delete(packet.id);packet.error?item.reject(Error(packet.error)):item.resolve(packet.result);});
    const failed=()=>{for(const item of this.pending.values())item.reject(Error('host_disconnected'));this.pending.clear();};
    this.child.on('exit',failed);this.child.on('error',failed);
  }
  invoke(method,args={}){
    this.start();
    return new Promise((resolve,reject)=>{const id=randomUUID();this.pending.set(id,{resolve,reject});this.child.send({id,method,args},error=>{if(error){this.pending.delete(id);reject(Error('host_disconnected'));}});});
  }
  dispose(){this.closed=true;if(this.child?.connected)this.child.disconnect();for(const item of this.pending.values())item.reject(Error('host_disconnected'));this.pending.clear();}
}
module.exports={Runtime};
