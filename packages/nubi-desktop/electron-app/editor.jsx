import React,{useEffect,useRef} from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/basic-languages/monaco.contribution.js';
self.MonacoEnvironment={getWorker:()=>new Worker(new URL('./editor.worker.js',import.meta.url),{type:'module'})};
export {monaco};
export function languageForPath(file) {
 const name=file.split('/').at(-1).toLowerCase();
 if(name==='dockerfile')return 'dockerfile';
 return ({js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',py:'python',json:'json',jsonc:'json',md:'markdown',css:'css',scss:'scss',less:'less',html:'html',htm:'html',xml:'xml',svg:'xml',yaml:'yaml',yml:'yaml',sh:'shell',bash:'shell',ps1:'powershell',bat:'bat',cmd:'bat',cs:'csharp',java:'java',go:'go',rs:'rust',sql:'sql',cpp:'cpp',cc:'cpp',c:'c',h:'c',php:'php',rb:'ruby',toml:'ini',ini:'ini',r:'r',swift:'swift',kt:'kotlin',dart:'dart'})[name.split('.').at(-1)]||'plaintext';
}
export function GitDiff({diff}) {
 const element=useRef(null);
 useEffect(()=>{
  const node=element.current;if(!node)return;
  const style=getComputedStyle(node),color=name=>style.getPropertyValue(name).trim();
  monaco.editor.defineTheme('nubi-review-light',{base:'vs',inherit:true,rules:[],colors:{
   'editor.background':color('--nubi-diff-surface'),
   'diffEditor.insertedLineBackground':color('--nubi-diff-added-line'),
   'diffEditor.removedLineBackground':color('--nubi-diff-removed-line'),
   'diffEditor.insertedTextBackground':color('--nubi-diff-added-word'),
   'diffEditor.removedTextBackground':color('--nubi-diff-removed-word'),
   'diffEditorGutter.insertedLineBackground':color('--nubi-diff-added-line'),
   'diffEditorGutter.removedLineBackground':color('--nubi-diff-removed-line'),
   'diffEditor.unchangedRegionBackground':color('--nubi-diff-unchanged'),
   'diffEditor.unchangedRegionForeground':color('--nubi-diff-muted'),
   'diffEditor.unchangedRegionShadow':color('--nubi-diff-transparent'),
   'diffEditor.border':color('--nubi-diff-transparent'), 'diffEditor.insertedTextBorder':color('--nubi-diff-transparent'),'diffEditor.removedTextBorder':color('--nubi-diff-transparent')
  }});
  const suffix=diff.path.split('.').at(-1).toLowerCase();
  const language=({js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',py:'python',json:'json',md:'markdown',css:'css',html:'html',xml:'xml',yaml:'yaml',yml:'yaml',sh:'shell',cs:'csharp',java:'java',go:'go',rs:'rust',sql:'sql',cpp:'cpp',c:'c',php:'php',rb:'ruby'})[suffix]||'plaintext';
  const original=monaco.editor.createModel(diff.before,language),modified=monaco.editor.createModel(diff.after,language);
  const editor=monaco.editor.createDiffEditor(node,{
   automaticLayout:true,editContext:false,readOnly:true,originalEditable:false,
   fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),fontFamily:style.fontFamily,
   minimap:{enabled:false},theme:'nubi-review-light',scrollBeyondLastLine:false,
   renderSideBySide:false,renderIndicators:true,renderMarginRevertIcon:false,
   renderOverviewRuler:false,overviewRulerLanes:0,diffAlgorithm:'advanced',ignoreTrimWhitespace:false,
   hideUnchangedRegions:{enabled:true,contextLineCount:3,minimumLineCount:3,revealLineCount:10},
   stickyScroll:{enabled:false},glyphMargin:false,lineNumbersMinChars:3,folding:false,
   padding:{top:8,bottom:8},scrollbar:{verticalScrollbarSize:8,horizontalScrollbarSize:8},
   domReadOnly:true,links:false,contextmenu:false
  });
  editor.setModel({original,modified});
  // Stop the pending diff before its text models are disposed. Parent status refreshes must not recreate it.
  return()=>{editor.setModel(null);editor.dispose();original.dispose();modified.dispose();};
 },[diff.path,diff.before,diff.after]);
 return <div ref={element} className="desktop-git-diff" aria-label={`${diff.path} 읽기 전용 변경 비교`}/>;
}
export default function Editor({buffer,diff,onReady}){
 const element=useRef(null),activeEditor=useRef(null);
 useEffect(()=>{if(!element.current)return;const style=getComputedStyle(element.current);const options={automaticLayout:true,editContext:false,fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),fontFamily:style.fontFamily,minimap:{enabled:false},theme:'vs',scrollBeyondLastLine:false,lineNumbersMinChars:3,glyphMargin:false,overviewRulerLanes:0,hideCursorInOverviewRuler:true,renderLineHighlight:'none',padding:{top:8,bottom:8},scrollbar:{verticalScrollbarSize:6,horizontalScrollbarSize:6}};
  let instance;if(diff){instance=monaco.editor.createDiffEditor(element.current,{...options,readOnly:true});const original=monaco.editor.createModel(diff.before,'plaintext'),modified=monaco.editor.createModel(diff.after,'plaintext');instance.setModel({original,modified});return()=>{instance.dispose();original.dispose();modified.dispose();};}
  instance=monaco.editor.create(element.current,{...options,readOnly:!!buffer.readOnly,model:buffer.model});activeEditor.current=instance;if(buffer.viewState)instance.restoreViewState(buffer.viewState);onReady?.(instance);return()=>{buffer.viewState=instance.saveViewState();activeEditor.current=null;instance.dispose();};
 },[buffer,diff]);
 useEffect(()=>{const line=buffer?.sourceSelection?.line,instance=activeEditor.current;if(!instance||!Number.isSafeInteger(line)||line<1)return;const observed=Math.min(line,buffer.model.getLineCount());instance.setPosition({lineNumber:observed,column:1});instance.revealLineInCenter(observed);instance.focus();},[buffer,buffer?.sourceSelection]);
 return <div ref={element} className="desktop-editor" aria-label={diff?'변경 비교':'파일 편집기'}/>;
}
