import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {runClaude} from './claude-code.mjs';

// OAuth, the loopback callback and credential storage remain owned by the CLI.
// Forward the URL sent to BROWSER, not the printed manual-code fallback URL.
export function claudeAuthorizationUrl(text) {
  try{
    const url=new URL(text.trim()),redirect=new URL(url.searchParams.get('redirect_uri'));
    const official=(url.hostname==='claude.com'&&url.pathname==='/cai/oauth/authorize')||(['claude.ai','console.anthropic.com','platform.claude.com'].includes(url.hostname)&&url.pathname==='/oauth/authorize');
    if(url.protocol!=='https:'||url.username||url.password||url.port||!official||!url.searchParams.get('state')||!url.searchParams.get('code_challenge'))return null;
    if(redirect.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(redirect.hostname)||!redirect.port||redirect.username||redirect.password||redirect.pathname!=='/callback')return null;
    return url.href;
  }catch{return null;}
}
export async function runClaudeLogin(binary,{signal,openBrowser,closeBrowser,run=runClaude}={}) {
  if(typeof openBrowser!=='function')throw Error('browser_unavailable');
  const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-claude-login-'));
  const opener=path.join(directory,process.platform==='win32'?'browser.cmd':'browser'),capture=path.join(directory,'authorize');
  let opened=null,openError=null,opening;
  const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  try{
    // The override affects this child only. Keep the short-lived authorize URL
    // in the private temporary directory and remove it immediately after reading.
    const script=process.platform==='win32'
      ? '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "NUBI_CLAUDE_AUTH_URL=%~1"\r\npowershell.exe -NoLogo -NoProfile -NonInteractive -Command "[IO.File]::WriteAllText($env:NUBI_CLAUDE_AUTH_CAPTURE, $env:NUBI_CLAUDE_AUTH_URL)"\r\n'
      : '#!/bin/sh\numask 077\nprintf \'%s\' "$1" > "$NUBI_CLAUDE_AUTH_CAPTURE"\n';
    await writeFile(opener,script,{mode:0o700});
    opening=(async()=>{
      const started=Date.now();
      while(!combined.aborted){
        let value;try{value=await readFile(capture,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
        if(value){const url=claudeAuthorizationUrl(value);await rm(capture,{force:true});if(!url)throw Error('claude_login_failed');if(!combined.aborted)opened=await openBrowser(url);return;}
        if(Date.now()-started>30000)throw Error('browser_unavailable');
        await delay(100,undefined,{signal:combined});
      }
    })().catch(error=>{if(!combined.aborted){openError=Error(error.message==='claude_login_failed'?'claude_login_failed':'browser_unavailable');controller.abort();}});
    await run(binary,['auth','login'],{signal:combined,timeoutMs:600000,environment:{BROWSER:opener,NUBI_CLAUDE_AUTH_CAPTURE:capture}}).catch(error=>{throw openError||error;});
    if(!opened)throw Error('claude_login_failed');
    if(combined.aborted)throw openError||Error('cancelled');
  }finally{
    controller.abort();await opening;
    if(opened?.tabId)await Promise.resolve(closeBrowser?.(opened.tabId)).catch(()=>{});
    await rm(directory,{recursive:true,force:true});
  }
}
