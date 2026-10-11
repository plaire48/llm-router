import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const {adaptation,palette}=JSON.parse(await readFile(new URL('../design/reference.json',import.meta.url),'utf8'));
export const desktopDialogScale=large=>({size:(large?adaptation.largeBody:adaptation.body)+'px',line:(large?adaptation.largeBody*adaptation.lineRatio:adaptation.line)+'px',heading:adaptation.heading+'px',headingLine:adaptation.headingLine+'px'});

export async function assertDesktopDialog(dialog,{large=false}={}) {
  await dialog.waitFor();
  const facts=await dialog.evaluate(root=>{
    const css=getComputedStyle(root),title=getComputedStyle(root.querySelector('h2'));
    const buttons=[...root.querySelectorAll('button')].filter(e=>e.checkVisibility());
    return {font:css.fontFamily,size:css.fontSize,line:css.lineHeight,radius:css.borderRadius,
      title:{size:title.fontSize,line:title.lineHeight},blue:css.getPropertyValue('--brand-action').trim(),
      buttons:buttons.map(e=>({size:getComputedStyle(e).fontSize,radius:getComputedStyle(e).borderRadius,kit:e.classList.contains('cx-kit-button'),chip:e.classList.contains('nubi-page-chip')||e.classList.contains('nubi-custom-skill-register'),/* toolbar pill actions use the pill radius by design (workspace-identity.css) */label:e.getAttribute('aria-label')||e.textContent.trim(),iconOnly:e.dataset.iconOnly,title:e.title})),
      fields:[...root.querySelectorAll('.nubi-url-pair label,.nubi-db-fields label,.nubi-map-controls label,.nubi-db-tls,.nubi-recovery-option,.nubi-run-form small')].filter(e=>e.checkVisibility()).map(e=>({size:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight})),
      overflow:root.scrollWidth>root.clientWidth};
  });
  const {size,line,heading,headingLine}=desktopDialogScale(large);
  assert(facts.font.includes('Noto Sans KR'));assert.equal(facts.size,size);assert.equal(facts.line,line);assert.equal(facts.radius,'20px');
  assert.deepEqual(facts.title,{size:heading,line:headingLine});assert([palette.blue,palette['blue-deep']].map(value=>value.toLowerCase()).includes(facts.blue.toLowerCase()),'Actions use an approved Nubi blue token');
  assert.equal(facts.overflow,false);assert(facts.buttons.every(b=>b.label&&b.size===size));
  assert(facts.fields.every(field=>field.size===size&&field.line===line),'Dialog labels and instructions must track the body scale: '+JSON.stringify(facts.fields));
  assert(facts.buttons.filter(b=>b.kit&&!b.chip).every(b=>b.radius==='12px'));
  assert(facts.buttons.filter(b=>b.chip).every(b=>b.radius==='100px'),'Page chips use the reference pill radius');
  assert(facts.buttons.filter(b=>b.iconOnly).every(b=>b.title));
}
