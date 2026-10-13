#ifndef AppVersion
  #define AppVersion "0.8.12"
#endif
[Setup]
AppId={{A2EE607F-D951-4CC3-9B1C-6170685282FE}
AppName=Nubi Office X
AppVersion={#AppVersion}
AppPublisher=Nubi Office X
DefaultDirName={commonpf}\Nubi Office X
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
MinVersion=10.0
ArchitecturesAllowed=x86compatible x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\releases
OutputBaseFilename=Nubi-Office-X-{#AppVersion}-Setup
Compression=zip/7
SolidCompression=no
WizardStyle=modern
InfoBeforeFile=INSTALL-KO.txt
UninstallDisplayName=Nubi Office X
; The Nubi bird, generated from the shared brand master by scripts/office-icons.mjs.
SetupIconFile=nubi.ico
UninstallDisplayIcon={app}\nubi.ico
CloseApplications=yes
CloseApplicationsFilter=*.dll,*.exe
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[LangOptions]
DialogFontName=Malgun Gothic
DialogFontSize=10

[Types]
Name: "full"; Description: "Excel, Word, PowerPoint"
Name: "custom"; Description: "사용할 Office 앱 선택"; Flags: iscustom

[Components]
Name: "core"; Description: "누비 공통 실행 구성요소"; Types: full custom; Flags: fixed
Name: "excel"; Description: "Excel 2016 추가 기능"; Types: full
Name: "word"; Description: "Word 2016 추가 기능"; Types: full
Name: "powerpoint"; Description: "PowerPoint 2016 추가 기능"; Types: full

[Files]
Source: "nubi.ico"; DestDir: "{app}"; Components: core; Flags: ignoreversion
Source: "stage\*"; DestDir: "{app}"; Excludes: "OfficeX.ExcelAddIn.*,OfficeX.WordAddIn.*,OfficeX.PowerPointAddIn.*"; Components: core; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\OfficeX.ExcelAddIn.*"; DestDir: "{app}"; Components: excel; Flags: ignoreversion
Source: "stage\OfficeX.WordAddIn.*"; DestDir: "{app}"; Components: word; Flags: ignoreversion
Source: "stage\OfficeX.PowerPointAddIn.*"; DestDir: "{app}"; Components: powerpoint; Flags: ignoreversion
Source: "runtime\x64\node.exe"; DestDir: "{app}\OfficeX\runtime"; Components: core; Check: IsWin64; Flags: ignoreversion
Source: "runtime\x86\node.exe"; DestDir: "{app}\OfficeX\runtime"; Components: core; Check: not IsWin64; Flags: ignoreversion
Source: "prerequisites\vstor_redist.exe"; Flags: dontcopy
Source: "prerequisites\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Registry]
Root: HKLM32; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: none; Flags: deletekey; Components: not excel
Root: HKLM32; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "FriendlyName"; ValueData: "Nubi Office X"; Components: excel; Flags: uninsdeletekey
Root: HKLM32; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Description"; ValueData: "Nubi Excel 2016 copilot"; Components: excel
Root: HKLM32; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: dword; ValueName: "LoadBehavior"; ValueData: "3"; Components: excel
Root: HKLM32; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Manifest"; ValueData: "{code:ManifestUri|OfficeX.ExcelAddIn.vsto}"; Components: excel
Root: HKLM64; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: none; Flags: deletekey; Components: not excel; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "FriendlyName"; ValueData: "Nubi Office X"; Components: excel; Flags: uninsdeletekey; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Description"; ValueData: "Nubi Excel 2016 copilot"; Components: excel; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: dword; ValueName: "LoadBehavior"; ValueData: "3"; Components: excel; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\Excel\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Manifest"; ValueData: "{code:ManifestUri|OfficeX.ExcelAddIn.vsto}"; Components: excel; Check: IsWin64
Root: HKLM32; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: none; Flags: deletekey; Components: not word
Root: HKLM32; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "FriendlyName"; ValueData: "Nubi Office X"; Components: word; Flags: uninsdeletekey
Root: HKLM32; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Description"; ValueData: "Nubi Word 2016 copilot"; Components: word
Root: HKLM32; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: dword; ValueName: "LoadBehavior"; ValueData: "3"; Components: word
Root: HKLM32; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Manifest"; ValueData: "{code:ManifestUri|OfficeX.WordAddIn.vsto}"; Components: word
Root: HKLM64; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: none; Flags: deletekey; Components: not word; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "FriendlyName"; ValueData: "Nubi Office X"; Components: word; Flags: uninsdeletekey; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Description"; ValueData: "Nubi Word 2016 copilot"; Components: word; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: dword; ValueName: "LoadBehavior"; ValueData: "3"; Components: word; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\Word\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Manifest"; ValueData: "{code:ManifestUri|OfficeX.WordAddIn.vsto}"; Components: word; Check: IsWin64
Root: HKLM32; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: none; Flags: deletekey; Components: not powerpoint
Root: HKLM32; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "FriendlyName"; ValueData: "Nubi Office X"; Components: powerpoint; Flags: uninsdeletekey
Root: HKLM32; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Description"; ValueData: "Nubi PowerPoint 2016 copilot"; Components: powerpoint
Root: HKLM32; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: dword; ValueName: "LoadBehavior"; ValueData: "3"; Components: powerpoint
Root: HKLM32; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Manifest"; ValueData: "{code:ManifestUri|OfficeX.PowerPointAddIn.vsto}"; Components: powerpoint
Root: HKLM64; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: none; Flags: deletekey; Components: not powerpoint; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "FriendlyName"; ValueData: "Nubi Office X"; Components: powerpoint; Flags: uninsdeletekey; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Description"; ValueData: "Nubi PowerPoint 2016 copilot"; Components: powerpoint; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: dword; ValueName: "LoadBehavior"; ValueData: "3"; Components: powerpoint; Check: IsWin64
Root: HKLM64; Subkey: "Software\Microsoft\Office\PowerPoint\Addins\OfficeX.GenOffice"; ValueType: string; ValueName: "Manifest"; ValueData: "{code:ManifestUri|OfficeX.PowerPointAddIn.vsto}"; Components: powerpoint; Check: IsWin64

[InstallDelete]
; Remove the retired standalone product from earlier installations. User documents/accounts stay outside this folder.
Type: filesandordirs; Name: "{app}\OfficeX\companion"
Type: files; Name: "{commonprograms}\Nubi Office X\누비 GenOffice.lnk"
; 0.8.6 and earlier installed Office interop assemblies. The host now embeds the interop types.
Type: files; Name: "{app}\Microsoft.Office.Interop.Excel.dll"
Type: files; Name: "{app}\Microsoft.Office.Interop.Word.dll"
Type: files; Name: "{app}\Microsoft.Office.Interop.PowerPoint.dll"
Type: files; Name: "{app}\Microsoft.Vbe.Interop.dll"
Type: files; Name: "{app}\OfficeX.ExcelAddIn.*"; Components: not excel
Type: files; Name: "{app}\OfficeX.WordAddIn.*"; Components: not word
Type: files; Name: "{app}\OfficeX.PowerPointAddIn.*"; Components: not powerpoint

[Icons]
Name: "{commonprograms}\Nubi Office X\설치 및 사용 안내"; Filename: "{app}\INSTALL-KO.txt"; IconFilename: "{app}\nubi.ico"

[Code]
function ManifestUri(Param: String): String;
begin
  Result := ExpandConstant('{app}\') + Param;
  StringChangeEx(Result, '\', '/', True);
  StringChangeEx(Result, ' ', '%20', True);
  Result := 'file:///' + Result + '|vstolocal';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpSelectComponents) and not WizardIsComponentSelected('excel') and not WizardIsComponentSelected('word') and not WizardIsComponentSelected('powerpoint') then begin
    MsgBox('사용할 Office 앱을 하나 이상 선택해 주세요.', mbInformation, MB_OK);
    Result := False;
  end;
end;

function VstoInstalled: Boolean;
var Value: Cardinal;
begin
  Result := (RegQueryDWordValue(HKLM32, 'SOFTWARE\Microsoft\VSTO Runtime Setup\v4R', 'VSTORFeature_CLR40', Value) and (Value = 1));
  if not Result and IsWin64 then
    Result := (RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\VSTO Runtime Setup\v4R', 'VSTORFeature_CLR40', Value) and (Value = 1));
end;

function WebViewInstalled: Boolean;
var Version: String;
begin
  Result := RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  if not Result then Result := RegQueryStringValue(HKCU32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  if not Result and IsWin64 then Result := RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  Result := Result and (StrToIntDef(Copy(Version, 1, Pos('.', Version) - 1), 0) >= 110);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ExitCode: Integer; Release: Cardinal;
begin
  Result := '';
  if not WizardIsComponentSelected('excel') and not WizardIsComponentSelected('word') and not WizardIsComponentSelected('powerpoint') then begin Result := '사용할 Office 앱을 하나 이상 선택해 주세요.'; Exit; end;
  if not RegQueryDWordValue(HKLM32, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) or (Release < 461808) then begin
    Result := '.NET Framework 4.7.2 이상을 먼저 설치해 주세요. / .NET Framework 4.7.2 or newer is required.';
    Exit;
  end;
  if not VstoInstalled then begin
    ExtractTemporaryFile('vstor_redist.exe');
    if not Exec(ExpandConstant('{tmp}\vstor_redist.exe'), '/q /norestart', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then ExitCode := -1;
    if (ExitCode <> 0) and (ExitCode <> 3010) then begin
      Result := 'VSTO 설치에 실패했습니다. 설치 로그와 회사 정책을 확인해 주세요. (' + IntToStr(ExitCode) + ')';
      Exit;
    end;
    if ExitCode = 3010 then NeedsRestart := True;
    if not VstoInstalled then begin Result := 'VSTO 설치 결과를 확인하지 못했습니다. PC를 다시 시작한 뒤 설치해 주세요.'; Exit; end;
  end;
  if not WebViewInstalled then begin
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then ExitCode := -1;
    if ((ExitCode <> 0) and (ExitCode <> 3010)) or not WebViewInstalled then begin
      Result := 'WebView2 설치에 실패했습니다. 인터넷 연결과 회사 설치 정책을 확인해 주세요. (' + IntToStr(ExitCode) + ')';
      Exit;
    end;
    if ExitCode = 3010 then NeedsRestart := True;
  end;
end;
