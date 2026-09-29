import assert from 'node:assert/strict';

export async function assertDesktopDialog(dialog,{large=false}={}) {
  await dialog.waitFor();
  const facts=await dialog.evaluate(root=>{
    const css=getComputedStyle(root),title=getComputedStyle(root.querySelector('h2'));
    const buttons=[...root.querySelectorAll('button')].filter(e=>e.checkVisibility());
    return {font:css.fontFamily,size:css.fontSize,line:css.lineHeight,radius:css.borderRadius,
      title:{size:title.fontSize,line:title.lineHeight},blue:css.getPropertyValue('--brand-action').trim(),
      buttons:buttons.map(e=>({size:getComputedStyle(e).fontSize,radius:getComputedStyle(e).borderRadius,kit:e.classList.contains('cx-kit-button'),label:e.getAttribute('aria-label')||e.textContent.trim(),iconOnly:e.dataset.iconOnly,title:e.title})),
      fields:[...root.querySelectorAll('.nubi-url-pair label,.nubi-db-fields label,.nubi-map-controls label,.nubi-db-tls,.nubi-recovery-option,.nubi-run-form small')].filter(e=>e.checkVisibility()).map(e=>({size:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight})),
      overflow:root.scrollWidth>root.clientWidth};
  });
  const size=large?'16px':'14px',line=large?'26px':'22px';
  assert(facts.font.includes('Noto Sans KR'));assert.equal(facts.size,size);assert.equal(facts.line,line);assert.equal(facts.radius,'20px');
  assert.deepEqual(facts.title,{size:'16px',line:'24px'});assert.equal(facts.blue.toLowerCase(),'#1b64da');
  assert.equal(facts.overflow,false);assert(facts.buttons.every(b=>b.label&&b.size===size));
  assert(facts.fields.every(field=>field.size===size&&field.line===line),'Dialog labels and instructions must track the body scale: '+JSON.stringify(facts.fields));
  assert(facts.buttons.filter(b=>b.kit).every(b=>b.radius==='12px'));
  assert(facts.buttons.filter(b=>b.iconOnly).every(b=>b.title));
}
