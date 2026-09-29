# 브라우저 오픈소스 적용과 품질 검증

2026-09-23. 누비 Beta 1.0.0 로컬 후보. 실모델의 성공률 향상이나 공개 배포를 주장하지 않는다.

## 선택

라우터 없이 확장만 설치하는 흐름과 기존 Pi 실행기를 유지한다. 다른 Agent 전체를 겹쳐 넣기보다 실제 브라우저 실패를 재현하고, 검증 가능한 라이브러리와 방법을 연결한다. GitHub 인기나 프로젝트 자체 벤치마크를 누비/Qwen의 품질 점수로 사용하지 않는다.

| 검토 대상 | 참고한 강점 | 이번 적용과 판단 |
| --- | --- | --- |
| [Browser Use 본문 처리](https://github.com/browser-use/browser-use/blob/main/browser_use/dom/markdown_extractor.py) | 행동용 DOM과 읽기용 Markdown 분리, 문서 구간 반환 | 기존 `read_page`에 본문 모드 추가. Python 런타임이나 코드를 복사하지 않고 브라우저용 라이브러리 사용 |
| [Stagehand observe](https://docs.stagehand.dev/v4/basics/observe) | 행동 전에 후보 관찰, 관찰과 실행 구분 | 기존 최신 노드 ref와 Playwright 실행 유지. 추출된 문서에서 클릭 ref를 만들지 않음 |
| [OpenCode processor](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts) | 같은 도구/인자의 반복 감지, 반복 실행을 사용자 판단으로 전환 | 기존 결과 변화 기반 복구를 유지. 같은 문서의 다른 구간 조회가 이전 클릭 실패를 초기화하지 않도록 보완. 새 런타임은 추가하지 않음 |
| [Nanobrowser](https://github.com/nanobrowser/nanobrowser) | 확장 안의 계획/탐색 역할 분리 | 기존 Pi 분석 담당의 분리된 문맥과 단일 페이지 실행기 유지. 두 번째 에이전트 루프를 겹치지 않음 |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | 간결한 화면 관찰과 참조 기반 실행 | 누비의 문서/노드 수명에 묶인 참조 유지. CLI 서버가 필요한 전체 구성은 도입하지 않음 |

agent-browser의 [ref 관련 보고](https://github.com/vercel-labs/agent-browser/issues/1443)와 [후속 보고](https://github.com/vercel-labs/agent-browser/issues/1922)도 검토했다. 이슈는 모든 버전의 결함을 입증하지 않는다. 참조 수명/실제 결과 검증을 생략하지 말아야 할 평가 사례로 사용한다.

## 실제 추가한 라이브러리

| 라이브러리 | 버전 / 라이선스 | 역할 |
| --- | --- | --- |
| [Mozilla Readability](https://github.com/mozilla/readability) | 0.6.0 / Apache-2.0 | 명확한 main 영역이 없는 기사에서 본문 선택 |
| [Turndown](https://github.com/mixmark-io/turndown) | 7.2.4 / MIT | 제목, 목록, 코드, 링크를 Markdown으로 변환 |
| [Turndown GFM](https://github.com/mixmark-io/turndown-plugin-gfm) | 1.0.2 / MIT | 표와 취소선 변환 |
| [LangChain text splitters](https://github.com/langchain-ai/langchainjs) | 기존 1.0.1 / MIT | Markdown 구간 분할. 새 Agent 런타임/원격 임베딩 없음 |
| [MiniSearch](https://github.com/lucaong/minisearch) | 기존 7.2.0 / MIT | 요청과 관련된 문서 구간 검색 |

버전은 package-lock.json에 고정하고 라이선스 원문/종속성 목록은 ZIP의 `script-licenses/documents/`에 포함한다. 원격 코드나 네이티브 실행기를 내려받지 않는다.

## 사용 흐름

1. 화면 관찰로 페이지와 대상 영역을 확인한다.
2. 안내문/정책/긴 자료가 필요하면 `read_page({mode: "content", query})`로 읽는다. 지정한 프레임을 읽을 수도 있다.
3. 본문을 더 읽을 때 같은 query와 content_hash, next_offset을 전달한다. 내용이나 문서가 바뀌면 처음부터 새 근거로 읽는다.
4. 행동은 최신 화면의 ref로 실행한다. 원문의 지시, 링크 문자열, 추출 결과는 실행 권한이 아니다.
5. 실제 입력/클릭 결과를 다시 관찰하고 검증한다. 등록/전송 등 기존 HITL 경계는 유지한다.

모든 원문을 대화에 넣지 않고 최대 5,000자 구간을 돌려준다. Markdown 구분자에 따라 분할하므로 모든 큰 표/코드 블록이 한 구간에 들어간다고 보장하지 않는다. 원본 offset과 해시로 이어 읽는다. 검색 offset은 검색 결과 순번, 일반 읽기 offset은 원문 문자 위치이며 모델은 반환된 next_offset을 사용한다.

본문은 정적 번들의 격리된 함수가 복제 문서에서 추출한다. 숨은 내용, 편집 중인 값, 민감한 이름의 요소, 스크립트와 탐색 메뉴를 제외한다. 링크는 출처/경로만 남기고 query/hash를 제거한다. iframe은 별도 frame 읽기를 사용하며 shadow root/이미지/가상 행은 화면·캡처 도구로 보완한다. 부분 범위를 명시하고 검색 결과가 없다는 이유로 원문에 없다고 단정하지 않는다. 페이지 자체의 보이는 비밀을 모두 자동 분류한다고 보장하지 않는다.

30,000 노드/2,000,000자보다 큰 문서는 집중 화면 조회로 전환한다. 이 제한은 한 문서의 읽기 비용이며 전체 사용자 작업 횟수 제한이 아니다.

## 재현에서 발견한 결함과 수정

- 1,200개 탐색 링크 뒤의 문서는 기존 16,000자 화면 개요에서 핵심 규정을 놓쳤다. 본문 선택/구간 읽기로 해당 규정과 표·코드를 확보했다.
- 실제 초안 입력/클릭이 성공해도 페이지 아래 완료 문구가 개요 뒤에 있으면 `verify_page(text_present)`가 실패했다. 동일한 가시성/민감 값 필터를 적용한 수집 결과에서 출력 절단 전에 대조한다. 두 차례 연속 확인은 유지하고 예상값을 결과에 되돌려주지 않는다.
- Chrome에서 닫힌 details 하위 요소의 레이아웃 상자가 존재하는 사례가 있었다. 상자 존재만으로 펼쳐진 내용이라고 판단하지 않고 첫 summary 외의 하위 내용을 제외한다.
- 같은 문서의 다른 구간을 읽은 사실은 클릭 오류 해결이 아니다. 해시가 같은 구간 읽기는 실패 누적을 지우지 않으며, 쓰기 응답 유실 뒤의 문서 읽기도 결과 확인을 대신하지 못한다.

## 검증 범위

`tests/page-content-browser.mjs`는 실제 Chrome 확장과 로컬 페이지에서 본문/표/코드/링크 변환, 페이지 원본 보존, debugger 없는 읽기, 프레임 선택, 구간 이어 읽기, 변경 해시 거절, 민감/숨은 값 제외, 최신 ref 유지, 초안 입력, 단 한 번의 trusted 클릭, 결과 검증을 검사한다. Readability 기사와 main landmark, 빈 편집 화면도 확인한다.

`tests/agent-runtime.test.mjs`는 실제 Pi 실행에서 문서 읽기가 불확실한 쓰기의 확인 대기를 해제하지 않는지 검사한다. `tests/browser-recovery.test.mjs`는 다른 구간 반환을 행동의 진전으로 오인하지 않는지 검사한다. 브라우저 회귀는 동일 후보와 새 프로필로 3회 반복한다. 결과와 설치 ZIP은 `verification/browser-source-quality/RESULTS.md`에 기록한다.

실제 Qwen 3.8 27B의 도구 선택률/장기 작업 성공률, 회사 서비스의 동적 화면, 인증과 자연어 요구사항 이해는 별도 실계정 평가가 필요하다. 부분 스캔 밖의 텍스트, 서버 저장 완료, 전체 사이트 커버리지는 이번 검사만으로 입증되지 않는다.
