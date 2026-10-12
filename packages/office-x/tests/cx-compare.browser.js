async(page)=>{
  await page.setViewportSize({width:410,height:860});
  const markup=await page.locator('.office-host').evaluate(e=>e.outerHTML);
  const reference=await page.context().newPage();
  await reference.setViewportSize({width:410,height:860});
  await reference.emulateMedia({reducedMotion:'reduce'});
  await reference.setContent(`<html lang="ko"><head><base href="http://127.0.0.1:4178/"><link rel="stylesheet" href="cx-audit/reference.css"><style>html,body{margin:0;height:100%}.office-host{height:100vh}.office-shell{width:100%}.office-content{height:100%}.topbar,.document-context{display:flex;align-items:center;justify-content:space-between;padding:8px 16px}.header-actions{display:flex}.conversation{flex:1;min-height:0;overflow:auto;padding:12px 16px}.office-task{height:auto!important;min-height:100%;display:flex;flex-direction:column}.office-composer-dock{padding:8px 16px}.message-actions{display:flex;align-items:center}.composer-note{font:var(--deck-font-caption);color:var(--nubi-note-ink);text-align:center}.nubi-logo .agent-mark{display:none}.receipt{display:none}</style></head><body>${markup}</body></html>`);
  await reference.locator('.nubi-composer-surface').waitFor();
  await reference.evaluate(()=>document.fonts.ready);
  const measure=async p=>p.evaluate(()=>{
    const pick=(selector,properties)=>{const s=getComputedStyle(document.querySelector(selector));return Object.fromEntries(properties.map(k=>[k,s[k]]));};
    return {
      tokens:Object.fromEntries(['--brand-action','--brand-ink','--brand-soft','--layout-text','--layout-muted','--layout-border','--cx-font-family','--deck-type-body','--deck-type-caption','--nubi-reading-size','--nubi-control-gap'].map(k=>[k,getComputedStyle(document.documentElement).getPropertyValue(k).trim().replace(/\s+/g,' ')])),
      canvas:pick('.office-content',['backgroundColor','backgroundImage']),
      bubble:pick('.nubi-user-bubble',['backgroundColor','borderRadius','padding','fontFamily','fontSize','lineHeight']),
      answer:pick('.assistant .message-body',['color','fontFamily','fontSize','lineHeight','fontWeight']),
      composer:pick('.nubi-composer-surface',['backgroundColor','borderColor','borderRadius','padding','boxShadow']),
      model:pick('.model-trigger',['backgroundColor','backgroundImage','color']),
      reasoning:pick('.nubi-reasoning-trigger',['color','backgroundColor']),
      send:pick('[aria-label="보내기"]',['backgroundColor','borderRadius','width','height'])
    };
  });
  const actual=await measure(page),expected=await measure(reference),differences=[];
  for(const [section,properties] of Object.entries(expected))for(const [key,value] of Object.entries(properties))if(actual[section][key]!==value)differences.push({section,key,workspace:value,office:actual[section][key]});
  if(await page.locator('.message').count()===2)await page.screenshot({path:'/Users/ganadi/Documents/office_x/verification/cx-audit/office-chat.png'});
  if(await page.locator('.message').count()===2)await reference.screenshot({path:'/Users/ganadi/Documents/office_x/verification/cx-audit/workspace-css-reference.png'});
  const result={scope:'Same chat markup rendered with current upstream Workspace CSS vs Office CSS. Reference geometry is a fixture; not live Electron.',actual,expected,differences};
  await reference.close();return result;
}
