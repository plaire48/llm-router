import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const root=path.dirname(require.resolve('app-builder-lib/package.json'));
const output=path.resolve('electron-app/resources/nsis-generated');
const sources={
  'installSection.nsh':'74c4dbb4163cdd90ca4850b75d304e916235c882d6af7b5cdad63bffbc977072',
  'include/extractAppPackage.nsh':'e4174388a0f7a1df0b85a0742aa1ea7a4b2b18f9f29dccd6ef10a66212f68148'
};
if(JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version!=='26.15.3')throw Error('installer_template_version_changed');
await mkdir(output,{recursive:true});
for(const [file,expected] of Object.entries(sources)){
  const source=await readFile(path.join(root,'templates/nsis',file));
  if(createHash('sha256').update(source).digest('hex')!==expected)throw Error('installer_template_changed:'+file);
  let text=source.toString();
  const replace=(from,to)=>{if(text.split(from).length!==2)throw Error('installer_patch_ambiguous:'+from);text=text.replace(from,to);};
  if(file==='installSection.nsh'){
    replace('SetDetailsPrint none','SetDetailsPrint both');
    replace('StrCpy $appExe', '!insertmacro NubiStage "설치 준비"\n\nStrCpy $appExe');
    replace('!insertmacro uninstallOldVersion SHELL_CONTEXT','!insertmacro NubiStage "이전 설치 확인"\n!insertmacro uninstallOldVersion SHELL_CONTEXT');
    replace('!insertmacro installApplicationFiles','!insertmacro NubiStage "설치 파일 준비"\n!insertmacro installApplicationFiles');
    replace('!insertmacro registryAddInstallInfo','!insertmacro NubiStage "바로가기 등록"\n!insertmacro registryAddInstallInfo');
  }else{
    replace('  Nsis7z::Extract "${FILE}"\n  Pop $R0','  !insertmacro NubiStage "앱 파일 풀기"\n  Nsis7z::ExtractWithDetails "${FILE}" "파일 풀기 %s"\n  Pop $R0');
    replace('    CopyFiles /SILENT','    !insertmacro NubiStage "앱 파일 배치"\n    CopyFiles /SILENT');
  }
  await writeFile(path.join(output,path.basename(file)),text);
}
await writeFile(path.join(output,'provenance.json'),JSON.stringify({upstream:'electron-builder/app-builder-lib',version:'26.15.3',license:'MIT',sources,scope:'Progress text and visible details only. Original install, upgrade, atomic copy and recovery logic retained.'},null,2));
await writeFile(path.join(output,'paths.nsh'),`!addincludedir "${path.join(root,'templates/nsis')}"\n`);
console.log('Prepared locked NSIS progress hooks');
