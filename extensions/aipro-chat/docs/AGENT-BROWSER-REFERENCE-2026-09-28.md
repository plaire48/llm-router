# agent-browser 소스 비교와 첫 관찰 계약 개선

2026-09-28. 요청 해석부터 완료까지 진행 중인 재점검에 사용자가 지정한 Vercel agent-browser를 추가했다. Claude Code/Claude in Chrome과 Codex의 방법론 검토는 유지한다.

## 고정 소스와 선택

공식 저장소 [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)의 커밋 `d01253d9db28d75080e36da3c1c31ef89454731e`를 GitHub API로 확인하고 해당 tarball의 실제 소스를 읽었다. package.json은 0.38.1, LICENSE는 Apache-2.0이다. 내려받은 자료를 실행하거나 의존성을 설치하지 않았다. 파일 해시와 선택은 [sources.json](../verification/agent-browser-reference-2026-09-28/sources.json)에 보존한다.

| 비교 대상 | 실제 소스 확인 | 누비 적용 판단 |
|---|---|---|
| 문서/프레임별 참조 수명 | `cli/src/native/element.rs`의 `RefMap.observe_document`, `snapshot.rs`의 문서 교체/미확인 ID 회귀 | 식별 불가 문서의 연속성을 인정하지 않는 원칙을 자동 본문 수집에 적용. Rust 코드를 옮기지 않고 기존 JS 계약 강화 |
| 실제 요소 참조 | snapshot의 backend node와 frame/session 연결 | 누비는 `browser-observation.js`에서 Chrome documentId/관찰 nonce/실제 node를 이미 연결. 기존 관찰마다 ref를 갱신하는 계약 유지. durable ref 도입은 변경 범위에서 제외 |
| 본문 읽기와 동작 관찰 분리 | `cli/src/read.rs`, README의 URL fetch와 활성 탭 DOM 읽기 구분 | 누비의 `read_page(mode:content)`와 screen ref 분리 유지. 외부 URL fetch나 인증 공유 경로를 추가하지 않음 |
| 가려진 대상 오류 | `element.rs`의 `check_node_interception`, `intercepted_error` | 누비의 Playwright actionability/실패 관찰과 키 입력 우회 금지 지침 유지. 차단 요소 안내의 부족 여부는 다음 행동 단계에서 재현할 항목 |
| 화면 차이 | `cli/src/native/diff.rs`의 텍스트/이미지 비교 | 변화 감지 후보로 기록. 픽셀/텍스트 변화만으로 요구사항 완료나 쓰기 성공을 판정할 수 없어 이번에는 도입하지 않음 |
| 실행 형태 | README와 package.json의 Rust CLI/별도 브라우저 실행 | 누비의 확장 단독 사용 조건에 맞지 않아 CLI/daemon/CDP 런타임 의존성은 추가하지 않음. 기존 Pi와 Chrome 도구 유지 |

이번 변경은 설계 패턴 참고와 누비 자체 구현이다. upstream 코드/프롬프트/자산 복사나 패키지 번들은 없다. Apache-2.0은 실제 코드 재사용 검토에 필요한 출발점이며, 추후 복사 시 고지/수정 표시를 별도 검토한다. 패키지 추가 비용 없이 기존 제공자, 권한, 설치 흐름을 유지한다. 성능 우월성이나 agent-browser 전체 하네스 도입으로 표현하지 않는다.

## 재현한 문제와 수정

### 자동 본문 수집의 문서 연결

기존 `research-source-capture.js`는 top frame의 documentId가 없으면 본문 문서 ID 대조를 생략했다. 같은 URL에서 읽힌 유효 본문을 현재 관찰의 출처로 추가할 수 있었다. top frame이 unavailable이어도 다른 frame이 읽기 가능하면 본문 조회를 시도했다. explicit content 읽기의 중복 방지 키에는 frame이 없었다.

변경 후 자동 수집은 사용 가능한 유일한 top frame과 비어 있지 않은 문자열 documentId를 요구한다. 별도 topDocumentId가 있으면 일치해야 한다. 중복 조회 키는 URL/documentId/frame/page view의 튜플이다. 수집된 본문도 문서 ID/URL/frame/page view가 모두 일치해야 연결한다. 식별 불가 관찰은 자동 연결을 생략하고, 이후 문서가 확인된 새 관찰은 정상 수집할 수 있다.

이 연결은 **참고 본문** 계약이다. 과거 본문을 현재 동작 ref, 승인, 미확정 쓰기 해소나 전체 열람 증거로 승격하지 않는다. 출처 보존을 쓰기 키워드로 차단하지 않으므로 `출처를 붙여 줘` 요청과 긴 요청의 원문 보존도 유지한다. 16회 자동 조회 한도, 취소와 미확정 동작 중 자동 조회 금지도 유지한다.

### A4: 기술 검토 실패와 실제 정보 부족 분리

이미 대상과 제한이 명시된 요청에서도 완료 의도 검토가 잘못된 JSON을 두 번 반환하면 “확인할 대상이나 원하는 결과”를 다시 묻는 현상이 실제 API 어댑터와 합성 제공자 응답으로 재현됐다. 이제 원래 요청/조건이 보존됐음을 알리고 `다시 확인`/`중지` 선택을 제공한다. 유효한 검토 결과가 실제 사용자 선택 부족을 알리는 경우에는 기존 구체적 질문을 유지한다. 취소/통신 오류를 임의로 재시도하거나 미검증 답변을 노출하지 않는다.

## 검사와 증거 경계

- 수정 전 신규/강화 회귀 25개 중 3개 실패: 문서 식별 불가 자동 연결, 프레임 없는 중복 키, 기술 오류의 요구사항 재질문. 같은 URL의 문서 교체 검사는 기존에도 통과한 보호 대조군이다.
- 수정 관련 5개 파일 **47/47 통과**. 기존 전체 검사 실패 10개 중 6개는 식별자 없는 합성 관찰에 자동 조회가 추가되던 경우로 이번 계약 변경 후 통과했다. 나머지 시각 복구 4개는 실제로 유효한 자동 본문 읽기를 누락한 fixture 기대값을 수정했다. content 모드 실패를 명시하면서 미확정 쓰기 후 읽기/쓰기 추가 없음, 원문/이미지/영수증 보존 검사는 유지했다. 10개 제품 결함 해결로 세지 않는다.
- 실제 Chrome에서 두 출처 읽기, 단계 검토와 최종 전달, 본문 수집 중 같은 URL 재로드의 문서 교체를 확인했다. 새 문서의 본문은 이전 관찰에 연결되지 않으며 새 관찰 이후에만 연결된다. 모델/검토 응답은 합성이다.
- Chrome 검사는 현재 Node의 실행기/본문 수집 모듈과 **기존 dist 브라우저 도구**를 연결했다. 각각의 해시를 [browser.json](../verification/agent-browser-reference-2026-09-28/browser/browser.json)에 기록했다. 새 후보 번들/릴리스 통합 통과가 아니다. 최초 headless-shell 시도는 확장 worker 대기 시간 초과였고, 설치된 Chrome for Testing을 명시한 실행이 통과했다.
- 전체 검사 첫 실행은 1,335개 중 1,334개 통과. `openwiki-agent.test.mjs`의 병렬 research 이벤트 첫 도착 구간을 0으로 가정하는 검사 1개가 24,000을 받아 실패했다. 해당 파일 단독은 52/52 통과. **동시 실행 4개로 제한한 전체 재검사는 1,335/1,335 통과**했다. 실행 순서에 민감한 검사는 남아 있으며 Wiki 제품 코드/검사를 이번 변경에 섞지 않았다. 전체 재검사 결과와 모든 로그는 [result.json](../verification/agent-browser-reference-2026-09-28/result.json)에 보존한다.
- Qwen/실계정 모델, 새 후보 빌드, 배포와 전체 사용자 과제의 완주율은 미측정이다.

## 다음 비교

요청/계획의 A1/A2와 이번 문서 연결/A4는 각각 별도 재현을 가진 변경이다. 다음은 실제 후보와 모델을 고정해 첫 유효 관찰까지 호출/시간, stale/중복 이름/가림 오류 후 올바른 다음 행동, 동일 근거의 단계 검토 반복, 최종 답변 전달을 확인한다. 합성 검사 개선을 실제 정확도나 속도 개선으로 대신 보고하지 않는다.

후속 검증: 사용자가 선택한 GPT-5.6 Luna로 새 후보의 공개 과제 5개를 각 1회 실행했다. 답변 전달 5/5, 독립 과제 통과 3/5다. 이전 중단 3개는 답변으로 이어졌으나 E-04 규칙 정확성과 E-07 날짜/기온에서 오답 완료가 남았다. [원자료와 수정 우선순위](../verification/naver-sso-luna-2026-09-27T22-28-12-862Z-evidence/FINDINGS.md)에 기록했다. 위 미측정 항목은 당시 변경 검사 시점의 경계이며 Qwen/배포는 계속 미검증이다.
