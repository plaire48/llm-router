import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const {adaptation,palette}=JSON.parse(await readFile(new URL('../design/reference.json',import.meta.url),'utf8'));
export const desktopDialogScale=large=>({size:(large?adaptation.largeBody:adaptation.body)+'px',line:(large?adaptation.largeBody*adaptation.lineRatio:adaptation.line)+'px',heading:adaptation.heading+'px',headingLine:adaptation.headingLine+'px'});

export async function assertDialogChrome(dialog) {
  const facts=await dialog.evaluate(root=>{
    const parts=['header','body','footer'].map(name=>root.querySelector(':scope > .cx-panel-'+name)).filter(Boolean);
    const close=root.querySelector('.cx-panel-header-actions [data-action=close]');
    const title=root.querySelector('.cx-panel-header h2');
    return {insets:parts.map(node=>[getComputedStyle(node).paddingLeft,getComputedStyle(node).paddingRight]),
      titleWeight:getComputedStyle(title).fontWeight,
      radius:getComputedStyle(root).borderRadius,
      close:close?{width:close.getBoundingClientRect().width,height:close.getBoundingClientRect().height,radius:getComputedStyle(close).borderRadius}:null,
      sectionGap:getComputedStyle(root.querySelector(':scope > .cx-panel-body')).rowGap};
  });
  assert(new Set(facts.insets.flat()).size===1,'All dialog sections share the same horizontal gutter');
  assert.equal(facts.titleWeight,String(adaptation.modal.titleWeight));
  assert.equal(facts.radius,adaptation.modal.radius+'px');
  assert.equal(facts.sectionGap,adaptation.modal.sectionGap+'px');
  if(facts.close){assert.equal(facts.close.width,facts.close.height,'Close target must be square');assert(facts.close.width>=adaptation.workControl.height);assert.equal(facts.close.radius,adaptation.workControl.radius+'px');}
  return facts;
}

export async function assertDesktopDialog(dialog,{large=false}={}) {
  await dialog.waitFor();
  const facts=await dialog.evaluate(root=>{
    const css=getComputedStyle(root),title=getComputedStyle(root.querySelector('h2'));
    const buttons=[...root.querySelectorAll('button')].filter(e=>e.checkVisibility());
    return {font:css.fontFamily,size:css.fontSize,line:css.lineHeight,radius:css.borderRadius,
      danger:root.matches('.nubi-delete-conversation,.nubi-delete-skill'),dangerToken:css.getPropertyValue('--deck-red').trim(),title:{size:title.fontSize,line:title.lineHeight},blue:css.getPropertyValue('--brand-action').trim(),
      buttons:buttons.map(e=>({size:getComputedStyle(e).fontSize,radius:getComputedStyle(e).borderRadius,kit:e.classList.contains('cx-kit-button'),chip:e.classList.contains('nubi-page-chip'),label:e.getAttribute('aria-label')||e.textContent.trim(),iconOnly:e.dataset.iconOnly,title:e.title})),
      fields:[...root.querySelectorAll('.nubi-url-pair label,.nubi-db-fields label,.nubi-map-controls label,.nubi-db-tls,.nubi-recovery-option,.nubi-run-form small')].filter(e=>e.checkVisibility()).map(e=>({size:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight})),
      overflow:root.scrollWidth>root.clientWidth};
  });
  const {size,line,heading,headingLine}=desktopDialogScale(large);
  assert(facts.font.includes('Noto Sans KR'));assert.equal(facts.size,size);assert.equal(facts.line,line);assert.equal(facts.radius,'20px');
  assert.deepEqual(facts.title,{size:heading,line:headingLine});assert((facts.danger?[facts.dangerToken]:[palette.blue,palette['blue-deep']]).map(value=>value.toLowerCase()).includes(facts.blue.toLowerCase()),'Actions use the semantic token for the dialog purpose');
  assert.equal(facts.overflow,false);assert(facts.buttons.every(b=>b.label&&b.size===size));
  assert(facts.fields.every(field=>field.size===size&&field.line===line),'Dialog labels and instructions must track the body scale: '+JSON.stringify(facts.fields));
  assert(facts.buttons.filter(b=>b.kit&&!b.chip).every(b=>b.radius==='12px'));
  assert(facts.buttons.filter(b=>b.chip).every(b=>b.radius==='100px'),'Page chips use the reference pill radius');
  assert(facts.buttons.filter(b=>b.iconOnly).every(b=>b.title));
}
