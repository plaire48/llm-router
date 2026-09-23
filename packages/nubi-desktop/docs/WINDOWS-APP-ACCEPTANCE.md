# Windows 업무 앱 검증

사용자 우선순위는 메신저, PowerShell과 Bash다. 전체 앱 지원을 선언하지 않고 실제 수행한 작업과 결과를 기록한다.

## 적용

1. 셸 업무는 기존 명령 실행기를 사용한다. PowerShell의 UTF-8 출력과 EncodedCommand를 적용해 한글과 따옴표를 보존한다. stdout/stderr는 각각 StringDecoder로 읽어 나뉜 UTF-8 바이트를 복원한다. 명령 승인과 관리자 UAC 경계는 유지한다.
2. 앱 업무는 등록된 EXE 실행 → 살아 있는 PID의 창 확인 → 사용자 창 연결 → UIA 관찰 → 단일 동작 승인 → 실제 값과 캡처 확인으로 진행한다.
3. 메신저는 초안 입력과 수신자 확인을 우선 검증한다. 입력 재조회는 전송 증거가 아니다. 전송은 별도 승인과 결과 확인이 필요하다. 실제 메시지를 호환성 검사 목적으로 보내지 않는다.

## 네이티브 회귀 검사

`scripts/check-windows-workflow.mjs`는 Windows에 한글과 공백이 포함된 경로의 전용 WinForms 앱을 컴파일한다. 실제 ProjectService를 통해 EXE를 등록하고 승인 후 실행하며, 입력한 한글 초안을 다시 읽고 별도 승인으로 파일에 저장한다. 파일을 독립적으로 읽고 중복 승인에도 저장이 한 번인지 확인한다. 승인 입력은 테스트 코드가 주입하므로 실제 사용자의 HITL 경험을 증명하지 않는다.

같은 검사에서 실제 PowerShell과 설치된 Git Bash의 한글 출력 및 종료 코드 7을 확인한다. 드라이버 단독 WPF 검사와 달리 앱 등록, 실행, 작업 상태와 저장 영수증까지 연결한다. 테스트 앱은 실제 메신저가 아니며 회사 프로그램의 호환성이나 실모델 판단 정확도를 증명하지 않는다.

Windows 러너 검사를 통과해도 실제 Windows 11 사용자 PC에서 다음을 별도로 확인해야 한다: 대상 메신저의 이름과 버전, UIA 입력란/수신자 표시, 100~200% DPI, 잠금/해제, 사용자 동시 입력, 보안 프로그램, SSO, UAC와 관리자 앱. 현대 Windows Terminal은 사용자 입력창의 UIA 텍스트 설정을 지원하지 않을 수 있어 명령 실행 도구를 우선한다. Git Bash는 설치되어야 목록에 나타나며 WSL과 MSIX 앱 시작은 아직 구현하지 않았다.

## BP와 오픈소스 판단

- [Anthropic Computer Use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool): 호스트가 작업을 실행하고 새 관찰을 모델에 돌려주는 방식, 실제 영향이 있는 동작의 사용자 통제를 적용했다. 해당 API의 기능 목록을 누비 Windows 지원 목록으로 취급하지 않는다.
- [OpenAI Computer Use](https://developers.openai.com/api/docs/guides/tools-computer-use): 동작 후 캡처와 결과를 기반으로 이어가는 루프를 참고했다. 별도 API 계정이나 모델 교체는 도입하지 않았다.
- [Microsoft winapp CLI](https://github.com/microsoft/winappCli): 이미 고정한 MIT 드라이버를 재사용한다. 실제 UIA와 마우스 테스트를 배포 검사에 연결한다.
- [Microsoft UFO](https://github.com/microsoft/UFO), [FlaUI](https://github.com/FlaUI/FlaUI): 앱별 구조화된 제어와 UI 조작을 조합하는 접근을 검토했다. 현재 드라이버와 중복되는 런타임은 추가하지 않았다. 실제 대상 앱에서 현재 드라이버가 지원하지 않는 패턴이 확인되면 비교 평가한다.

실제 Windows 11과 회사 메신저를 연결하지 못한 상태에서 모든 기능이 동작한다고 표시하지 않는다. 가상 커서는 실제 동작 위치를 보여주는 시각 효과이며, 다른 OS 입력 장치나 포커스 격리가 아니다.
