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
!define MUI_HEADERIMAGE_BITMAP_STRETCH FitControl
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH FitControl

!macro NubiDurationLabel Output Seconds
  IntOp $0 ${Seconds} / 60
  IntOp $1 ${Seconds} % 60
  ${If} $0 == 0
    StrCpy ${Output} "$1초"
  ${ElseIf} $1 == 0
    StrCpy ${Output} "$0분"
  ${Else}
    StrCpy ${Output} "$0분 $1초"
  ${EndIf}
!macroend

!macro customHeader
  BrandingText "누비 Workspace Beta"
  ShowInstDetails hide
  ShowUninstDetails hide
  SetFont "맑은 고딕" 10
!ifndef BUILD_UNINSTALLER
  Var NubiStarted
  Var NubiElapsed
  Var NubiElapsedLabel
  Var NubiPhase
  Var NubiLog
  Var NubiPhaseStarted
  Var NubiExtracted
  Var NubiExtractTotal
  Var NubiExtractPercent
  Var NubiExtractCallback
  Var NubiLastTitle
  Var NubiLastDescription
  Var NubiLastPercent
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
    !insertmacro NubiDurationLabel $NubiElapsedLabel $NubiElapsed
    StrCpy $4 "진행 $NubiElapsedLabel"
    ${If} $NubiPhase == "앱 파일 풀기"
    ${AndIf} $5 >= 1
      StrCpy $2 $NubiExtractPercent
        ${If} $2 > 0
        ${AndIf} $2 < 100
          IntOp $3 100 - $2
          IntOp $3 $3 * $5
          IntOp $3 $3 / $2
          IntOp $3 $3 / 5
          IntOp $3 $3 + 1
          IntOp $3 $3 * 5
          !insertmacro NubiDurationLabel $3 $3
          StrCpy $4 "진행 $NubiElapsedLabel / 파일 풀기 약 $3 남음"
        ${EndIf}
    ${ElseIf} $NubiPhase == "설치 완료"
      StrCpy $4 "소요 $NubiElapsedLabel"
    ${EndIf}
    ${If} $NubiLastTitle != $NubiPhase
    ${OrIf} $NubiLastDescription != $4
      !insertmacro MUI_HEADER_TEXT "$NubiPhase" "$4"
      StrCpy $NubiLastTitle $NubiPhase
      StrCpy $NubiLastDescription $4
    ${EndIf}
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd
  ; Update from the real extraction callback and stage boundaries only.
  ; nsDialogs timers require a live custom dialog; the stock instfiles page
  ; has no such owner and must never register one.
  Function NubiExtractionProgress
    Pop $NubiExtracted
    Pop $NubiExtractTotal
    Push $0
    Push $1
    ${If} $NubiExtractTotal > 0
      System::Int64Op $NubiExtracted * 100
      Pop $0
      System::Int64Op $0 / $NubiExtractTotal
      Pop $NubiExtractPercent
      ${If} $NubiLastPercent != $NubiExtractPercent
        IntOp $0 $NubiExtracted / 1048576
        IntOp $1 $NubiExtractTotal / 1048576
        SetDetailsPrint textonly
        DetailPrint "파일 풀기 $NubiExtractPercent% ($0 / $1 MB)"
        SetDetailsPrint both
        StrCpy $NubiLastPercent $NubiExtractPercent
      ${EndIf}
      Call NubiTick
    ${EndIf}
    Pop $1
    Pop $0
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
!macroend
