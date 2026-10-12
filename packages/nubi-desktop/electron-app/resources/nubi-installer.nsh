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
!define MUI_HEADERIMAGE_BITMAP_STRETCH AspectFitHeight
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH AspectFitHeight

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
  Var NubiPhaseStarted
  Function NubiTick
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    System::Call 'kernel32::GetTickCount() i .r0'
    IntOp $5 $0 - $NubiPhaseStarted
    IntOp $5 $5 / 1000
    IntOp $0 $0 - $NubiStarted
    IntOp $NubiElapsed $0 / 1000
    StrCpy $4 "경과 $NubiElapsed초 / 남은 시간 계산 중"
    ${If} $NubiPhase == "앱 파일 풀기"
    ${AndIf} $5 >= 2
      FindWindow $0 "#32770" "" $HWNDPARENT
      GetDlgItem $1 $0 1006
      SendMessage $1 ${WM_GETTEXT} ${NSIS_MAX_STRLEN} "STR:$2"
      StrLen $3 "파일 풀기 "
      StrCpy $0 $2 $3
      ${If} $0 == "파일 풀기 "
        StrCpy $2 $2 "" $3
        IntOp $2 $2 + 0
        ${If} $2 > 0
        ${AndIf} $2 < 100
          IntOp $3 100 - $2
          IntOp $3 $3 * $5
          IntOp $3 $3 / $2
          IntOp $3 $3 / 5
          IntOp $3 $3 + 1
          IntOp $3 $3 * 5
          StrCpy $4 "경과 $NubiElapsed초 / 파일 풀기 약 $3초 남음"
        ${EndIf}
      ${EndIf}
    ${ElseIf} $NubiPhase == "설치 완료"
      StrCpy $4 "경과 $NubiElapsed초"
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "$NubiPhase" "$4"
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
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
  System::Call 'kernel32::GetTickCount() i .s'
  Pop $NubiPhaseStarted
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
