import {createResearchBrowser, researchAddress} from './research-browser.js';
import {browserURL,sourceURL} from './browser-url.js';
import {refreshBrowserPolicy} from './browser-policy.js';
import {readPageContent} from './browser-content.js';
import {pageScript} from './page-script.js';

export function nativeResearchBrowser({checkOwner}) {
  return createResearchBrowser({tabs:chrome.tabs,rules:chrome.declarativeNetRequest,
    load:async()=> (await chrome.storage.session.get('researchTabs')).researchTabs || [],
    save:researchTabs=>chrome.storage.session.set({researchTabs}),checkOwner,
    access:async url=>{
      await refreshBrowserPolicy();const parsed=browserURL(researchAddress(url));
      if(!await chrome.permissions.contains({origins:[`${parsed.origin}/*`]}))throw new Error('page_access_required');
    },
    read:async(task,args,cancelled)=>{
      const [before]=await pageScript({target:{tabId:task.tabId,frameIds:[0]},world:'ISOLATED',func:()=>({url:location.href,
        login:!!document.querySelector('input[type="password"],input[autocomplete="one-time-code"]'),
        links:[...document.querySelectorAll('a[href]')].filter(el=>el.getClientRects().length && !el.closest('[hidden],[inert],[aria-hidden="true"]'))
          .slice(0,40).map((el,index)=>({id:`link-${index}`,url:el.href,name:(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0,120)}))})});
      if(before?.result?.login)return {error:'research_login_required'};
      if(!before?.documentId)return {error:'browser_stale'};
      const result=await readPageContent(task,args,sourceURL,cancelled);
      if(result.error)return result;
      if(result.source_document_id!==before.documentId)return {error:'browser_stale'};
      // Only public reference destinations are available to the child.
      const links=before.result.links.filter(link=>{try{return researchAddress(link.url)===sourceURL(link.url);}catch{return false;}});
      return {...result,research_links:links};
    },
  });
}
