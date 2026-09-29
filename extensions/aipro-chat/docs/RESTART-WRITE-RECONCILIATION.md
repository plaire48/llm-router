# 종료 후 미확정 입력 복구

NQ-05. 입력은 페이지에 반영됐지만 worker가 결과를 저장하기 전에 종료되는 상황을 실제 Chromium에서 재현했다. 이전에는 체크포인트의 `unknown` 상태만 남았고 새 실행에서 같은 대상/값을 확인하는 강제 조건이 부족했다. 또한 worker 종료 뒤 이전 디버거 연결이 남아 재연결이 `Another debugger is already attached`로 실패했다.

## 반영

- 실제 입력 전에 대상과 요청 값의 SHA-256 비교 정보를 local 작업 체크포인트에 기록한다. 값/selector/ref 원문이나 실행 코드를 새 복구 필드에 저장하지 않는다. 해시는 암호화나 익명화 보증이 아니다.
- 입력은 같은 페이지/프레임/유일한 제어 식별자와 원래 값 전체, 토글은 같은 제어 상태를 다시 확인해야 한다. 다른 필드/제목 검사와 단순 새로고침으로 차단이 풀리지 않는다. 원래 목표/사용자 입력을 유지하고 후속 쓰기/승인을 호스트에서도 차단한다.
- 미확정 비교 정보는 최근 32개 도구 기록과 별도로 보존한다. 읽기를 여러 번 수행해도 사라지지 않는다. 이미 발행되지 않았음이 확인된 동작과 정상 영수증, 정확히 일치한 검증만 해소한다.
- 디버거 연결을 시작하기 전에 요청/탭 소유권을 trusted session에 기록한다. 새 worker는 해당 확장의 기록된 연결만 해제한 뒤 다시 관찰한다. 다른 요청의 소유권과 사용자 탭을 지우지 않는다.

## 검증과 한계

`restart-write-browser.mjs`: 한 번의 입력 → 영수증 저장 직전 대기 → 실제 service worker 종료 → UI 재진입의 일시중지 확인 → 같은 값/다른 필드 입력 차단 → 엉뚱한 필드의 정상 검증으로 해소되지 않음 → 원래 필드의 같은 값 확인 → 다음 입력. 첫 입력 이벤트는 끝까지 1회다. 강제 종료 오류를 고친 뒤 실제 재연결/검증까지 통과했다.

단위 검사는 JSON 재로딩, 40회 읽기 뒤 유지, 프레임/값 불일치, 애매하거나 부분적인 관찰 거부, 취소/미발행/정상 반환 구분, 디버거의 요청별 해제와 늦은 이전 요청을 검사한다.

대상은 고유하게 관찰된 typed 입력과 토글이다. 임의 스크립트/일반 링크의 서버 부작용 대응, 실제 사이트의 서버/로그인 세션 복원, 실제 서버 저장을 보장하지 않는다. 이 범위는 NQ-04와 별도 현장 검사에 남긴다. 사용자 취소는 자동 재개하지 않는다.

## 방법론과 선택

- [Chrome MV3 수명](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)의 메모리 소실 전제에 따라 동작 전 durable checkpoint와 새 관찰을 적용했다. 실행 자체를 저장해 재전송하는 방식은 사용하지 않는다.
- [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger)와 [Chromium 실제 소스](https://github.com/chromium/chromium/blob/main/chrome/browser/extensions/api/debugger/debugger_api.cc)의 `InitClientHost`/`FindClientHost`가 확장 ID와 대상의 클라이언트를 확인하는 것을 검토했다. 소스 복사 없이 API를 사용한다.
- 기존 Playwright, Chrome storage와 Web Crypto를 재사용한다. 외부 durable-workflow 서버나 Node 호스트를 제품에 추가하지 않는다.

최종 후보/실행 증거는 [품질 목록](BROWSER-QUALITY-BACKLOG.md)에 기록한다.

추가 검사에서는 pending 답변과 미확정 입력을 저장한 상태로 Chrome 프로세스를 종료하고 같은 격리 프로필에서 새 Chrome을 열었다. local 비교 정보 유지, trusted session 인증 제거, 일시중지, 자동 모델 호출 0회를 확인했다. 서버 세션이나 미저장 DOM 값 복원 검사는 아니다. 첫 fixture의 pending 답변 누락을 실제 제품의 저장 구조로 맞춘 뒤 검사했다. 별도 [후속 보고서](../verification/quality-followup-2026-09-24/report.json)를 따른다.
