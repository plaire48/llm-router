import {describe,it,expect,vi,afterEach} from 'vitest';
// @ts-expect-error JavaScript runtime module
import {findClaudeBinary} from '../runtime-src/claude-cli.mjs';

afterEach(()=>vi.restoreAllMocks());
const user='C:\\Users\\홍 길동';
function installation(files:Record<string,string>,env:Record<string,string>={},shellRows:any[]=[]){
  const launches:any[]=[];
  const options={platform:'win32',homedir:user,env:{SystemRoot:'C:\\Windows',Path:'C:\\Tools',...env},
    exists:async(file:string)=>Object.hasOwn(files,file),
    read:async(file:string)=>{if(!Object.hasOwn(files,file))throw Error('ENOENT');return files[file];},
    shellDiscovery:async()=>shellRows,
    probe:async(launch:any)=>{launches.push(launch);return files[launch.file]==='broken'?Promise.reject(Error('claude_cli_failed')):'2.1.99 (Claude Code)\n';}};
  return {options,launches};
}
describe('Windows Claude installation discovery',()=>{
  it('finds npm CMD installs with a custom prefix and executes the package bin using Node',async()=>{
    const prefix='D:\\사용자 도구\\npm',bin=prefix+'\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
    const {options}=installation({[prefix+'\\claude.cmd']:'npm shim',[prefix+'\\node_modules\\@anthropic-ai\\claude-code\\package.json']:JSON.stringify({name:'@anthropic-ai/claude-code',bin:{claude:'cli.js'}}),[bin]:'fixture'},{Path:'"'+prefix+'"'});
    const launch=await findClaudeBinary(options);
    expect(launch.kind).toBe('native');expect(launch.file).toBe(process.execPath);expect(launch.prefixArgs).toEqual([bin]);
  });
  it('finds AppData npm even if Office started before npm was installed',async()=>{
    const prefix=user+'\\AppData\\Roaming\\npm';
    const {options}=installation({[prefix+'\\claude.cmd']:'custom shim'},{APPDATA:user+'\\AppData\\Roaming'});
    expect((await findClaudeBinary(options)).file).toBe(prefix+'\\claude.cmd');
  });
  it('refreshes user PATH and carries it into every Claude launch',async()=>{
    const {options}=installation({'D:\\new-cli\\claude.exe':'fixture'},{},[{path:'D:\\new-cli;C:\\Windows\\System32',commands:[{type:'Application',file:'D:\\new-cli\\claude.exe'}]}]);
    const launch=await findClaudeBinary(options);
    expect(launch.file).toBe('D:\\new-cli\\claude.exe');expect(launch.environment.Path).toContain('D:\\new-cli');expect(launch.environment.Path).toContain('C:\\Tools');
  });
  it('supports PowerShell profile functions with the shell that resolved them',async()=>{
    const shell='C:\\Program Files\\PowerShell\\7\\pwsh.exe';
    const {options}=installation({}, {},[{shell,profile:true,path:'D:\\profile-bin',commands:[{type:'Function',name:'claude'}]}]);
    const launch=await findClaudeBinary(options);
    expect(launch.kind).toBe('powershell');expect(launch.file).toBe('claude');expect(launch.shell).toBe(shell);expect(launch.profile).toBe(true);
  });
  it('skips a broken native install instead of hiding a working npm install',async()=>{
    const {options,launches}=installation({[user+'\\.local\\bin\\claude.exe']:'broken','C:\\Tools\\claude.cmd':'shim'},{Path:user+'\\.local\\bin;C:\\Tools'});
    expect((await findClaudeBinary(options)).file).toBe('C:\\Tools\\claude.cmd');expect(launches.length).toBeGreaterThan(1);
  });
  it('prefers the terminal PATH over a different native installation off PATH',async()=>{
    const {options}=installation({[user+'\\.local\\bin\\claude.exe']:'fixture','C:\\Tools\\claude.cmd':'fixture'});
    expect((await findClaudeBinary(options)).file).toBe('C:\\Tools\\claude.cmd');
  });
  it('distinguishes an installed but unlaunchable CLI from a missing CLI',async()=>{
    const {options}=installation({'C:\\Tools\\claude.exe':'broken'});
    await expect(findClaudeBinary(options)).rejects.toThrow('claude_cli_failed');
  });
  it('reports missing only when neither paths nor PowerShell resolve Claude',async()=>{
    const {options}=installation({});
    await expect(findClaudeBinary(options)).rejects.toThrow('claude_cli_missing');
  });
  it('does not accept an unrelated command that returns non-version output',async()=>{
    const {options}=installation({'C:\\Tools\\claude.exe':'fixture'});
    options.probe=async()=> 'not a Claude version';
    await expect(findClaudeBinary(options)).rejects.toThrow('claude_cli_failed');
  });
  it('can recover a PS1-only install without requiring an EXE or CMD sibling',async()=>{
    const {options}=installation({'C:\\Tools\\claude.ps1':'fixture'});
    const launch=await findClaudeBinary(options);
    expect(launch.kind).toBe('powershell');expect(launch.file).toBe('C:\\Tools\\claude.ps1');
  });
  it('keeps a CLI timeout distinct from missing installation',async()=>{
    const {options}=installation({'C:\\Tools\\claude.exe':'fixture'});
    options.probe=async()=>{throw Error('claude_cli_timeout');};
    await expect(findClaudeBinary(options)).rejects.toThrow('claude_cli_timeout');
  });
});
