import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
export type PythonDocument={engine:string;markdown:string;evidence?:string[];warnings:string[];complete:boolean;pages?:number;tables?:number;structure?:unknown;ocr?:{used:boolean;recognizedRegions:number|null;minimumConfidence:number|null}};
type Progress=(stage:string)=>void;
function run(command:string,args:string[],options:{signal?:AbortSignal;input?:string;timeout:number;env?:NodeJS.ProcessEnv;limit?:number;resultPrefix?:string}):Promise<string>{
 return new Promise((resolve,reject)=>{if(options.signal?.aborted){reject(Error('cancelled'));return;}const child=spawn(command,args,{shell:false,windowsHide:true,env:options.env||process.env,stdio:['pipe','pipe','ignore']});let output='',settled=false;
  const finish=(error?:string)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);error?reject(Error(error)):resolve(output);};
  const kill=()=>{if(process.platform==='win32')spawn('taskkill.exe',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});child.kill();};
  const cancel=()=>{kill();finish('cancelled');};const timer=setTimeout(()=>{kill();finish('markdown_engine_timeout');},options.timeout);options.signal?.addEventListener('abort',cancel,{once:true});
  child.on('error',()=>finish('markdown_engine_unavailable'));child.stdout.setEncoding('utf8');child.stdout.on('data',b=>{output+=b;if(Buffer.byteLength(output)> (options.limit||64*1024*1024)){kill();finish('markdown_output_limit');}});child.on('close',code=>finish(code===0||options.resultPrefix&&output.includes(options.resultPrefix)?undefined:'markdown_engine_failed'));child.stdin.on('error',()=>finish('markdown_engine_failed'));child.stdin.end(options.input||'');
 });
}
const documentEnvironment=()=>Object.fromEntries(Object.entries(process.env).filter(([key])=>!/TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i.test(key)));
let queue:Promise<unknown>=Promise.resolve();
export async function runDocumentPython(engine:'markitdown'|'docling',path:string,root:string,signal?:AbortSignal,progress:Progress=()=>{}):Promise<PythonDocument>{
 const worker=typeof __dirname==='string'?__dirname:join(process.cwd(),'dist/worker'),runtime=[join(worker,'document-runtime'),join(worker,'../worker/document-runtime'),join(process.cwd(),'dist/worker/document-runtime'),join(process.cwd(),'document-runtime')].find(p=>existsSync(join(p,'convert.py')));if(!runtime)throw Error('markdown_engine_unavailable');const script=join(runtime,'convert.py');
 let python=process.env.NUBI_DOCUMENT_PYTHON;
 if(!python){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('markdown_engine_platform');
  const uv=join(runtime,'uv.exe');if(!existsSync(uv))throw Error('markdown_engine_unavailable');
  const base=join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'OfficeX','DocumentRuntime'),venv=join(base,engine+'-v1'),ready=join(venv,'nubi-ready.json'),req=join(runtime,'requirements-'+engine+'.txt');mkdirSync(base,{recursive:true});
  // Installed EXE stays small. Each engine has a separate environment, so
  // preparing OCR cannot break an already-working MarkItDown installation.
  const install=queue.catch(()=>{}).then(async()=>{if(signal?.aborted)throw Error('cancelled');if(existsSync(ready)&&readFileSync(ready,'utf8')===readFileSync(req,'utf8'))return;
   progress('markdown_prepare');const env={...documentEnvironment(),UV_PYTHON_INSTALL_DIR:join(base,'python'),UV_CACHE_DIR:join(base,'cache'),UV_NO_PROGRESS:'1',UV_SYSTEM_CERTS:'1',UV_INDEX_URL:'https://pypi.org/simple'};
   await run(uv,['venv','--allow-existing','--managed-python','--python','3.12.12',venv],{signal,timeout:180000,env});
   await run(uv,['pip','sync','--python',join(venv,'Scripts','python.exe'),'--require-hashes',req],{signal,timeout:900000,env});
   await (await import('node:fs/promises')).writeFile(ready,readFileSync(req));
  });queue=install;await install;python=join(venv,'Scripts','python.exe');
 }
 progress(engine==='docling'?'markdown_analyze':'markdown_convert');
 const env={...documentEnvironment(),PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',HF_HUB_DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1'};
 const out=await run(python,[script],{signal,timeout:900000,env,input:JSON.stringify({engine,path,root}),resultPrefix:'NUBI_DOCUMENT_RESULT:'});
 const line=out.split('\n').filter(s=>s.startsWith('NUBI_DOCUMENT_RESULT:')).at(-1);if(!line)throw Error('markdown_engine_failed');const result=JSON.parse(line.slice('NUBI_DOCUMENT_RESULT:'.length));if(result.error)throw Error(result.error);if(typeof result.markdown!=='string'||!Array.isArray(result.warnings))throw Error('markdown_engine_failed');return result;
}
