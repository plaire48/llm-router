import {runClaude} from '../vendor/nubi/packages/nubi-desktop/runtime/claude-code.mjs';
import {createDesktopProviders} from '../vendor/nubi/packages/nubi-desktop/runtime/desktop-providers.mjs';
import {openLoginBrowser} from '../vendor/nubi/packages/nubi-office/worker/aipro-auth.mjs';
import {desktopChatGPTModels} from '../vendor/nubi/packages/nubi-desktop/runtime/chatgpt-catalog.mjs';
export function officeProviders(vault, overrides={}) {
  const run=overrides.run||runClaude;
  return createDesktopProviders({openBrowser:async url=>{await openLoginBrowser(url);return {external:true};},hostLabel:'Excel',chatGPTModels:desktopChatGPTModels,accountCatalog:true,
    onConnectionChange:(provider,record)=>vault('provider:'+provider,record),
    onActiveProvider:provider=>vault('provider:active',provider),...overrides,run:(binary,args,options)=>run(binary,args[0]==='-p'?[...args,'--disallowedTools','mcp__*']:args,options)});
}
export function publicProviderState(providers){return {...providers.status(),catalogs:providers.catalogs()};}
