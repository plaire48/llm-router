import {readFile,mkdir,writeFile,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const root=path.dirname(require.resolve('app-builder-lib/package.json'));
const output=path.resolve('electron-app/resources/nsis-generated');
const sources={
  'installSection.nsh':'74c4dbb4163cdd90ca4850b75d304e916235c882d6af7b5cdad63bffbc977072',
  'include/extractAppPackage.nsh':'e4174388a0f7a1df0b85a0742aa1ea7a4b2b18f9f29dccd6ef10a66212f68148',
  'include/installUtil.nsh':'97bd546b5cd2aaf16b77bc9e2be8a18962dd74ab5c4d23b35b163ca89bf4dd2a',
  'assistedInstaller.nsh':'8aa1230e9717b428664d613fcc5c6a060883410b34cb7853b517fe11b4ee0a76'
};
if(JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version!=='26.15.3')throw Error('installer_template_version_changed');
await mkdir(output,{recursive:true});
// Preserve the upstream working-directory lookup, especially multiUser.nsh:
// NSIS ships a different case-insensitive MultiUser.nsh in its own includes.
await cp(path.join(root,'templates/nsis'),output,{recursive:true});
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
  }else if(file==='include/installUtil.nsh'){
    for(const name of ['uninstallerFileNameTemp','uninstallerFileName']){
      const command=`'"$${name}" /S /KEEP_APP_DATA $0 _?=$installationDir'`;
      replace(`ExecWait ${command} $R0`,`Push ${command}\n      Call NubiWaitForUninstaller\n      StrCpy $R0 $NubiProcessExit`);
    }
  }else if(file==='assistedInstaller.nsh'){
    replace('${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"',
      `!insertmacro MUI_HEADER_TEXT "누비 Workspace 여는 중" "설치는 끝났어요. 앱을 시작합니다."\n        GetDlgItem $2 $HWNDPARENT 1\n        EnableWindow $2 0\n        SetOutPath "$INSTDIR"\n        \${If} \${UAC_IsAdmin}\n          \${StdUtils.ExecShellAsUser} $0 "$appExe" "open" "$1"\n        \${Else}\n          Exec '"$appExe" $1'\n          \${If} \${Errors}\n            MessageBox MB_OK|MB_ICONEXCLAMATION "앱을 열지 못했어요. 바탕 화면의 누비 Workspace를 실행해 주세요."\n          \${EndIf}\n        \${EndIf}`);
  }else{
    replace('  Nsis7z::Extract "${FILE}"\n  Pop $R0','  !insertmacro NubiStage "앱 파일 풀기"\n  GetFunctionAddress $NubiExtractCallback NubiExtractionProgress\n  Nsis7z::ExtractWithCallback "${FILE}" $NubiExtractCallback\n  Pop $R0');
    replace('    CopyFiles /SILENT','    !insertmacro NubiStage "앱 파일 배치"\n    CopyFiles /SILENT');
  }
  await writeFile(path.join(output,path.basename(file)),text);
  // Includes may be resolved relative to another upstream include.
  if(file.includes('/'))await writeFile(path.join(output,file),text);
}
await writeFile(path.join(output,'provenance.json'),JSON.stringify({upstream:'electron-builder/app-builder-lib',version:'26.15.3',license:'MIT',sources,scope:'Measured progress during extraction and old-uninstaller wait; direct asynchronous non-elevated launch on Finish. Original upgrade arguments, exit checks, atomic copy and recovery retained.'},null,2));
await writeFile(path.join(output,'paths.nsh'),`!addincludedir "${path.join(root,'templates/nsis')}"\n`);
console.log('Prepared locked NSIS progress hooks');
