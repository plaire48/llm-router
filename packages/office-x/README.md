# Office X — Excel 2016 VSTO Agent

**GenOffice의 Agent Core와 AI Provider 원본을 기반으로**, Windows Excel 2016의 열린 문서를 읽고 수정하는 VSTO 추가 기능이다.

현재는 첫 Excel 기능의 소스 구현과 macOS에서 수행 가능한 검증까지 완료했다. **Windows VSTO 로드, Excel 2016 COM, NASCA 보호 문서, 실제 모델 연결은 아직 검증하지 않았다.** 설치 EXE는 만들지 않았다.

## 구현된 흐름

1. Excel에서 수량·단가·빈 금액 열을 포함한 표를 선택한다.
2. Office X 리본에서 작업창을 열고 선택 범위를 확인한다.
3. 누비 채팅창에서 AI Pro·ChatGPT·Claude에 로그인하거나 FabriX를 연결하고 모델을 선택한다.
4. “수량과 단가를 곱해서 금액 열을 채워줘”라고 요청한다.
5. GenOffice AgentLoop가 문서를 읽고 수정안을 만든다.
6. 작업창에서 셀별 수식을 검토하고 변경 적용을 누른다.
7. VSTO가 원본을 다시 검사하고 적용한 수식·계산값을 확인한다.

모델 연결 없이도 수식 도구 확인으로 C1:E4 예제를 실행할 수 있다. 저장은 Excel의 기존 저장 명령으로 한다.

로그인 단계 표시, 계정 모델 검색·전환, 추론 수준 선택, Markdown 채팅, 중지·복사·응답 시간, 최신 메시지 이동과 작업창 내 대화 이력을 제공한다. 대화는 창을 닫으면 지워진다.

## 현재 범위

- read_selection, read_range, set_formula, calculate_and_read.
- 단일 선택 범위, 최대 101행 × 20열, 문서 맥락 128 KiB, 최대 100개 수식.
- 수식은 선택 범위 안의 숫자 셀 두 개를 곱하는 `=C2*D2` 형태이며 대상은 빈 셀이다.
- 요청마다 문서·시트를 고정하고 변경안의 원본 스냅샷을 재검사한다.
- 거절·취소·부분 실패·계산 미완료를 완료와 구분하며 같은 변경안을 재적용하지 않는다.
- 병합 셀, 표(ListObject), 배열 수식, 숨긴 행·열, 외부 참조는 첫 수정 범위에서 제외한다.
- 값·서식·구조 편집, 자동 저장·복구, Word/PPT, 누비 A2A 활성화는 후속 범위다.

## 구조

```text
Excel 2016 → VSTO 작업창 → stdio → GenOffice AgentLoop + AgentTransport
                   ↑                        ↓ 문서 도구 요청
                   └── C# ExcelSession ←────┘
                            ↓
                     Excel COM Adapter
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

Visual Studio 2022의 Office 개발 도구, .NET Framework 4.7.2 targeting pack, VSTO Runtime, WebView2 Evergreen Runtime, Excel 2016, Node.js가 필요하다. 프로젝트 폴더에서 `Build-Windows.cmd`를 실행하고 [Windows 개발 실행 안내](docs/windows-development.md)를 따른다.

## 관련 문서

- [GenOffice·누비 재사용 내역](docs/reuse-audit.md)
- [구현 및 검증 결과](docs/implementation-status.md)
- [아키텍처](docs/architecture.md)
- [Excel 실제 검증 시나리오](docs/excel-poc.md)
- [누비 A2A 후속 연결](docs/a2a-integration.md)
- [라이선스와 출처](THIRD-PARTY-NOTICES.md)
