# 누비 Windows 로컬 업무 제어 개선

2026-09-23. 대상은 Windows 11 로컬 업무와 자체 OpenWiki-SDS다. 최신 사용자 결정에 따라 UIA를 우선 사용하고 실제 로컬 마우스는 동작별 HITL로 허용한다. A2A 구현은 보류한다.

## 이번에 반영한 내용

기존 Microsoft winapp 어댑터에 명시적인 UIA 선택, 체크 켜기와 끄기, 펼치기와 접기를 추가했다. `invoke --action`으로 정확한 패턴만 호출한다. 지원하지 않는 경우 다른 패턴이나 부모 컨트롤로 우회하지 않는다. 실제 마우스가 필요한 경우 별도 제안과 승인을 받는다. 체크 상태를 무조건 반전시키는 `toggle`은 노출하지 않는다.

실행 전 UIA 상태를 읽고 승인 직전에도 창, 대상, 현재 상태가 같은지 확인한다. 이미 목표 상태면 네이티브 변경 명령을 보내지 않는다. 실행 후에는 `IsSelected`, `ToggleState`, `ExpandCollapseState`를 다시 읽는다. 일치, 불일치, 조회 불가를 분리한다. 상태 일치는 해당 컨트롤에 한정되며 저장과 업무 완료를 증명하지 않는다.

OpenWiki-SDS의 `wiki_query`에서 주 실행기가 실제 조회한 근거 ID를 앱 동작에 연결한다. 기존 Claims와 파일 해시 검사를 재사용해 제안과 승인 직전에 문서, 참조 소스, Claims, 제외 규칙을 재검증한다. 근거가 변경되면 실행하지 않는다. 버전 정보가 없는 문서는 검증되지 않은 참고 정보로 표시한다. 모델이 근거 ID를 생략한 요청까지 자동으로 연결됐다고 보장하지 않는다.

기존 Pi 실행기와 문맥 관리, 하위 분석, 결과 영수증, HITL을 유지한다. 문맥 재구성 후에는 Wiki 근거도 다시 조회해야 한다. 응답 유실이나 상태 조회 실패는 재실행 사유가 아니다. 실제 상태를 먼저 조회한다. 재시작은 창 연결 권한을 복원하지 않는다.

## 오픈소스 선택

| 후보 | 검토 결과와 판단 |
| --- | --- |
| [Microsoft winapp CLI](https://github.com/microsoft/winappCli/tree/d626d2b53b9eea27ae2972e9153ce0b1d4c52825), MIT | 실제 적용. 기존 번들 방식, JSON 응답, 명시적인 UIA 패턴을 재사용한다. 소스와 해시를 고정하고 기존 IsPassword 수정 패치를 유지한다. Preview이므로 대상 앱의 실제 호환 검증이 필요하다. |
| [FlaUI](https://github.com/FlaUI/FlaUI), MIT | UIA2와 UIA3 선택 및 .NET 앱 제어가 강점이다. 현재 드라이버와 역할이 겹친다. 특정 WinForms 앱에서 UIA3 문제가 재현되면 UIA2 경로를 비교할 후보로 남긴다. 추가 도입하지 않았다. |
| [pywinauto](https://github.com/pywinauto/pywinauto), BSD-3-Clause | Win32와 UIA 제어가 가능하다. Python과 COM 의존성을 추가해야 하며 물리 입력 계열 API를 별도 차단해야 한다. 현재 범위에서 두 번째 런타임을 도입할 이득을 확인하지 못했다. |
| [Windows-MCP](https://github.com/CursorTouch/Windows-MCP), MIT | 앱 탐색, 상태 조회와 실행 도구를 비교했다. 실제 포인터 입력도 가능하지만 별도 Python 실행기와 넓은 도구 표면이 필요하다. 최신 HITL 조건에서는 사용할 수 있는 후보이나, 같은 기능을 제공하는 기존 winapp을 확장해 실행기를 중복 도입하지 않았다. |
| [Microsoft UFO의 API와 GUI 조합](https://github.com/microsoft/UFO/blob/main/documents/docs/ufo2/core_features/hybrid_actions.md) | 방법론 참고. 사용 가능한 앱 API로 정확한 데이터 작업을 하고 UIA와 화면으로 확인한다. 전체 프레임워크를 추가하지 않고 기존 누비 실행기를 개선했다. 미확정 쓰기 뒤 GUI로 같은 작업을 다시 하는 자동 fallback은 채택하지 않았다. |

추가 종속성은 없다. 라이브러리 수를 늘리는 대신 고정한 winapp의 기존 기능을 누비의 승인, 상태 검증, 근거 관리에 실제 연결했다. 후보별 모델 정확도나 속도 우열은 측정하지 않았다.

## 확인한 공식 소스와 방법론

- [winapp ExplicitUiInvoker.cs](https://github.com/microsoft/winappCli/blob/d626d2b53b9eea27ae2972e9153ce0b1d4c52825/src/winapp-CLI/WinApp.UIAutomation/Services/ExplicitUiInvoker.cs): 명시적 패턴, 목표 상태 설정, 지원하지 않는 패턴 거부를 확인했다. Indeterminate 체크 상태의 내부 전이는 최대 두 번이다. 이는 새로운 승인 작업을 재전송하는 방식과 다르다.
- [winapp ValueSetter.cs](https://github.com/microsoft/winappCli/blob/d626d2b53b9eea27ae2972e9153ce0b1d4c52825/src/winapp-CLI/WinApp.UIAutomation/Services/ValueSetter.cs): 값 설정은 UIA와 LegacyIAccessible 경로를 사용한다. 마지막 send-keys 안내는 실패 메시지이며 누비는 이를 실행하지 않는다.
- [winapp UIA 문서](https://github.com/microsoft/winappCli/blob/main/docs/ui-automation.md): 같은 Windows 데스크톱의 포인터와 포커스는 공유된다. 캡처는 창을 복원하거나 앞으로 가져올 수 있다. 현재 가상 커서 표시는 두 번째 Windows 입력 장치가 아니다.
- [Anthropic Computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool): 별도 VM 또는 컨테이너와 관찰, 실행, 재관찰 구조를 참고했다. 실제 Windows에서 독립 커서를 제공하는 구현을 가져온 것은 아니다.
- [OpenAI Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use): 격리된 브라우저 또는 데스크톱 실행 환경, 스크린샷 반환, 최종 상태 확인을 참고했다. 공개 API 예제이며 Codex 데스크톱의 비공개 구현과 동일하다고 주장하지 않는다.

## 실제 마우스 제어와 HITL

사용자가 격리 환경 대신 실제 PC 마우스를 HITL로 조작하도록 요청했다. 로컬 `pointer_click`, `pointer_double_click`, `pointer_right_click`, `hover`, `drag`를 새로 연결했다. 모델은 동작을 제안할 수 있지만 승인 값은 보낼 수 없다. 승인 UI에서 대상 위치를 본 뒤 `마우스 제어 승인`을 누르면 해당 요청의 fingerprint와 연결한 일회 승인 기록을 남긴다. 다음 동작에는 다시 승인이 필요하다. 구버전 hover 기록은 신규 마우스 승인을 얻지 못한다.

드래그는 같은 관찰에서 확인한 서로 다른 두 selector를 요구한다. 두 대상의 상태와 위치를 승인 직전에 다시 확인하고 출발지와 도착지를 각각 보여준다. 화면 좌표를 임의로 입력하거나 다른 창으로 드래그하지 않는다. 기존 Wiki 근거 검사, 전역 직렬 실행, 잠금 화면과 포커스 거부, 응답 유실 처리도 유지한다.

기존 winapp의 [UiDragCommand](https://github.com/microsoft/winappCli/blob/d626d2b53b9eea27ae2972e9153ce0b1d4c52825/src/winapp-CLI/WinApp.Cli/Commands/UiDragCommand.cs), [UiHoverCommand](https://github.com/microsoft/winappCli/blob/d626d2b53b9eea27ae2972e9153ce0b1d4c52825/src/winapp-CLI/WinApp.Cli/Commands/UiHoverCommand.cs), [MouseInput](https://github.com/microsoft/winappCli/blob/d626d2b53b9eea27ae2972e9153ce0b1d4c52825/src/winapp-CLI/WinApp.UIAutomation/Input/MouseInput.cs)을 확인했다. 창 포커스와 대상 안정성 검사, 드래그 도중 예외의 버튼 해제 처리를 재사용한다. 강제 프로세스 종료나 OS 장애에서까지 버튼 해제를 보장하는 것은 아니다.

중지 요청은 같은 작업을 cancelled로 보존한다. 이미 시작한 짧은 네이티브 동작은 끝날 수 있지만 이후 캡처와 추가 작업으로 진행하지 않는다. 원래 상태로 되돌렸다고 표시하지 않는다. 사용자가 다시 움직인 커서를 예전 위치로 강제 복원하지 않는다. 마우스 이벤트 처리와 애플리케이션 응답이 발생한 사실은 업무 완료와 별도로 확인한다.

## 남은 범위

이 경로는 실제 사용자 마우스를 잠시 공유하므로 동시에 마우스나 키보드를 조작하지 않도록 안내한다. 앱 자체 UIA 구현, 포커스 변경과 사용자 간섭의 모든 경쟁 상태를 제거한 격리 환경은 아니다. UIA selector가 전혀 없는 커스텀 화면의 임의 좌표 조작은 아직 지원하지 않는다. 범용 화면 좌표 제어를 추가하려면 캡처와 모니터 좌표 대응, 최신 화면 검증, 별도 위치 승인을 먼저 구현해야 한다. VM과 원격 화면 전송은 이번 범위에 도입하지 않았다.

## 검증

- 합성 계약 검사: UIA 상태 전이, 이미 목표 상태인 경우, 승인 후 상태 변경, 패턴 부재, 응답 유실, Wiki 변경 차단, 물리 입력 미호출.
- 브라우저 검사: 상태 확인 안내, 근거 펼치기, 만료된 Wiki 안내, 좁은 화면 표시. Windows 실행 검증과 구분한다.
- 전용 Windows workflow: 자체 WPF 창의 버튼, 입력, 체크박스, 목록 선택, 트리 펼치기와 접기, PNG 캡처. UIA 상태 동작 전후 실제 커서 좌표를 읽어 비교한다. 이 검사는 설치 파일을 만들거나 배포하지 않는다. 별도 실제 포인터 검사에서는 WPF의 클릭, 더블 클릭, 오른쪽 클릭, 호버 이벤트와 DragDrop 결과를 확인한다.
- 실제 회사 Windows 11의 SSO 앱, DPI 조합, 잠금 화면, 권한이 다른 프로세스, 실모델 업무 성공률은 별도 검증이 필요하다.

앱 작업을 Wiki에 기록하면 동작에 사용한 문서 경로와 해시도 함께 남고 이후 문서나 참조 소스의 변경을 표시한다. 입력값, 앱 경로, 화면 이미지는 이 Wiki 항목에 내보내지 않는다.


## 가상 포인터와 반복 실패 후 승인

사용자가 제공한 이미지에 맞춰 검정색과 둥근 흰색 테두리의 화살표를 적용했다. 브랜드 글자와 큰 원은 제거했다. 브라우저 카드의 표시는 미리보기이며 실행 자체로 애니메이션을 위장하지 않는다. Windows 앱 위의 별도 WPF 창은 승인 후 실제 UIA 호출 전 대상 위치로 이동하고 호출 시점에 짧게 반응한다. 첫 위치는 즉시 표시하고 같은 창 연결의 후속 위치 사이에서만 180ms 이동한다. 클릭 반응은 140ms이며 결과 캡처 전 숨김 응답을 확인한다. 이미 목표 상태여서 호출하지 않는 경우에는 포인터를 실행한 것처럼 표시하지 않는다.

[Microsoft layered window 지침](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-features)을 적용해 투명 창의 WS_EX_TRANSPARENT, WS_EX_NOACTIVATE와 WM_MOUSEACTIVATE 처리를 사용한다. 사용자 입력을 가로채지 않고 포커스를 요청하지 않는다. [WPF ClientAreaAnimation](https://learn.microsoft.com/en-us/dotnet/api/system.windows.systemparameters.clientareaanimation?view=windowsdesktop-10.0)을 읽어 Windows의 모션 설정을 따른다. 별도 마우스 입력 라이브러리는 추가하지 않았다. 기존 winapp은 실제 조작을, Windows 기본 WPF는 시각적 피드백만 담당한다. Codex 비공개 구현이나 자산을 가져온 것은 아니다.

물리 마우스 제안은 같은 연결과 같은 대상에 대해 새로운 관찰에서 확인한 UIA 패턴 부재가 3회 누적되어야 한다. 이 횟수는 호스트가 기록하며 모델이 입력하지 못한다. 중복 관찰, 암호 대상, 오래된 관찰, 바뀐 창과 대상, 이미 실행했는지 불확실한 실패는 인정하지 않는다. 실행, 연결 변경, 취소와 2분 경과 후에는 조건이 초기화된다. 조건을 채우기 위해 같은 실패를 인위적으로 반복하도록 지시하지 않는다. 자격이 생겨도 실제 마우스 이동은 대상 이미지 확인과 별도 일회 HITL 이후에만 실행한다.

Windows 기본 PowerShell과 WPF를 사용하는 시각화 도우미는 보안 정책을 변경하거나 ExecutionPolicy를 우회하지 않는다. 사내 정책으로 실행이 제한된 경우 UIA 조작은 유지하지만 가상 포인터 가용성은 false로 기록한다. 서로 다른 DPI 모니터와 실제 Windows 11 업무 앱의 시각 품질은 별도 검증 범위다.


### 검증 기록 추가

- 로컬 런타임 검사 155개 통과. 반복 실패의 호스트 집계, 관찰 재사용 차단, Pi의 마우스 승인 대기, 실제 조작 호출과 포인터 이벤트 순서, 대상 이동과 숨김 실패를 포함한다.
- 공유 브라우저 UI 검사 16개와 실제 Theia 검사 46개 통과. 검정색 채움, 흰색 테두리, 좁은 화면, reduced-motion과 마우스 승인 구분을 확인했다. 개발 번들 빌드도 통과했다.
- Windows 실행 `35836895454`: 실제 WPF UIA 상태 변경과 커서 좌표 유지, 별도 허용한 클릭/더블 클릭/오른쪽 클릭/호버/드래그 이벤트 통과.
- Windows 실행 `35838455641`은 테스트 창 준비 대기에서 실패했다. 포인터 코드에 도달하지 못했으므로 포인터 검증 결과로 사용하지 않는다. 고정 대기 대신 ContentRendered 준비 신호를 사용하도록 변경했다.
- Windows 실행 `35839569051`의 독립 포인터 검사는 통과했다. 실제 투명 창의 표시와 숨김, 위치, 비활성/입력 통과 스타일, 기존 커서 좌표와 포커스 유지, 시스템 모션 설정에 따른 이동을 검사했다. 전체 UIA 통합 검사도 통과했다. 자체 WPF 앱에서 기존 상태 변경, 값 읽기, 실제 마우스 이벤트와 드래그 결과를 함께 확인했다. 러너는 96 DPI와 ClientAreaAnimation=false였으므로 Windows 네이티브 모션 활성 상태와 다중 DPI 조합은 이번 실행으로 검증했다고 표시하지 않는다. 결과는 `releases/nubi-desktop/visual-pointer-35839569051/`에 보관했다.

위 검증은 설치 파일 배포나 사용자의 실제 Windows 11 업무 앱 검증을 의미하지 않는다.
