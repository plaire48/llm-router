import {it,expect,vi} from 'vitest';
// @ts-expect-error runtime JS adapter
import {createOfficeClaudeCode} from '../runtime-src/claude-connection.mjs';
// @ts-expect-error runtime JS adapter
import {officeClaudeEnvironment,claudeProcessFailure} from '../runtime-src/claude-cli.mjs';
// @ts-expect-error runtime JS adapter
import {officeClaudeRun} from '../runtime-src/claude-office-run.mjs';
it('preserves the Windows shell launch hint while excluding inherited auth and endpoint overrides regardless of case',()=>{
 const env=officeClaudeEnvironment({Path:'bin',claude_code_git_bash_path:'D:\\Git\\bin\\bash.exe',anthropic_api_key:'secret',CLAUDE_CONFIG_DIR:'private',CLAUDE_CODE_OAUTH_TOKEN:'private',CLAUDECODE:'1'});
 expect(env).toEqual({Path:'bin',CLAUDE_CODE_GIT_BASH_PATH:'D:\\Git\\bin\\bash.exe'});
 expect(officeClaudeEnvironment({CLAUDE_CODE_GIT_BASH_PATH:'bash.exe\nmalicious'})).toEqual({});
});
it('does not reject successful catalog initialization for having no structured answer',async()=>{
 const events:any[]=[];const run=officeClaudeRun(async(_b:any,_a:any,o:any)=>{o.onEvent({type:'control_response',response:{models:[]}});o.onEvent({type:'result',subtype:'success',result:''});return '';});
 await run('cli',['-p','--input-format','stream-json'],{onEvent:(e:any)=>events.push(e)});expect(events).toHaveLength(2);
});
it('classifies known process errors without including stderr, paths or account data',()=>{
 expect(claudeProcessFailure('private user: Claude Code on Windows requires git-bash')).toBe('claude_shell_missing');
 expect(claudeProcessFailure('private path: unknown option --safe-mode')).toBe('claude_cli_update');
 expect(claudeProcessFailure('private token')).toBe('claude_cli_failed');
});
it('authentication process failure is not converted to a login request',async()=>{
 const run=vi.fn(async(_b:any,args:any)=>{if(args[0]==='--help')return '--safe-mode --json-schema';throw Error('claude_cli_failed');});
 const provider=createOfficeClaudeCode({findBinary:async()=> 'fixture',run});
 await expect(provider.connect()).rejects.toThrow('claude_auth_check_failed');
 expect(provider.connectionDiagnostic()).toEqual({stage:'authentication',code:'claude_auth_check_failed'});provider.disconnect();
});
it('records catalog failures separately from authenticated account state',async()=>{
 const provider=createOfficeClaudeCode({findBinary:async()=> 'fixture',run:async(_b:any,args:any)=>{if(args[0]==='--help')return '--safe-mode --json-schema';if(args[0]==='auth')return '{"loggedIn":true}';return '';}});
 await expect(provider.connect()).rejects.toThrow('claude_catalog_unavailable');expect(provider.connectionDiagnostic()?.stage).toBe('catalog');provider.disconnect();
});
