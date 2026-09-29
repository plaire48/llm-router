// A real schema-backed editor. Only this fixture's native UI calls its API;
// Nubi sees ordinary browser controls, never this editor instance.
import {Editor, Mark} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

const TextStyle = Mark.create({
  name: 'textStyle',
  addAttributes() {return {fontSize: {default: null, parseHTML: el => el.style.fontSize, renderHTML: attrs => attrs.fontSize ? {style: `font-size:${attrs.fontSize}`} : {} }};},
  parseHTML: () => [{tag: 'span[style]'}],
  renderHTML: ({HTMLAttributes}) => ['span', HTMLAttributes, 0],
});
window.fixtureState = {updates: 0, published: 0, keys: []};
const editor = new Editor({
  element: document.getElementById('editor'), extensions: [StarterKit, TextStyle],
  content: JSON.parse(localStorage.getItem('draft') || 'null') || '<p>교육 일정 안내</p><p>일시: 10월 8일 목요일 오후 2시</p><p>참석 전 자료를 확인해 주세요.</p><p>문의는 교육 담당자에게 알려주세요.</p>',
  editorProps: {attributes: {role: 'textbox', 'aria-label': '게시글 본문'}, handleKeyDown(_view, event) {window.fixtureState.keys.push({key: event.key, trusted: event.isTrusted}); return false;}},
  onUpdate({editor}) {
    fixtureState.updates++;
    localStorage.setItem('draft', JSON.stringify(editor.getJSON()));
    document.getElementById('status').textContent = '초안 저장됨';
  },
});
window.readEditorDocument = () => editor.getJSON();
document.getElementById('heading').onclick = () => editor.chain().focus().toggleHeading({level: 2}).run();
document.getElementById('bold').onclick = () => editor.chain().focus().toggleBold().run();
document.getElementById('underline').onclick = () => editor.chain().focus().toggleUnderline().run();
document.getElementById('size').onchange = event => editor.chain().focus().setMark('textStyle', {fontSize: event.target.value}).run();
document.getElementById('preview').onclick = () => {document.getElementById('preview-body').innerHTML = editor.getHTML(); document.getElementById('preview-panel').hidden = false;};
document.getElementById('publish').onclick = () => {fixtureState.published++;};
