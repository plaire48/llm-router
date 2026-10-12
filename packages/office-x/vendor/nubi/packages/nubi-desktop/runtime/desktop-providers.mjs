import {createProviders} from '../../nubi-office/worker/providers.mjs';
import {createClaudeCode,findClaudeBinary} from './claude-code.mjs';
import {runClaudeLogin} from './claude-login.mjs';

// Desktop opts in. Office and the browser extension keep their own providers.
export function createDesktopProviders(deps={}) {
  const base=(deps.createBase||createProviders)(deps),claude=(deps.createClaude||createClaudeCode)(deps);
  let activeClaude=false,persistence=Promise.resolve(),persistenceError=null,loginAttempt=null,loginError=null;
  const remember=()=>{const s=claude.status();persistence=persistence.catch(()=>{}).then(()=>deps.onConnectionChange?.('claude',s.connected?{version:1,provider:'claude',model:s.model,reasoningEffort:s.reasoningEffort}:null)).then(()=>{persistenceError=null;},()=>{persistenceError=s.connected?'connection_not_saved':'connection_not_removed';});return persistence;};
  const status=()=>{const b=base.status(),c=claude.status();return {...b,...(activeClaude?c:{}),...(activeClaude?{pending:loginAttempt?'claude':null,loginError}:{}),...(persistenceError?{persistenceError}:{}),providers:[...b.providers,{id:'claude',label:'Claude',connected:c.connected,connectionId:c.connectionId}]};};
  const usageStatus=()=>{const b=base.usageStatus();return {...b,auth:activeClaude?{provider:'claude',present:claude.status().connected}:b.auth,connections:{...b.connections,claude:{present:claude.status().connected}},claudeAccountUsage:claude.quota()};};
  const select=async provider=>{if(provider==='claude'){if(!claude.status().connected)throw Error('claude_login_required');activeClaude=true;try{await deps.onActiveProvider?.('claude');}catch{persistenceError='connection_not_saved';}}else{await base.select(provider);activeClaude=false;}return status();};
  const connect=async input=>{if(input.provider==='claude'){await claude.connect();await remember();return select('claude');}await base.connect(input);activeClaude=false;return status();};
  function cancelLogin(){const attempt=loginAttempt;loginAttempt=null;attempt?.abort();loginError=null;base.cancelLogin?.();return status();}
  async function login(provider){
    if(loginAttempt||base.status().pending)throw Error('login_busy');
    if(provider!=='claude'){await base.login(provider);activeClaude=false;return status();}
    const attempt=new AbortController();loginAttempt=attempt;loginError=null;
    let binary;
    try{
      try{await claude.connect();if(loginAttempt!==attempt)throw Error('cancelled');await remember();if(loginAttempt!==attempt)throw Error('cancelled');await select('claude');loginAttempt=null;return status();}
      catch(error){if(error.message!=='claude_login_required')throw error;}
      binary=await (deps.findBinary||findClaudeBinary)();if(loginAttempt!==attempt)throw Error('cancelled');
    }catch(error){if(loginAttempt===attempt)loginAttempt=null;throw error;}
    activeClaude=true;
    void (async()=>{
      try{
        await (deps.startClaudeLogin||runClaudeLogin)(binary,{signal:attempt.signal,openBrowser:deps.openBrowser,closeBrowser:deps.closeBrowser});
        if(loginAttempt!==attempt)return;
        await claude.connect();if(loginAttempt!==attempt)return;
        await remember();if(loginAttempt!==attempt)return;
        await select('claude');
      }catch(error){if(loginAttempt===attempt)loginError=['browser_unavailable','claude_cli_missing','claude_cli_timeout','claude_login_required'].includes(error.message)?error.message:'claude_login_failed';}
      finally{if(loginAttempt===attempt)loginAttempt=null;}
    })();
    return status();
  }
  return {...base,status,usageStatus,
    catalogs:()=>[...base.catalogs(),...(claude.status().connected?[{provider:'claude',models:claude.status().models,model:claude.status().model}]:[])],
    restoreConnections:async(records,active)=>{await base.restoreConnections(records.filter(r=>r.provider!=='claude'),active);const c=records.find(r=>r.provider==='claude');if(c)try{await claude.connect();if(c.model)claude.model(c.model);if(c.reasoningEffort)claude.reasoning(c.reasoningEffort);activeClaude=active==='claude';}catch{/* A removed or signed-out CLI stays disconnected. */}return status();},
    flushConnections:async()=>{await base.flushConnections();await persistence;},
    login,cancelLogin,
    connect,select,
    model:async value=>{if(activeClaude){claude.model(value);await remember();}else await base.model(value);return status();},
    reasoning:async value=>{if(activeClaude){claude.reasoning(value);await remember();}else await base.reasoning(value);return status();},
    refreshModels:async input=>{if(activeClaude)await claude.connect();else await base.refreshModels(input);return status();},
    disconnect:async provider=>{if(provider==='claude'){cancelLogin();claude.disconnect();await remember();}else await base.disconnect(provider);return status();},
    accountUsage:async input=>{await base.accountUsage(input);return usageStatus();},
    complete:(...args)=>{const provider=args[6]?.backgroundModel?.provider||(activeClaude?'claude':base.status().provider);return (provider==='claude'?claude:base).complete(...args);},
    dispose:()=>{cancelLogin();claude.disconnect();base.dispose();}
  };
}
