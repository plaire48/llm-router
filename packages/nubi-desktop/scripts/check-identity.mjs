import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const reference=JSON.parse(await readFile('design/reference.json','utf8'));
const deck=await readFile('../../extensions/aipro-chat/design/agent-deck.css','utf8');
const identity=await readFile('design/workspace-identity.css','utf8');
for(const [name,value]of Object.entries(reference.palette)) {
  if(['muted','dark'].includes(name))continue; // Not normal text tokens in the accessible app palette.
  // Desktop's identity layer loads after the shared deck and may restore an HTML value, globally or inside one
  // component's scope. Every definition the identity layer makes must hold the HTML value; the deck is the source when
  // the identity layer makes none.
  const defined=[...identity.matchAll(new RegExp(`--deck-${name}:\\s*([^;]+);`,'g'))].map(match=>match[1].trim());
  const deckValue=deck.match(new RegExp(`--deck-${name}:\\s*([^;]+);`))?.[1].trim();
  assert(defined.every(found=>found===value)&&(defined.length>0||deckValue===value),`HTML palette changed: ${name} (deck ${deckValue}, identity ${defined.join(', ')||'none'})`);
}
const css=await readFile('electron-app/workbench.css','utf8');
for(const family of ['Pretendard Variable','Noto Sans KR','Malgun Gothic'])assert(css.includes(family),`Missing local font fallback: ${family}`);
assert(!/--(?:brand-action|brand-ink|cx-button-primary|color-bg-primary):\s*#/.test(css),'Use shared deck aliases rather than per-screen brand overrides');
const uiFiles=await readdir('ui',{recursive:true});
for(const file of uiFiles.filter(file=>file.endsWith('.jsx')&&file!=='Collaboration.jsx')) {
  const source=await readFile('ui/'+file,'utf8');
  for(const match of source.matchAll(/<DetailPanel\b[^>]*>/g))assert(/className="[^"]*deck-dialog/.test(match[0]),`${file}: modal must use deck-dialog`);
  assert(!/style=\{\{[^}]*\b(?:fontSize|fontFamily|color|backgroundColor)\s*:/.test(source),`${file}: typography and brand styling belong in shared tokens`);
}
for(const file of ['electron-app/workbench.css','design/workspace-density.css','design/workspace-dialogs.css',...uiFiles.filter(file=>file.endsWith('.css')).map(file=>'ui/'+file)]){
  const source=(await readFile(file,'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
  assert(!/(?:^|[;{])\s*font(?:-size)?\s*:[^;{}]*\b\d+(?:\.\d+)?px/.test(source),`${file}: use typography tokens, not fixed screen font sizes`);
  assert(!/(?:^|[;{])\s*(?:color|background(?:-color)?|border(?:-color)?|fill|stroke|box-shadow|filter)\s*:[^;{}]*#[\da-f]{3,8}\b/i.test(source),`${file}: raw colors belong in the identity token layer`);
}
const renderer=await readFile('electron-app/renderer.jsx','utf8');
assert(renderer.includes('design/workspace-identity.css')&&renderer.includes('./workbench.css'),'the Electron renderer must import the workbench styles and the Desktop identity layer');
const referencePath=process.env.NUBI_DESIGN_REFERENCE;
if(referencePath)assert.equal(createHash('sha256').update(await readFile(referencePath)).digest('hex'),reference.sha256,'Supplied HTML changed; review the reference tokens');
console.log('Desktop identity: HTML palette, fonts, portal classes and build inclusion verified.');
