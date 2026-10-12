import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
// @ts-expect-error JavaScript runtime module
import {findClaudeBinary,runClaude} from '../runtime-src/claude-cli.mjs';

const directories:string[]=[];
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(directories.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
async function fixture(){
  const dir=await mkdtemp(path.join(tmpdir(),'office-claude-한글 space & %PATH%-'));directories.push(dir);
  const file=path.join(dir,'cli.cjs');
  await writeFile(file,`const fs=require('node:fs');const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('2.1.99 (Claude Code)');process.exit(0);}
if(args[0]==='hang'){setInterval(()=>{},1000);return;}
if(args[0]==='fail'){console.error('private account details');process.exit(1);}
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>console.log(JSON.stringify({args,input,path:process.env.Path||process.env.PATH,apiKey:process.env.ANTHROPIC_API_KEY,config:process.env.CLAUDE_CONFIG_DIR})));
`);
  return {dir,file};
}
const args=['--json-schema','{"text":"한글 & | < > %PATH% !USER! ^ \\"quotes\\"","path":"C:\\\\folder\\\\"}','','line one\nline two',"it's $HOME `echo`",'C:\\trailing\\'];
describe('Claude process transport',()=>{
  it('keeps JSON argv, Unicode, input and refreshed PATH intact without leaking inherited credentials',async()=>{
    const {file}=await fixture();const events:any[]=[];
    const output=await runClaude({kind:'native',file:process.execPath,prefixArgs:[file],environment:{Path:'refreshed-path',ANTHROPIC_API_KEY:'private',CLAUDE_CONFIG_DIR:'private'}},args,{input:'선택한 문서\nsecond line',onEvent:(e:any)=>events.push(e)});
    const result=JSON.parse(output);expect(result.args).toEqual(args);expect(result.input).toBe('선택한 문서\nsecond line');expect(result.path).toBe('refreshed-path');expect(result.apiKey).toBeUndefined();expect(result.config).toBeUndefined();expect(events).toHaveLength(1);
  });
  it('reports timeout and cancellation without keeping a child alive',async()=>{
    const {file}=await fixture(),launch={kind:'native',file:process.execPath,prefixArgs:[file]};
    await expect(runClaude(launch,['hang'],{timeoutMs:100})).rejects.toThrow('claude_cli_timeout');
    const controller=new AbortController(),pending=runClaude(launch,['hang'],{signal:controller.signal});setTimeout(()=>controller.abort(),100);
    await expect(pending).rejects.toThrow('cancelled');
  });
  it('never exposes stderr when a detected CLI fails',async()=>{
    const {file}=await fixture();await expect(runClaude({kind:'native',file:process.execPath,prefixArgs:[file]},['fail'])).rejects.toThrow(/^claude_cli_failed$/);
  });
  it('rejects command-line separators in a batch argument before launching CMD',async()=>{
    await expect(runClaude({kind:'cmd',file:'C:\\Tools\\claude.cmd'},['line one\nline two'])).rejects.toThrow('claude_cli_failed');
  });
});
describe.skipIf(process.platform!=='win32')('Windows shell process round trips',()=>{
  it('runs a batch shim with spaces, Unicode, percent signs, JSON and empty arguments',async()=>{
    const {dir,file}=await fixture(),cmd=path.join(dir,'claude.cmd');
    await writeFile(cmd,'@echo off\r\n"%OFFICEX_TEST_NODE%" "%OFFICEX_TEST_SCRIPT%" %*\r\n');
    const batchArgs=args.filter(arg=>!arg.includes('\n'));
    const result=JSON.parse(await runClaude({kind:'cmd',file:cmd},batchArgs,{input:'streamed stdin\nsecond line',environment:{OFFICEX_TEST_NODE:process.execPath,OFFICEX_TEST_SCRIPT:file}}));
    expect(result.args).toEqual(batchArgs);expect(result.input).toBe('streamed stdin\nsecond line');
  });
  it('runs PS1 wrappers with arbitrary arguments and stdin',async()=>{
    const {dir}=await fixture(),file=path.join(dir,'claude.ps1');
    // Assert argv before a script passes it onward to native executables.
    await writeFile(file,"$inputText=[Console]::In.ReadToEnd();[Console]::WriteLine((@{args=@($args);input=$inputText}|ConvertTo-Json -Compress))");
    const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const result=JSON.parse(await runClaude({kind:'powershell',file,shell,profile:false},args,{input:'한글 stdin',timeoutMs:20000}));
    expect(result.args).toEqual(args);expect(result.input).toBe('한글 stdin');
  },30000);
  it('discovers and executes an npm package end to end from a custom prefix',async()=>{
    const {dir,file}=await fixture(),packageRoot=path.join(dir,'node_modules','@anthropic-ai','claude-code');
    const {mkdir,copyFile}=await import('node:fs/promises');await mkdir(packageRoot,{recursive:true});await copyFile(file,path.join(packageRoot,'cli.cjs'));
    await writeFile(path.join(packageRoot,'package.json'),JSON.stringify({name:'@anthropic-ai/claude-code',bin:{claude:'cli.cjs'}}));await writeFile(path.join(dir,'claude.cmd'),'@echo off\r\n');
    const launch=await findClaudeBinary({env:{SystemRoot:process.env.SystemRoot,Path:dir},homedir:path.join(dir,'home')});
    const result=JSON.parse(await runClaude(launch,args,{input:'npm stdin'}));expect(result.args).toEqual(args);expect(result.input).toBe('npm stdin');
  });
  it('does not let inherited uppercase PATH hide the freshly resolved Path',async()=>{
    const {file}=await fixture();vi.stubEnv('PATH','stale-path');
    const result=JSON.parse(await runClaude({kind:'native',file:process.execPath,prefixArgs:[file],environment:{Path:'fresh-path'}},[]));
    expect(result.path).toBe('fresh-path');
  });
});
