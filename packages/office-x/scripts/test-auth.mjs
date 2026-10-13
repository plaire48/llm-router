import {build} from 'esbuild';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(resolve(tmpdir(),'office-x-auth-'));
try{
 const file=resolve(dir,'test.cjs');
 await build({entryPoints:[process.argv[2]||'tests/auth.integration.mjs'],outfile:file,bundle:true,platform:'node',format:'cjs',target:'node22',loader:{'.md':'text'},define:{'import.meta.url':JSON.stringify(pathToFileURL(resolve('dist/worker/main.cjs')).href)},plugins:[{name:'wire-only',setup(b){b.onResolve({filter:/agent-runtime\.js$/},()=>({path:resolve('runtime-src/nubi-wire.mjs')}));}}]});
 const result=spawnSync(process.execPath,[file],{stdio:'inherit',timeout:30000});if(result.error)throw result.error;process.exitCode=result.status||0;
}finally{await rm(dir,{recursive:true,force:true});}
