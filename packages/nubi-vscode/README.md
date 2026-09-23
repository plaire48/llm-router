# 누비 Workspace for VS Code

누비 Desktop의 화면과 실행기를 VS Code에서 사용하는 확장입니다. 명령 팔레트의 **Nubi: 누비 열기** 또는 편집기 상단 아이콘으로 엽니다.

## 지원 범위

신뢰한 로컬 Git 작업 공간을 사용합니다. 여러 폴더가 있으면 대상 프로젝트를 직접 선택합니다. 데스크톱과 같은 React 화면, Pi 실행기, OpenWiki-SDS, 질문과 실행 승인을 사용합니다.

| 기능 | VS Code 연결 |
| --- | --- |
| 로그인과 모델 | 기존 AI Pro, ChatGPT, FabriX 연결을 전용 실행기에서 사용 |
| 소스 분석과 변경 | VS Code 파일 열기, 변경 비교, 편집과 저장 확인. 저장하지 않은 사용자 수정 보호 |
| Wiki와 DB | 기존 OpenWiki-SDS 검색, 관계 조회와 DB 스키마 연결 |
| 사용자 스킬 | VS Code 파일 선택기로 ZIP 또는 하위 폴더 포함 등록 |
| 하네스 | 기존 문맥 압축, 읽기 전용 하위 분석, 질문, 복구와 실행 기록 |
| 실행과 비교 | 기존 Bash/PowerShell 실행 승인, 로컬 화면 캡처와 비교 |
| Windows 앱 | Windows 호스트와 검증된 winapp 드라이버에서 기존 UIA, 캡처, 동작별 승인과 포인터 사용 |
| VOC | 기존 JSON 가져오기와 검색. 자동 JSM 수집은 별도 미구현 |

웹용 VS Code, 원격 SSH, WSL과 가상 작업 공간은 현재 지원하지 않습니다. 로컬 PC 앱과 원격 파일 실행을 혼동하지 않도록 호스트에서 차단합니다. A2A도 계속 보류합니다. “같은 실행기를 연결했다”는 것이 모든 앱이나 모든 제공자의 실계정 동작을 검증했다는 뜻은 아닙니다.

Node 24.18.0을 VSIX에 포함합니다. 사용자는 별도 Node나 누비 Desktop 설치가 필요 없습니다. Git과 실제 프로젝트 의존성은 작업 환경에 필요하며, Windows 기본 셸은 PowerShell을 사용할 수 있습니다. Git Bash는 설치된 경우 사용합니다. 화면 비교는 설치된 Edge/Chrome 또는 Playwright Chromium을 사용합니다. Windows UIA는 기존 Desktop의 검증된 드라이버를 빌드에 함께 넣습니다.

## 개발과 패키징

저장소 루트에서 Desktop과 브라우저 확장의 고정 의존성을 먼저 준비합니다. 이후 이 폴더에서:

```sh
npm ci
npm run build
npm run runtime:prepare
npm test
npm run test:vscode
npm run package
```

`build`는 Desktop의 동일한 실행기와 화면을 번들합니다. `runtime:prepare`는 빌드 시에만 공식 Node 아카이브와 SHA-256을 확인하고 전용 실행 파일을 넣습니다. 실행 시에는 네트워크로 코드를 내려받거나 프로젝트가 지정한 Node를 쓰지 않습니다. 패키지는 빌드한 OS와 아키텍처에 한정합니다. Windows는 `nubi-desktop/generated/winapp`을 먼저 준비해야 하며 전용 workflow가 이를 수행합니다. 파일로 설치할 때 VS Code의 **Extensions: Install from VSIX**를 사용합니다. Marketplace 등록과 공개 배포는 하지 않습니다.

상태는 VS Code 확장 전용 globalStorage에 저장하고 인증값은 실행기 메모리에만 유지합니다. 데스크톱의 인증 저장소를 가져오거나 동시에 같은 SQLite 파일을 쓰지 않습니다. 화면을 닫고 다시 열어도 VS Code 실행 중인 동일한 실행기를 사용합니다. VS Code 종료나 실행기 장애 뒤에는 기존 복구 기록을 확인하며 명령을 자동 재전송하지 않습니다.

## 설계 근거

[VS Code Webview](https://code.visualstudio.com/api/extension-guides/webview)의 메시지 통신, CSP, 제한된 localResourceRoots를 사용합니다. 파일 선택, 비교와 저장은 확장 호스트의 공식 API를 사용합니다. [Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)의 실행 위치 구분에 따라 로컬 UI 확장으로 등록했습니다. Webview에서 임의 경로 등록, 루트 변경, 저장 완료 위조, 명령 URI 실행을 허용하지 않습니다.

새 전체 에이전트 프레임워크는 추가하지 않았습니다. 기존 Pi/CX/React/OpenWiki-SDS와 Microsoft의 MIT `@vscode/vsce` 및 `@vscode/test-electron`을 재사용합니다. Node 라이선스와 기존 실행기 고지를 VSIX에 포함합니다. Windows 앱, 실계정 SSO와 모델 품질은 해당 환경에서 별도로 검증해야 합니다.

## 확인한 결과

2026-09-23 macOS arm64의 실제 VS Code 1.132.1에서 계약 검사 7개와 통합 확인 11개를 통과했습니다. 개발 확장과 실제 VSIX 설치본에서 같은 11개 항목을 각각 확인했습니다. 통합 확인은 화면과 스킬 목록, 소스와 Wiki 읽기, 변경 비교, 미저장 수정 보호, 반영과 저장 후 확인, 키보드 되돌리기, 원본 변경 차단, 보고서 열기와 실제 Bash 실행을 포함합니다. 모델 답변을 대체한 제안 fixture를 사용했으며 실모델 성능 평가는 아닙니다.

`NUBI_TEST_VSIX=release/<target>.vsix npm run test:vscode`로 임시 VS Code 프로필에 설치한 패키지를 검증할 수 있습니다. 사용자 프로필은 변경하지 않습니다. Windows VSIX는 `.github/workflows/nubi-vscode-windows.yml`에 빌드와 검사 절차를 준비했으며 이 macOS 결과로 Windows 설치나 앱 조작 성공을 주장하지 않습니다.
