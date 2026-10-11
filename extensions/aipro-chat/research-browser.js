// Dedicated reference tabs. No debugger, handles, form input or user tabs.
// Native dependencies are injected so the same ownership guards are exercised
// in unit tests and by Chrome's service worker.
export const RESEARCH_RULE_BASE = 720000;
export const RESEARCH_SLOTS = 4;
const fail = code => {throw new Error(code);};
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function researchAddress(value) {
  let url, pathname; try {url = new URL(value); pathname = decodeURIComponent(url.pathname);} catch {fail('page_restricted');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 2048 ||
      /(?:^|[\/_-])(auth|oauth|login|logout|signout|signin|delete|remove|submit|save|send|purchase|checkout|unsubscribe)(?:[\/_\-.]|$)/i.test(pathname) ||
      [...url.searchParams.keys()].some(key => /^(token|code|password|csrf|action|delete|logout|submit)$/i.test(key))) fail('page_restricted');
  url.hash = ''; return url.href;
}
export function researchRules(slot, tabId, url) {
  const base = RESEARCH_RULE_BASE + slot * 2;
  return [{id:base,priority:1,action:{type:'block'},condition:{tabIds:[tabId],resourceTypes:['main_frame'],regexFilter:'^https?://'}},
    {id:base+1,priority:2,action:{type:'allow'},condition:{tabIds:[tabId],resourceTypes:['main_frame'],requestMethods:['get'],regexFilter:`^${escapeRegex(researchAddress(url))}$`}}];
}
export function createResearchBrowser({tabs, rules, load, save, read, access, checkOwner, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), deadlineMs = 15000}) {
  const jobs = new Map();
  let allocation = Promise.resolve();
  const serialAllocation = task => {const next = allocation.then(task); allocation = next.catch(() => {}); return next;};
  const key = (owner, id) => JSON.stringify([owner, id]);
  const kept = () => [...jobs.values()].map(({owner,id,tabId,slot}) => ({owner,id,tabId,slot}));
  async function close(job) {
    // Remove the owned tab before releasing its navigation fence.
    try {await tabs.remove(job.tabId);} catch {
      // An already closed tab is safe to release. Unknown removal is not.
      let remaining; try {remaining = await tabs.query({});} catch {fail('research_cleanup_pending');}
      if (!Array.isArray(remaining) || remaining.some(tab => tab.id === job.tabId)) fail('research_cleanup_pending');
    }
    try {await rules.updateSessionRules({removeRuleIds:[RESEARCH_RULE_BASE+job.slot*2,RESEARCH_RULE_BASE+job.slot*2+1]});}
    catch {fail('research_cleanup_pending');}
    const identity = key(job.owner,job.id);
    jobs.delete(identity);
    try {await save(kept());} catch {jobs.set(identity,job); fail('research_cleanup_pending');}
  }
  async function assert(job) {
    await checkOwner(job.owner);
    if (jobs.get(key(job.owner,job.id)) !== job) fail('interrupted');
    const tab = await tabs.get(job.tabId); await access(tab.url);
    if (researchAddress(tab.url) !== job.url) fail('browser_stale');
  }
  async function open(job, url) {
    const address = researchAddress(url); await access(address); await checkOwner(job.owner);
    // Exact destination only. An unobserved server redirect is blocked by DNR,
    // instead of being silently admitted as another reference or login page.
    await rules.updateSessionRules({removeRuleIds:[RESEARCH_RULE_BASE+job.slot*2,RESEARCH_RULE_BASE+job.slot*2+1],addRules:researchRules(job.slot,job.tabId,address)});
    job.url = address; await tabs.update(job.tabId,{url:address,active:false});
    const until = Date.now()+deadlineMs;
    while ((await tabs.get(job.tabId)).status === 'loading') {
      await checkOwner(job.owner); if (Date.now() >= until) fail('observe_timeout'); await pause(100);
    }
    await assert(job);
  }
  return {
    async recover() {return serialAllocation(async () => {
      // Service-worker restart closes recorded research tabs. It never resumes
      // a model or converts abandoned work to completion.
      for (const item of await load() || []) if (typeof item.owner==='string' && /^[a-zA-Z0-9-]{8,100}$/.test(item.id || '') && Number.isInteger(item.tabId) && Number.isInteger(item.slot) && item.slot>=0 && item.slot<RESEARCH_SLOTS) {
        const identity=key(item.owner,item.id);
        if (!jobs.has(identity)) jobs.set(identity,{...item,links:[]});
      }
      for (const job of [...jobs.values()]) await close(job).catch(() => {});
      const retained = new Set([...jobs.values()].flatMap(job=>[RESEARCH_RULE_BASE+job.slot*2,RESEARCH_RULE_BASE+job.slot*2+1]));
      const stale=(await rules.getSessionRules()).filter(rule=>rule.id>=RESEARCH_RULE_BASE&&rule.id<RESEARCH_RULE_BASE+RESEARCH_SLOTS*2&&!retained.has(rule.id)).map(rule=>rule.id);
      if(stale.length)await rules.updateSessionRules({removeRuleIds:stale});
      await save(kept()); return {pending:jobs.size};
    });},
    async execute(owner, {worker_id:id, operation, url, args = {}}) {
      if (typeof owner !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(id || '') || !['open','read','follow','close'].includes(operation)) fail('tool_arguments_invalid');
      const identity=key(owner,id);
      if (operation==='close') {const job=jobs.get(identity); if(job) await serialAllocation(()=>close(job)); return {ok:true};}
      await checkOwner(owner);
      let job=jobs.get(identity);
      if(operation==='open' && !job) job=await serialAllocation(async()=>{
        if(jobs.has(identity))return jobs.get(identity);
        const address=researchAddress(url); await access(address); await checkOwner(owner);
        const slot=Array.from({length:RESEARCH_SLOTS},(_,i)=>i).find(i=>![...jobs.values()].some(job=>job.slot===i));
        if(slot===undefined)fail('busy');
        const tab=await tabs.create({url:'about:blank',active:false});
        const created={owner,id,tabId:tab.id,slot,url:address,links:[]};jobs.set(identity,created); await save(kept());
        return created;
      });
      if(!job)fail('browser_stale');
      if(job.busy)fail('busy');job.busy=true;
      try {
        if(operation==='open')await open(job,url);
        else if(operation==='follow') {
          await assert(job);
          const link=job.links.find(link=>link.id===args.link_id);if(!link)fail('browser_stale');
          await open(job,link.url);
        } else await assert(job);
        const result=await read({tabId:job.tabId},args,()=>!jobs.has(identity));
        await assert(job);
        if(result.error)return result;
        job.links=(result.research_links || []).map(link=>({...link}));
        return result;
      } finally {job.busy=false;}
    },
    async closeOwner(owner) {await serialAllocation(async()=>{
      let pending=false;
      for(const job of [...jobs.values()])if(job.owner===owner)try {await close(job);} catch {pending=true;}
      if(pending)fail('research_cleanup_pending');
    });},
  };
}
