import {Worker} from 'node:worker_threads';
import {DATABASE_ENGINES,connectionOptions} from './database-schema.mjs';
import {hash,fail} from './files.mjs';

export async function databaseConnection({action='status',id,input}={}){
  this.ready();this.databaseConnections ||= new Map();
  if(action==='status')return {engines:Object.keys(DATABASE_ENGINES),connections:[...this.databaseConnections].map(([id,c])=>({id,engine:c.input.engine,schema:c.input.schema,collectedAt:c.collectedAt,tables:c.result.tables.length}))};
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id||''))fail('database_config_invalid');
  if(this.databaseBusy)fail('database_busy');
  if(action==='disconnect'){this.databaseConnections.delete(id);return {disconnected:true};}
  if(!['connect','refresh'].includes(action))fail('input_invalid');
  const config=action==='refresh'?this.databaseConnections.get(id)?.input:input;
  connectionOptions(config);
  if(action==='connect'&&!this.databaseConnections.has(id)&&this.databaseConnections.size>=8)fail('database_limit');
  this.databaseBusy=true;
  try {
    const result=await new Promise(resolve=>{
      const worker=new Worker(new URL('./database-worker.mjs',import.meta.url),{workerData:config,resourceLimits:{maxOldGenerationSizeMb:192},execArgv:[],stdout:true,stderr:true});this.databaseWorker=worker;
      // Driver errors may contain hosts/users/SQL. Never forward their streams.
      worker.stdout.resume();worker.stderr.resume();let done=false;
      const finish=value=>{if(done)return;done=true;clearTimeout(timer);worker.terminate();resolve(value);};
      const timer=setTimeout(()=>finish({error:'database_timeout'}),30000);
      worker.once('message',finish);worker.once('error',()=>finish({error:'database_connection_failed'}));worker.once('exit',()=>finish({error:'database_connection_failed'}));
    });
    if(result.error)fail(result.error);
    const collectedAt=new Date().toISOString();
    this.databaseConnections.set(id,{input:config,result,collectedAt,hash:hash(JSON.stringify(result))});
    return {id,collectedAt,tables:result.tables.length,scope:'metadata_only'};
  } finally {this.databaseBusy=false;this.databaseWorker=null;}
}
