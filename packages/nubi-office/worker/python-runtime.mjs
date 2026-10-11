import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import {fileURLToPath} from 'node:url';
import {scriptInput,SCRIPT_LIMITS} from './script-runtime.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new Error(code);};
export function pythonRequirements(values=[]){
  if(!Array.isArray(values)||values.length>12)fail('python_requirements_invalid');
  const normalized=values.map(v=>{
    if(typeof v!=='string'||!/^([A-Za-z0-9][A-Za-z0-9._-]{0,79})==([0-9][A-Za-z0-9.!+_-]{0,39})$/.test(v))fail('python_requirements_invalid');
    const [name,version]=v.split('==');return name.toLowerCase().replace(/[-_.]+/g,'-')+'=='+version;
  }).sort();
  if(new Set(normalized.map(v=>v.split('==')[0])).size!==normalized.length)fail('python_requirements_invalid');
  return normalized;
}
// Only explicit OS plumbing is inherited. Provider keys, Python/uv config and
// endpoint overrides from other applications never reach child processes.
export function pythonEnvironment(root,parent=process.env){
  const env={};for(const key of ['SystemRoot','WINDIR','COMSPEC','SYSTEMDRIVE','PATH','HOME','USERPROFILE','LOCALAPPDATA'])if(parent[key])env[key]=parent[key];
  return {...env,UV_NO_CONFIG:'1',UV_NO_PROGRESS:'1',UV_SYSTEM_CERTS:'true',UV_CACHE_DIR:path.join(root,'cache'),UV_PYTHON_INSTALL_DIR:path.join(root,'interpreters'),UV_KEYRING_PROVIDER:'disabled',UV_PYTHON_DOWNLOADS:'automatic',PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',TEMP:path.join(root,'tmp'),TMP:path.join(root,'tmp'),TMPDIR:path.join(root,'tmp')};
}
export function pythonProcess(binary,args,{cwd,env,signal,input='',timeoutMs=30000,maxBytes=64000}={}){
  if(signal?.aborted)return Promise.reject(new Error('cancelled'));
  return new Promise((resolve,reject)=>{
    let child,ended=false,reason,stdout='',stderr='',bytes=0,killTimer,timer;
    const cleanup=()=>{clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',abort);};
    const finish=(error,result)=>{if(ended)return;ended=true;cleanup();error?reject(error):resolve(result);};
    const stop=code=>{
      if(reason||ended)return;reason=code;
      if(child?.pid){
        if(process.platform==='win32'){
          const taskkill=path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
          const killer=spawn(taskkill,['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',shell:false});killer.on('error',()=>{try{child.kill();}catch{}});
        }else{try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}}
      }
      killTimer=setTimeout(()=>finish(new Error('python_execution_uncertain')),5000);
    };
    const abort=()=>stop('cancelled');
    try{child=spawn(binary,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false,detached:process.platform!=='win32'});}catch{return finish(new Error('python_runtime_missing'));}
    const collect=stream=>chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>maxBytes){stop('python_output_limit');return;}if(stream==='out')stdout+=chunk;else stderr+=chunk;};
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',collect('out'));child.stderr.on('data',collect('err'));
    child.stdin.on('error',()=>{});
    child.on('error',()=>finish(new Error('python_runtime_missing')));
    child.on('close',code=>{if(reason)return finish(new Error(reason));finish(null,{code,stdout,stderr});});
    timer=setTimeout(()=>stop('python_timeout'),timeoutMs);signal?.addEventListener('abort',abort,{once:true});
    child.stdin.end(input,'utf8');if(signal?.aborted)abort();
  });
}
const runner=String.raw`import sys,json,contextlib,traceback
# Resource ceilings contain accidental runaway work. They are not a sandbox.
def limits():
    if sys.platform=="win32":
        import ctypes
        from ctypes import wintypes as w
        class Basic(ctypes.Structure):
            _fields_=[("process_time",ctypes.c_longlong),("job_time",ctypes.c_longlong),("flags",w.DWORD),("min_working",ctypes.c_size_t),("max_working",ctypes.c_size_t),("active",w.DWORD),("affinity",ctypes.c_size_t),("priority",w.DWORD),("scheduling",w.DWORD)]
        class IO(ctypes.Structure):
            _fields_=[(name,ctypes.c_ulonglong) for name in ("read_ops","write_ops","other_ops","read_bytes","write_bytes","other_bytes")]
        class Extended(ctypes.Structure):
            _fields_=[("basic",Basic),("io",IO),("process_memory",ctypes.c_size_t),("job_memory",ctypes.c_size_t),("peak_process",ctypes.c_size_t),("peak_job",ctypes.c_size_t)]
        kernel=ctypes.WinDLL("kernel32",use_last_error=True)
        kernel.CreateJobObjectW.argtypes=[ctypes.c_void_p,w.LPCWSTR];kernel.CreateJobObjectW.restype=w.HANDLE
        kernel.SetInformationJobObject.argtypes=[w.HANDLE,ctypes.c_int,ctypes.c_void_p,w.DWORD];kernel.SetInformationJobObject.restype=w.BOOL
        kernel.GetCurrentProcess.restype=w.HANDLE
        kernel.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE];kernel.AssignProcessToJobObject.restype=w.BOOL
        job=kernel.CreateJobObjectW(None,None)
        config=Extended();config.basic.flags=0x2000|0x100|0x8;config.basic.active=1;config.process_memory=512*1024*1024
        if not job or not kernel.SetInformationJobObject(job,9,ctypes.byref(config),ctypes.sizeof(config)) or not kernel.AssignProcessToJobObject(job,kernel.GetCurrentProcess()): raise RuntimeError("Process limits unavailable")
        return job
    else:
        import resource
        if sys.platform!="darwin": resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
        resource.setrlimit(resource.RLIMIT_CPU,(30,31))
try: limit_handle=limits()
except BaseException:
    print(json.dumps({"error":"python_limits_unavailable"}));sys.exit(0)
class Quiet:
    def write(self,value): return len(value)
    def flush(self): pass
payload=json.loads(sys.stdin.read())
try:
    scope={"__name__":"__nubi_skill__"}
    with contextlib.redirect_stdout(Quiet()),contextlib.redirect_stderr(Quiet()):
        exec(compile(payload["code"],"<nubi-skill>","exec"),scope)
        function=scope.get("transform")
        if not callable(function): raise TypeError("Define transform(input)")
        result=function(payload["input"])
        encoded=json.dumps(result,ensure_ascii=False,allow_nan=False,separators=(",",":"))
    if len(encoded)>24000: raise ValueError("Output exceeds 24000 characters")
    print(json.dumps({"outputJson":encoded},ensure_ascii=False))
except BaseException as error:
    frames=traceback.extract_tb(error.__traceback__)
    lines=[frame.lineno for frame in frames if frame.filename=="<nubi-skill>"]
    if isinstance(error,SyntaxError): lines=[error.lineno or 1]
    result={"error":"python_script_failed","errorName":type(error).__name__,"line":lines[-1] if lines else None}
    if isinstance(error,ModuleNotFoundError): result["missingModule"]=error.name
    print(json.dumps(result,ensure_ascii=False))
`;
// A venv isolates dependencies, NOT OS permissions. Both installation and every
// exact code/input execution require the Office approval callback.
export function createPythonRuntime({approve,signal,activity,root,uv,processRun=pythonProcess,pythonVersion='3.12',executionMs=30000}={}){
  const base=root||(process.platform==='win32'&&process.env.LOCALAPPDATA?path.join(process.env.LOCALAPPDATA,'NubiOffice','Python'):null);
  const bundledUv=fileURLToPath(new URL(`../runtime/uv/${process.arch}/uv.exe`,import.meta.url));
  const binary=uv||(existsSync(bundledUv)?bundledUv:fileURLToPath(new URL(`../dist/runtime/uv/${process.arch}/uv.exe`,import.meta.url)));
  let accepted=null,busy=false,lastFailure=null;
  const check=()=>{if(signal?.aborted)fail('cancelled');};
  const permission=async payload=>{check();if(typeof approve!=='function')fail('python_approval_required');const reply=await approve(payload);check();if(reply?.approved!==true)fail('python_approval_denied');};
  const execute=async(args,options={})=>{check();const result=await processRun(binary,args,{cwd:base,env:pythonEnvironment(base),signal,timeoutMs:600000,maxBytes:1000000,...options});check();if(result.code!==0)fail('python_environment_failed');return result;};
  async function prepare(requirements){
    check();const packages=pythonRequirements(requirements);if(!base)fail('python_platform_unsupported');
    if(busy)fail('python_environment_busy');busy=true;
    const id=hash(JSON.stringify({version:pythonVersion,packages,manager:'uv-0.12.18'})),directory=path.join(base,'environments',id),marker=path.join(directory,'ready.json'),interpreter=path.join(directory,'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    let release,event,compromised=false;const lease=new AbortController(),prepareSignal=signal?AbortSignal.any([signal,lease.signal]):lease.signal;
    const readReady=async()=>{try{const cached=JSON.parse(await readFile(marker,'utf8'));await stat(interpreter);if(cached.id===id&&hash(await readFile(path.join(directory,'requirements.lock')))===cached.lockSha256){accepted={id,directory,interpreter,packages,lockSha256:cached.lockSha256};return true;}}catch{}return false;};
    try{
      await stat(binary).catch(()=>fail('python_runtime_missing'));
      if(await readReady())return view();
      await permission({kind:'python_install',title:'Python 작업 환경을 준비할까요?',summary:'필요하면 Python 3.12와 아래 패키지 및 하위 의존성을 다운로드합니다. 누비 전용 환경에 설치하며 시스템 Python과 PATH는 바꾸지 않습니다.',target:packages.join(', ')||'Python 3.12 표준 라이브러리',verification:'Astral uv 고정 버전, PyPI wheel 패키지와 해시 검증. 회사 네트워크 연결과 다운로드 정책이 적용됩니다.',packages});
      check();await mkdir(path.dirname(directory),{recursive:true,mode:0o700});await mkdir(path.join(base,'tmp'),{recursive:true,mode:0o700});
      try{release=await lockfile.lock(directory,{realpath:false,stale:60000,update:10000,retries:0,onCompromised:()=>{compromised=true;lease.abort();}});}catch{fail('python_environment_busy');}
      if(await readReady())return view();
      await mkdir(directory,{recursive:true,mode:0o700});
      event=activity?.start('스킬에 필요한 Python 환경을 준비합니다.',{tool:'prepare_python',kind:'tool'});
      // Only an uncommitted, Nubi-owned environment can be replaced. A ready
      // environment is never mutated by a different requirement set.
      await rm(path.join(directory,'venv'),{recursive:true,force:true});
      await execute(['venv','--no-project','--no-config','--managed-python','--python',pythonVersion,path.join(directory,'venv')],{signal:prepareSignal});
      const requirementsFile=path.join(directory,'requirements.in'),lockFile=path.join(directory,'requirements.lock');
      await writeFile(requirementsFile,packages.join('\n')+'\n',{mode:0o600});
      if(packages.length){
        await execute(['pip','compile','--no-config','--python',interpreter,'--default-index','https://pypi.org/simple','--only-binary',':all:','--generate-hashes','--output-file',lockFile,requirementsFile],{signal:prepareSignal});
        await execute(['pip','sync','--no-config','--python',interpreter,'--default-index','https://pypi.org/simple','--only-binary',':all:','--require-hashes',lockFile],{signal:prepareSignal});
      }else await writeFile(lockFile,'',{mode:0o600});
      if(compromised)fail('python_environment_busy');
      const lockSha256=hash(await readFile(lockFile));
      const health=await processRun(interpreter,['-I','-B','-c','import sys,json;print(json.dumps({"version":list(sys.version_info[:2]),"isolated":sys.prefix!=sys.base_prefix}))'],{cwd:directory,env:pythonEnvironment(base),signal:prepareSignal,timeoutMs:30000});check();
      const observed=JSON.parse(health.stdout);if(health.code!==0||observed.version.join('.')!==pythonVersion||observed.isolated!==true)fail('python_environment_failed');
      if(compromised)fail('python_environment_busy');check();
      await writeFile(marker,JSON.stringify({id,packages,lockSha256}),{mode:0o600});check();accepted={id,directory,interpreter,packages,lockSha256};if(event)activity.end(event);return view();
    }catch(error){if(event)activity.end(event,{state:signal?.aborted?'cancelled':'error'});if(compromised)fail('python_environment_busy');throw error;}
    finally{if(release)await release().catch(()=>{});busy=false;}
  }
  const view=()=>accepted?{ready:true,id:accepted.id,python:pythonVersion,packages:[...accepted.packages],lockSha256:accepted.lockSha256,isolation:'dependency_environment_not_os_sandbox'}:{ready:false,python:pythonVersion};
  async function run({code,input,validate=()=>{}}){
    check();if(!accepted)fail('python_environment_required');if(busy)fail('python_environment_busy');
    if(typeof code!=='string'||!code.trim()||code.length>SCRIPT_LIMITS.codeChars)fail('script_code_invalid');
    const inputJson=scriptInput(input),environment={...accepted};busy=true;
    try{
      await permission({kind:'python_execute',title:'이 Python 코드를 실행할까요?',summary:'문서 작성용 데이터 처리 코드입니다. 로컬 사용자 권한으로 실행되며 파일과 네트워크에 접근할 수 있습니다. 가상환경은 보안 샌드박스가 아닙니다.',target:'현재 스킬 코드와 입력 데이터',verification:lastFailure?'이전 실행이 정상 완료되지 않았습니다. 부수 효과가 있을 수 있으므로 결과를 확인한 뒤 새 실행을 승인하세요.':'결과는 검증 전 데이터입니다. Office 반영과 저장은 별도 확인합니다.',code,codeSha256:hash(code),inputSha256:hash(inputJson),packages:[...environment.packages]});
      check();validate();
      if(hash(await readFile(path.join(environment.directory,'requirements.lock')))!==environment.lockSha256)fail('python_environment_changed');
      const result=await processRun(environment.interpreter,['-I','-B','-c',runner],{cwd:environment.directory,env:pythonEnvironment(base),signal,input:JSON.stringify({code,input}),timeoutMs:executionMs,maxBytes:200000});check();
      if(result.code!==0)fail('python_script_failed');
      let reply;try{reply=JSON.parse(result.stdout);}catch{fail('python_output_invalid');}
      if(reply.error){lastFailure=reply.error;return{error:reply.error==='python_limits_unavailable'?'python_limits_unavailable':'python_script_failed',errorName:String(reply.errorName||'Error').slice(0,80),detail:reply.missingModule?'Missing module: '+String(reply.missingModule).slice(0,120):'Review the Python code and input.',...(Number.isSafeInteger(reply.line)?{line:reply.line}:{})};}
      if(typeof reply.outputJson!=='string'||reply.outputJson.length>24000)fail('python_output_limit');
      const output=JSON.parse(reply.outputJson);if(scriptInput(output).length>24000)fail('python_output_limit');
      lastFailure=null;return{output,outputJson:JSON.stringify(output),environment:view()};
    }catch(error){lastFailure=error.message;throw error;}finally{busy=false;}
  }
  return {prepare,run,context:view};
}
