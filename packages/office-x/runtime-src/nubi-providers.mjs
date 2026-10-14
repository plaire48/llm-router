import {runClaude,findClaudeBinary} from './claude-cli.mjs';
import {runClaudeLogin} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-login.mjs';
import {createDesktopProviders} from '../vendor/nubi/packages/nubi-desktop/runtime/desktop-providers.mjs';
import {createProviders} from '../vendor/nubi/packages/nubi-office/worker/providers.mjs';
import {createOfficeClaudeCode} from './claude-connection.mjs';
import {openLoginBrowser,startLogin} from '../vendor/nubi/packages/nubi-office/worker/aipro-auth.mjs';
import {ORIGIN} from '../vendor/nubi/extensions/aipro-chat/core.js';
import {desktopChatGPTModels} from '../vendor/nubi/packages/nubi-desktop/runtime/chatgpt-catalog.mjs';
import {officeClaudeRun} from './claude-office-run.mjs';
import {refreshCatalog,loginCatalogFetch} from './provider-connection.mjs';
export function officeProviders(vault, overrides={}) {
  const run=overrides.run||runClaude;
  let base,claude;
  const providers=createDesktopProviders({findBinary:findClaudeBinary,openBrowser:async url=>{await openLoginBrowser(url);return {external:true};},hostLabel:'Excel',accountCatalog:true,
    onConnectionChange:(provider,record)=>vault('provider:'+provider,record),
    onActiveProvider:provider=>vault('provider:active',provider),...overrides,
    startClaudeLogin:async(binary,options)=>{claude.clearConnectionDiagnostic();try{return await (overrides.startClaudeLogin||((b,o)=>runClaudeLogin(b,{...o,run})))(binary,options);}catch(error){claude.recordConnectionFailure('login',error);throw error;}},
    startLogin:options=>(overrides.startLogin||startLogin)({...options,fetchImpl:loginCatalogFetch(options.fetchImpl||overrides.fetchImpl||fetch,ORIGIN)}),
    chatGPTModels:(...args)=>refreshCatalog(()=>(overrides.chatGPTModels||desktopChatGPTModels)(...args)),run:officeClaudeRun(run),
    createBase:deps=>base=(overrides.createBase||createProviders)(deps),createClaude:deps=>claude=createOfficeClaudeCode(deps,overrides.createClaude)});
  // A staged model form can refresh another account without switching the
  // conversation or persisting a provider change before the user presses Apply.
  return {...providers,
    status:()=>{const state=providers.status(),diagnostic=claude.connectionDiagnostic();return state.loginError&&diagnostic?{...state,loginError:diagnostic.code,connectionStage:diagnostic.stage}:state;},
    restoreConnections:async(records,selected)=>{
      const restored=await providers.restoreConnections(records,selected);
      if(selected&&selected!=='claude'){
        const state=base.status();
        if(state.connected&&state.provider===selected){await providers.select(selected);return providers.status();}
        if(state.loginError)return {...restored,provider:selected,connected:false,loginError:state.loginError};
      }
      return restored;
    },
    cancelConnection:provider=>{providers.cancelLogin();if(provider==='claude')claude.disconnect();},refreshModels:async(input={})=>{const provider=input.provider||providers.status().provider;if(provider==='claude'){if(!claude.status().connected)throw Error('claude_login_required');await claude.connect();}else if(provider==='chatgpt')await base.refreshModels(input);else await refreshCatalog(()=>base.refreshModels(input));return providers.status();}};
}
export function publicProviderState(providers){return {...providers.status(),catalogs:providers.catalogs()};}
