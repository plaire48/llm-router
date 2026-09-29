# 누비 파일 전송, 알림, 녹화와 예약, 조직 정책

Claude 비교의 C05~C08 구현. 설치형 라우터나 Native Messaging 없이 확장 내부에서 동작한다. 실제 모델 정확도와 사내 사이트 완료는 미측정이다.

| 개선 | 반영 내용 | 완료를 과장하지 않는 경계 |
| --- | --- | --- |
| C05 업로드 | 현재 대화의 사용자 첨부 ID/소유자/SHA-256 재검사, 보이는 native file input 탐색, 기존 문서 fingerprint/HITL, 승인 소비 후 Playwright setInputFiles 1회, 파일 목록 readback | 최대 4개/합계 8MiB, 기존 첨부 형식. hidden picker/폴더 입력 미지원. `input_selected`는 서버 저장 아님. 실제 화면 확인을 추가로 요구 |
| C05 다운로드 | 관찰한 링크와 기존 HITL, 선택 downloads 권한, Chrome 다운로드 ID/complete/interrupted/unknown, 대화별 영수증, 변경 이벤트/상태 조회 | Chrome `exists`는 캐시될 수 있음. API complete는 파일 내용 무결성 아님. 불명확한 호출 자동 재전송 없음. 기존 이미지 카드의 저장 동작까지 전체 다운로드를 감시하지 않음 |
| C06 알림 | 선택 권한, 결과/질문/오류 알림, 실행 ID 중복 방지, 알림 클릭 시 해당 대화로 복귀, 본문/파일명 미포함 | Chrome API 접수와 OS 배너/집중 모드의 실제 표시는 별도. 다른 대화 실행 중이면 끝날 때까지 전환 보류 |
| C07 녹화 | 최상위 동일 origin의 trusted click/change, 값/비밀번호/인증 필드 제외, 20분/100단계, 사용자가 목표와 절차 검토 후 저장, 기존 Pi에 참고 자료로 전달 | 영상/GIF/rrweb 전체 DOM 녹화 아님. iframe/다른 origin/숨겨진 제어는 자동 녹화하지 않음. 재실행 시 새 관찰/필요한 입력 질문/기존 승인 유지 |
| C07 예약 | 한 번/24시간/7일 반복, 현재 대화/계정 수신시각/모델/스킬 바인딩, Chrome alarms, 원래 URL의 query/hash 보존, 새 탭/새 실행, 실행 의도를 먼저 저장 | Chrome 전체를 다시 열었거나 5분 이상 지연되면 놓친 예약을 실행하지 않음. 같은 Chrome 세션의 워커 휴면/재시작은 session 표식으로 구분해 아직 시작하지 않은 최근 예약만 복구. 다른 대화/계정/모델/스킬, 작업 중, 질문 대기는 확인 상태. 취소/불명확한 실행/승인 대기 자동 재개 금지. 기존 대화 기록은 참고하되 이전 탭/미전송 첨부를 재사용하지 않음 |
| C08 조직 정책 | managed schema, 자동화/전송 도구/녹화/예약 on/off, 정확한 origin allow/block 교집합, block 우선, 잘못된 정책은 차단, 실행 중 변경 시 중단 | 누비 도구의 접근 제한이다. 브라우저 전체 방화벽/모든 사이트 스크립트의 통신/DLP가 아니다. 일반 Chrome 사용자 조작이나 서버 redirect 네트워크 자체를 막는 중앙 브라우저 정책은 별도 |

`설정 → 작업 녹화·예약`에서 녹화를 시작하고 완료한 기록을 확인·저장한다. 녹화 중에는 누비 화면에서 상태와 종료 버튼을 볼 수 있다. 같은 곳에서 권한, 예약, 적용 정책도 관리한다. 예약 중지/삭제는 가능하며 실행 중인 작업은 채팅의 중지를 사용한다. 놓친 예약은 결과를 확인한 뒤 새 시각으로 등록한다. 예약은 사용자 초안이나 첨부를 자동 전송하지 않는다.

## 방법론과 오픈소스 판단

- **실제 재사용**: 기존 Apache-2.0 Playwright CRX의 `setInputFiles`, 기존 Pi 실행기, 첨부 IndexedDB와 SHA-256, 문서 fingerprint/승인, CX UI. 별도 자동화 런타임/파일 경로/Node 설치를 추가하지 않는다. [Playwright 공식 API](https://playwright.dev/docs/api/class-elementhandle#element-handle-set-input-files)
- **신규 도입**: MIT `buffer` 6.0.3. 기존 Playwright의 실제 source가 `payload.buffer.toString('base64')`를 요구하므로 Uint8Array를 직접 넘기는 대신 브라우저 Buffer로 변환한다. 원본 bytes를 다시 인코딩하거나 파일 내용을 추론하지 않는다. 라이선스/전이 의존성을 후보에 포함한다. [실제 upstream source](https://github.com/feross/buffer)
- **공식 API/방법론 적용**: Chrome [downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads), [notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications), [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [managed storage](https://developer.chrome.com/docs/extensions/reference/manifest/storage). alarm을 local 상태와 대조해 worker 시작 시 복구하며, 실행 의도를 먼저 저장하고 미확정 실행을 재전송하지 않는다. Chrome 150+ 전용 persistence 옵션을 사용하지 않아 minimum Chrome 125 계약을 유지한다.
- **미도입**: MIT [rrweb](https://github.com/rrweb-io/rrweb). 시각 재생에는 유용하지만 현재 필요한 것은 사용자 검토 후 에이전트가 다시 판단하는 절차다. 전체 DOM/session 원문 보관을 늘리지 않고 기존 의미 기반 관찰/승인 경로를 재사용했다.
- **비교만**: Claude CRX 1.0.94의 downloads/notifications/alarms/managed 호출. 재사용 라이선스를 확인하지 못해 코드를 복사하지 않았다. 원본 해시/식별자는 비교 문서의 기존 근거를 유지한다.

## 검증

- `tests/browser-routines.test.mjs`: 정책 해석/차단, 시간과 소유자 바인딩, 미확정 실행과 재시작, 반복/승인 대기, 알림 중복/실패, 녹화 sender/nonce와 값 제외, 다운로드 소유자/영수증.
- `tests/browser-routines-browser.mjs`: 실제 Chrome 승인 전 업로드 0회/승인 후 원본 UTF-8 bytes 일치/재실행 차단, 다운로드 complete+독립 파일 readback, 실제 trusted 입력 녹화, 정책 차단, 360/1280px 화면, 실제 워커 강제 종료→같은 Chrome 세션의 지난 시각 알람 복구→기존 Pi→합성 모델 응답→알림 API 접수.
- 정책 공급자는 Chrome fixture에서 합성한다. 실제 조직 관리자 배포는 미검증. 알림의 OS 화면 표시, 실제 계정/모델/사내 서버의 업로드 완료는 미검증. 실제 Chrome fixture의 별도 복사본에서만 선택 권한을 미리 허용한다. 사용자 권한 대화상자 조작은 미검증이다. 기본 설치에서 API가 없는 상태는 Chrome으로 확인했고, 허용/철회/재허용 이벤트 연결과 중복 방지는 호스트 단위 검사로 검증한다. 이벤트를 놓친 다운로드는 저장한 ID로 다시 조회한다.
- 신규 suite는 고정 품질 기준선 v4 및 identity 검사에 포함한다. 단위 756개, 고정 Chrome 회귀 71회, 별도 화면/통합 22종을 통과했다. 최종 후보 해시와 실패/수정 이력은 [비교 보고서](../verification/claude-comparison-2026-09-25/report.json)에 기록했다.
