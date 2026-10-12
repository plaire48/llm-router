# Windows 개발 실행 안내

대상: Windows의 Excel 2016 데스크톱. Office 비트수는 아직 미확정이며 네이티브 소스는 AnyCPU로 구성했다. Office 32비트·64비트별 로드 확인은 필요하다.

## 준비와 빌드

Visual Studio 2022의 Office/SharePoint 개발 도구(VSTO), .NET Framework 4.7.2 targeting pack, VSTO Runtime, WebView2 Evergreen Runtime, Excel 2016, Node.js 22.19 이상이 필요하다. 공통 로직 테스트에는 .NET 8 SDK를 사용한다.

프로젝트를 Windows 로컬 작업 폴더에 복사한다. 기존 macOS의 node_modules·bin·obj는 복사하지 않는다. 프로젝트 루트의 `Build-Windows.cmd`를 실행한다. npm 복원과 GenOffice worker 번들, C# 호스트, VSTO 진입점을 순서대로 빌드한다. 현재 스크립트는 개발 빌드이며 설치 프로그램·신뢰된 게시자 서명·인증서 설치를 만들지 않는다.

PIA 자동 탐지가 실패하면 설치된 Office interop 경로를 지정한다.

```powershell
.\scripts\Build-Windows.ps1 -OfficeCorePath 'C:\실제경로\office.dll' -ExcelInteropPath 'C:\실제경로\Microsoft.Office.Interop.Excel.dll'
```

예상 출력은 `native/OfficeX.ExcelAddIn/bin/Release/`의 추가 기능 DLL·VSTO manifest·호스트 DLL과 `OfficeX/worker/main.cjs`, `OfficeX/ui/`와 WebView2 `runtimes/`이다. 실제 Windows 빌드 성공은 아직 확인하지 않았다.

개발 실행은 Program Files의 `nodejs/node.exe` 또는 빌드 결과의 `OfficeX/runtime/node.exe`를 사용한다. npm이 실행되는 Node와 이 실행 경로가 같은 버전인지 확인한다.

## Visual Studio에서 실행

`native/OfficeX.ExcelAddIn/OfficeX.ExcelAddIn.vbproj`를 연다. 구성은 Release로 맞춘다. 설치된 Excel 경로를 프로젝트 디버그의 외부 프로그램으로 지정하고 F5로 실행한다. Visual Studio VSTO 개발 등록·신뢰 처리가 필요한 환경이다. 조직 정책으로 로드가 거부되면 해당 환경의 서명·배포 절차로 검증한다. 테스트 인증서를 신뢰 저장소에 설치하거나 정책을 우회하지 않는다.

프로젝트 참조를 찾지 못하면 OfficeCorePath와 ExcelInteropPath에 해당하는 Office 참조 경로를 확인한다. 리본이 보이지 않으면 Excel의 COM 추가 기능 목록과 로드 오류를 먼저 확인한다. 이 절차는 아직 실제 Windows에서 실행 검증하지 않았다.

## 모델 없이 문서 실행기 확인

새 통합문서에서 다음 표를 C1:E4에 만든다.

| 행 | C열 | D열 | E열 |
| --- | --- | --- | --- |
| 1 | 수량 | 단가 | 금액 |
| 2 | 2 | 1500 | 빈 셀 |
| 3 | 3 | 2000 | 빈 셀 |
| 4 | 0 | 500 | 빈 셀 |

C1:E4 선택 → Office X 리본 → Office X 열기 → 모델 없이 문서 도구 확인 → 변경안 확인 → 변경 적용.

E2:E4의 수식이 `=C2*D2`, `=C3*D3`, `=C4*D4`, 값이 3000, 6000, 0인지 확인한다. 적용 대기 중 C2나 E2를 수정한 경우에는 충돌로 멈춰야 한다. 다른 문서로 전환해도 원래 대상만 사용해야 한다. 다음 테스트에는 새 빈 대상이나 새 문서를 사용한다.

## GenOffice Agent 연결

로그인 화면에서 AI Pro·ChatGPT·Claude를 누르면 기본 브라우저의 인증 흐름을 시작한다. FabriX는 연결 정보를 입력한다. 작업창에 표시되는 로그인 단계가 완료되고 모델 목록이 로드되면 원하는 모델을 선택한다. 연결 정보는 Office X 전용 Windows DPAPI 저장소에 보관한다. Excel을 종료·재시작한 뒤 연결 복원과 로그아웃 후 삭제도 확인한다. 실제 로그인은 아직 검증하지 않았다.

선택 범위를 확인하고 “수량과 단가를 곱해서 금액 열을 채워줘”라고 보낸다. 누비의 인증·전송 어댑터가 모델에 연결하고 GenOffice AgentLoop가 도구 호출과 검토를 수행한다. 최종 답변과 별도의 문서 검증 결과를 확인한다. 새 대화·대화 이력·중지·모델 변경도 확인한다. 실행 중 모델 변경은 비활성화돼야 한다.

모델에 전달되는 것은 선택한 범위의 값·수식·메타데이터다. 먼저 합성 표로 확인하고 보호 문서는 조직의 허용된 모델과 전달 범위에서 시험한다. 회사 인증서는 Windows 신뢰 저장소를 이용하고 TLS 검증을 끄지 않는다. Node 자식 프로세스는 `--use-system-ca`로 실행한다.

채팅창 로드에 실패하면 WebView2 Runtime 설치 상태와 `OfficeX/ui/index.html`, 호스트 옆 `runtimes/win-x86`·`win-x64`를 확인한다. Worker 연결이 끊기면 “Agent 다시 연결”은 연결만 다시 만들며 이전 문서 변경을 자동 재실행하지 않는다.

## 실환경 완료 조건

일반 통합문서와 NASCA 보호 문서에서 읽기·적용·재조회·사용자 저장·종료·재개방을 각각 확인한다. 보호 문서는 Office로 열고 저장한다. 저장 완료와 재개방 검증은 현재 도구 밖의 수동 확인 항목이다. 선택한 범위 밖의 전체 문서 서식·차트·연결 상태를 자동 검증한 것으로 간주하지 않는다.

## Claude 준비

공식 [Claude Code Windows 설치 안내](https://code.claude.com/docs/en/setup#install-on-native-windows)에 따라 **Windows용** CLI를 설치한다. 현재 어댑터는 WSL의 CLI를 실행하지 않는다. `claude --version`으로 설치를 확인하고 Office 작업창에서 Claude를 연결한다. CLI가 필요한 안전 모드·구조화 출력 옵션을 지원하지 않으면 업데이트 안내가 표시된다. CLI 계정 인증과 도구 비활성화 옵션은 [공식 CLI 참조](https://code.claude.com/docs/en/cli-reference)를 따른다. Office X에 API 키를 추가할 필요는 없으며 실제 계정·CLI 호환성 검증은 아직 남아 있다.
