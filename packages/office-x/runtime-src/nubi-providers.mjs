import {runClaude,findClaudeBinary} from './claude-cli.mjs';
import {runClaudeLogin} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-login.mjs';
import {createDesktopProviders} from '../vendor/nubi/packages/nubi-desktop/runtime/desktop-providers.mjs';
import {openLoginBrowser} from '../vendor/nubi/packages/nubi-office/worker/aipro-auth.mjs';
import {desktopChatGPTModels} from '../vendor/nubi/packages/nubi-desktop/runtime/chatgpt-catalog.mjs';
import {officeClaudeRun} from './claude-office-run.mjs';
export function officeProviders(vault, overrides={}) {
  const run=overrides.run||runClaude;
  return createDesktopProviders({findBinary:findClaudeBinary,startClaudeLogin:(binary,options)=>runClaudeLogin(binary,{...options,run}),openBrowser:async url=>{await openLoginBrowser(url);return {external:true};},hostLabel:'Excel',chatGPTModels:desktopChatGPTModels,accountCatalog:true,
    onConnectionChange:(provider,record)=>vault('provider:'+provider,record),
    onActiveProvider:provider=>vault('provider:active',provider),...overrides,run:officeClaudeRun(run)});
}
export function publicProviderState(providers){return {...providers.status(),catalogs:providers.catalogs()};}
