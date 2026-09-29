export const handbook = body => `---\ntitle: 교육 안내\ntype: Reference\n---\n# 교육 안내\n\n제목: 팀 교육 안내\n본문: ${body}\n`;
export const initialBody = '금요일 오후 2시에 팀 교육을 진행합니다.';
export const revisedBody = '목요일 오후 3시에 팀 교육을 진행합니다.';
export const draftPage = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>교육 안내 초안</title><style>body{font:16px system-ui;padding:32px}label{display:block;margin:16px 0}input,textarea{display:block;width:360px;padding:8px}textarea{height:120px}</style><main><h1>교육 안내 초안</h1><form><label>제목<input name="title"></label><label>본문<textarea name="body"></textarea></label><button>등록</button></form><output>작성 전</output></main><script>window.submits=0;window.savedDraft=null;window.trustedInputs=[];document.querySelector('form').onsubmit=event=>{event.preventDefault();submits++;};document.querySelector('form').addEventListener('input',event=>{trustedInputs.push(event.isTrusted);savedDraft={title:document.querySelector('input').value,body:document.querySelector('textarea').value};sessionStorage.setItem('draft',JSON.stringify(savedDraft));document.querySelector('output').textContent='초안 저장됨';});</script></html>`;

/** Runs in the extension page. OPFS provides real, structured-cloneable Chrome
 * FileSystemDirectoryHandle objects, but does not prove an OS picker grant. */
export async function seedWikiDirectory(content) {
  const root = await navigator.storage.getDirectory();
  const selected = await root.getDirectoryHandle('Team handbook', {create: true});
  const wiki = await selected.getDirectoryHandle('openwiki', {create: true});
  const file = await wiki.getFileHandle('training.md', {create: true});
  const writer = await file.createWritable(); await writer.write(content); await writer.close();
  const ignored = await selected.getFileHandle('private-not-in-wiki.txt', {create: true});
  const privateWriter = await ignored.createWritable(); await privateWriter.write('private-outside-wiki-marker'); await privateWriter.close();
  window.wikiTestSelectedHandle = selected;
  window.wikiTestPickerCalls = 0;
  window.showDirectoryPicker = async () => {window.wikiTestPickerCalls++; return window.wikiTestSelectedHandle;};
  return {kind: selected.kind, constructor: selected.constructor.name, permission: await selected.queryPermission({mode: 'read'})};
}

export async function rewriteWikiDirectory(content) {
  const root = await navigator.storage.getDirectory();
  const selected = await root.getDirectoryHandle('Team handbook');
  const wiki = await selected.getDirectoryHandle('openwiki');
  const file = await wiki.getFileHandle('training.md');
  const writer = await file.createWritable(); await writer.write(content); await writer.close();
}
