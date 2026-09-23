import path from 'node:path';
import ts from 'typescript';
import {parse as parseJSON,printParseErrorCode} from 'jsonc-parser';
import {parseDocument} from 'yaml';

export const codeLanguage=file=>/\.[cm]?[jt]sx?$/i.test(file)?'typescript':/\.jsonc?$/i.test(file)?'json':/\.ya?ml$/i.test(file)?'yaml':null;
const position=(text,offset)=>{const lines=text.slice(0,offset).split('\n');return {line:lines.length,column:lines.at(-1).length+1};};
const trim=value=>String(value).slice(0,300);
function sourceFile(file,content){return ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true);}
function syntax(file,content){
  const language=codeLanguage(file);let diagnostics=[];
  if(language==='typescript'){
    const source=sourceFile(file,content);
    // A closed, in-memory host. No project config, imports, plugins or code run.
    const host={getSourceFile:name=>name===file?source:undefined,getDefaultLibFileName:()=>'',writeFile(){},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:name=>name===file,readFile:name=>name===file?content:undefined,getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n'};
    const program=ts.createProgram([file],{noResolve:true,noLib:true,noEmit:true,allowJs:true,checkJs:true,target:ts.ScriptTarget.Latest,jsx:ts.JsxEmit.Preserve},host);
    diagnostics=program.getSyntacticDiagnostics(source).map(d=>({code:'TS'+d.code,message:trim(ts.flattenDiagnosticMessageText(d.messageText,' ')),...position(content,d.start||0)}));
  }else if(language==='json'){
    const errors=[],comments=/\.jsonc$/i.test(file)||/^tsconfig(?:\.[^.]+)*\.json$/i.test(path.basename(file));
    parseJSON(content,errors,{disallowComments:!comments,allowTrailingComma:comments,allowEmptyContent:false});
    diagnostics=errors.map(d=>({code:printParseErrorCode(d.error),message:printParseErrorCode(d.error),...position(content,d.offset)}));
  }else if(language==='yaml'){
    const parsed=parseDocument(content,{uniqueKeys:true,strict:true});
    diagnostics=parsed.errors.map(d=>({code:d.code,message:trim(d.message.split('\n')[0]),...position(content,d.pos?.[0]||0)}));
  }
  return {engine:language==='typescript'?'typescript@'+ts.version:language==='json'?'jsonc-parser@3.3.1':language==='yaml'?'yaml@2.9.0':null,supported:!!language,diagnostics:diagnostics.slice(0,30),errorCount:diagnostics.length,truncated:diagnostics.length>30,scope:'syntax_only'};
}
function outline(file,content){
  if(codeLanguage(file)!=='typescript')return {supported:false,symbols:[],imports:[],truncated:false};
  const source=sourceFile(file,content),symbols=[],imports=[];let visited=0,truncated=false;
  const visit=node=>{
    if(++visited>30000){truncated=true;return;}
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
      if(node.moduleSpecifier&&imports.length<50)imports.push({module:trim(node.moduleSpecifier.text),...position(content,node.getStart(source))});
      else if(imports.length>=50)truncated=true;
    }
    let name,kind;
    if(ts.isFunctionDeclaration(node)){name=node.name?.getText(source)||'default';kind='function';}
    else if(ts.isClassDeclaration(node)){name=node.name?.getText(source)||'default';kind='class';}
    else if(ts.isMethodDeclaration(node)){name=node.name.getText(source);kind='method';}
    else if(ts.isInterfaceDeclaration(node)){name=node.name.text;kind='interface';}
    else if(ts.isTypeAliasDeclaration(node)){name=node.name.text;kind='type';}
    else if(ts.isEnumDeclaration(node)){name=node.name.text;kind='enum';}
    else if(ts.isVariableDeclaration(node)&&node.initializer&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer))){name=node.name.getText(source);kind='function';}
    if(name){if(symbols.length>=100){truncated=true;return;}symbols.push({name:trim(name),kind,start:position(content,node.getStart(source)).line,end:position(content,Math.max(node.getStart(source),node.end-1)).line});}
    if(visited<30000)ts.forEachChild(node,visit);
  };
  visit(source);return {supported:true,symbols,imports,truncated,scope:'file_syntax_structure_only'};
}
export function analyzeCode(input){
  if(input.mode==='outline')return outline(input.path,input.content);
  return {before:syntax(input.path,input.before),after:syntax(input.path,input.after)};
}
