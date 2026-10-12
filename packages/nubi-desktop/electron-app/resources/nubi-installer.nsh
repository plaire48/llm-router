; Native installer progress. Percent/bytes come from the bundled 7z extractor.
; Never present extraction percentage as total installation completion.
!include "${__FILEDIR__}\nsis-generated\paths.nsh"
!cd "${__FILEDIR__}\nsis-generated"
!include "nsDialogs.nsh"
!define MUI_TEXTCOLOR "191F28"
!define MUI_BGCOLOR "F1F7FE"
!define MUI_FINISHPAGE_TITLE "누비 Workspace 설치 완료"
!define MUI_FINISHPAGE_TEXT "준비가 끝났어요. 누비 Workspace를 시작하세요."
!define MUI_FINISHPAGE_RUN_TEXT "누비 Workspace 실행"

!macro customHeader
  ShowInstDetails hide
  ShowUninstDetails hide
  SetFont "맑은 고딕" 10
!ifndef BUILD_UNINSTALLER
  Var NubiStarted
  Var NubiElapsed
  Var NubiPhase
  Var NubiLog
  Var NubiTimer
  Function NubiTick
    Push $0
    System::Call 'kernel32::GetTickCount() i .r0'
    IntOp $0 $0 - $NubiStarted
    IntOp $NubiElapsed $0 / 1000
    !insertmacro MUI_HEADER_TEXT "$NubiPhase" "경과 $NubiElapsed초"
    Pop $0
  FunctionEnd
  Function NubiProgressShow
    GetFunctionAddress $NubiTimer NubiTick
    nsDialogs::CreateTimer $NubiTimer 1000
  FunctionEnd
!endif
!macroend

!macro customInit
  System::Call 'kernel32::GetTickCount() i .s'
  Pop $NubiStarted
  CreateDirectory "$LOCALAPPDATA\Nubi Workspace\Installer"
  FileOpen $NubiLog "$LOCALAPPDATA\Nubi Workspace\Installer\last-install.log" w
  FileClose $NubiLog
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW NubiProgressShow
!macroend

!macro NubiStage TEXT
  Push $R8
  StrCpy $R8 0
  IfErrors 0 +2
    StrCpy $R8 1
  ClearErrors
  StrCpy $NubiPhase "${TEXT}"
  ${IfNot} ${Silent}
    Call NubiTick
  ${EndIf}
  DetailPrint "${TEXT}"
  FileOpen $NubiLog "$LOCALAPPDATA\Nubi Workspace\Installer\last-install.log" a
  FileWrite $NubiLog "${TEXT}$\t$NubiElapsed$\r$\n"
  FileClose $NubiLog
  ${If} $R8 == 1
    SetErrors
  ${Else}
    ClearErrors
  ${EndIf}
  Pop $R8
!macroend

!macro customInstall
  !insertmacro NubiStage "설치 완료"
  ${IfNot} ${Silent}
    nsDialogs::KillTimer $NubiTimer
  ${EndIf}
!macroend
