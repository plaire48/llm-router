# 누비 Office X — Office 2016 VSTO Beta

**GenOffice의 Agent Core와 AI Provider 원본을 기반으로**, Windows Excel, Word, PowerPoint 2016의 열린 문서를 읽고 수정하는 VSTO 추가 기능이다.

설치는 [Beta 릴리스](https://github.com/plaire48/llm-router/releases/tag/office-x-v0.4.0-beta.1)의 `Nubi-Office-X-0.4.0-Setup.exe`를 사용한다. 세 앱을 닫고 실행하면 공통 런타임과 선택한 추가 기능을 설치한다. Node는 포함하며 WebView2가 없으면 인터넷으로 설치한다.

Windows CI 빌드와 설치 검사의 증거는 릴리스 첨부 JSON에 기록한다. **실제 Office 2016 로드, 실제 모델 계정, NASCA 보호 문서는 별도 검증이 필요하다.** Beta EXE는 배포용 코드 서명이 없다.

## 구현된 흐름

1. Excel에서 수량, 단가, 빈 금액 열을 포함한 표를 선택한다.
2. Office X 리본에서 작업창을 열고 선택 범위를 확인한다.
3. 누비 채팅창에서 AI Pro, ChatGPT, Claude에 로그인하거나 FabriX를 연결하고 모델을 선택한다.
4. “수량과 단가를 곱해서 금액 열을 채워줘”라고 요청한다.
5. GenOffice AgentLoop가 문서를 읽고 수정안을 만든다.
6. 작업창에서 셀별 수식을 검토하고 변경 적용을 누른다.
7. VSTO가 원본을 다시 검사하고 적용한 수식·계산값을 확인한다.

모델 연결 없이도 수식 도구 확인으로 C1:E4 예제를 실행할 수 있다. 저장은 Excel의 기존 저장 명령으로 한다.

로그인 단계 표시, 계정 모델 검색·전환, 추론 수준 선택, Markdown 채팅, 중지·복사·응답 시간, 최신 메시지 이동과 작업창 내 대화 이력을 제공한다. 대화는 창을 닫으면 지워진다.

## 현재 범위

- read_selection, read_sheet_context, read_surrounding, read_range, set_formula, calculate_and_read.
- 단일 셀 선택도 주변 표 읽기가 가능하다. 같은 시트의 다른 범위를 나눠 읽을 수 있으며, 원래 선택 범위는 수정 대상에만 적용한다.
- 단일 선택 범위, 최대 101행 × 20열, 문서 맥락 128 KiB, 최대 100개 수식.
- 수식은 읽어 확인한 숫자 셀 두 개를 곱하는 `=C2*D2` 형태이며 대상은 빈 셀이다.
- 요청마다 문서·시트를 고정하고 변경안의 원본 스냅샷을 재검사한다.
- 거절·취소·부분 실패·계산 미완료를 완료와 구분하며 같은 변경안을 재적용하지 않는다.
- 병합 셀, 표(ListObject), 배열 수식, 숨긴 행·열, 외부 참조는 첫 수정 범위에서 제외한다.
- Word: 여러 문단 읽기, 교정과 번역 및 문서 개요 읽기. PowerPoint: 여러 텍스트 상자의 문단 수정과 발표 개요 읽기. 한 번에 30문단, 8,000자까지 문단 경계를 유지하며 적용한다.
- 문장 편집은 변경 전후 승인, 원문과 서식 재확인, 주변 텍스트 및 결과 검증을 거친다. 복잡한 서식은 읽기만 지원한다.
- 값과 서식의 일반 편집, 문서 생성, 자동 저장과 복구, 누비 A2A 활성화는 후속 범위다.

## 구조

```text
Office 2016 → VSTO 작업창 → stdio → GenOffice AgentLoop + AgentTransport
                   ↑                        ↓ 문서 도구 요청
                   └── C# ExcelSession / TextSession ←────┘
                            ↓
                     Excel / Word / PowerPoint COM Adapter
```

Agent의 루프·도구 인자 검사·문맥 압축·스트리밍은 GenOffice 코드를 사용한다. 누비 Workspace의 공통 인증·모델 목록·채팅 컴포넌트를 재사용하며, GenOffice 실행부와 문서 Skill 구조를 유지한다. Windows 연결 정보는 Office X 전용 DPAPI 저장소에 보관한다. 다른 앱의 로그인 정보는 읽지 않는다. 자세한 재사용·확장 경계는 [누비 통합과 GenOffice 구조](docs/nubi-integration.md)에 기록했다.

## 개발 검증

Node.js 22.19 이상:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:upstream
npm run test:process
npm run test:auth
npm run test:nubi-process
npm run test:claude
npm run verify:vendor
```

`test:process`는 localhost 모의 모델과 자식 프로세스를 사용한다. 실제 모델·Office 동작 증거가 아니다.

.NET 8 SDK:

```sh
dotnet run --project native/OfficeX.Core.Tests/OfficeX.Core.Tests.csproj -c Release
dotnet build native/OfficeX.ExcelHost/OfficeX.ExcelHost.csproj -c Release
```

## Windows에서 시작

일반 사용자는 설치 EXE만 실행한다. [첫 실행 안내](docs/first-use.md)를 따른다.

소스 빌드는 Visual Studio 2022 Office 개발 도구, .NET Framework 4.7.2 targeting pack, .NET 8 SDK, Node 22.19 이상, NuGet CLI, Inno Setup 6이 필요하다. `Build-Windows.cmd`가 세 VSTO 추가 기능과 설치 EXE를 만든다. [Windows 개발 실행 안내](docs/windows-development.md)에 재현 절차가 있다.

## 관련 문서

- [GenOffice·누비 재사용 내역](docs/reuse-audit.md)
- [구현 및 검증 결과](docs/implementation-status.md)
- [아키텍처](docs/architecture.md)
- [Excel 실제 검증 시나리오](docs/excel-poc.md)
- [누비 A2A 후속 연결](docs/a2a-integration.md)
- [라이선스와 출처](THIRD-PARTY-NOTICES.md)
