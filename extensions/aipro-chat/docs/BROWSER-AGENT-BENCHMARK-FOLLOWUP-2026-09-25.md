# 브라우저 에이전트 공개 소스 후속 비교

후속 상태: 아래 캡처 전체 기한과 미확정 쓰기 문서 식별은 [Claude Chrome 재점검](CLAUDE-BROWSER-RECHECK-2026-09-25.md)에서 구현·검증한다. 이 문서의 "반영 전" 표는 당시 조사 시점의 후보 기록이다.

2026-09-25. 기존 `CLAUDE-BROWSER-COMPARISON-2026-09-25.md`와 `MULTIAGENT-PROGRESS-2026-09-25.md`를 먼저 대조했다. 아래는 공식 저장소의 현재 HEAD를 고정해 읽은 소스 비교다. 소스 비교 자체를 구현 성공이나 Claude/Qwen 성능 개선의 증거로 사용하지 않는다. Claude Chrome 배포 코드의 재사용 허가는 여전히 확인되지 않았으며 여기서 검토한 Anthropic 공개 quickstarts는 별개의 MIT 예제다.

## 고정 소스와 적용 판단

| 대상 / 고정 커밋 | 실제 코드에서 확인 | 라이선스 / MV3 | 선택과 비선택 |
| --- | --- | --- | --- |
| browser-use `d8110c5ff87ccba887aaa726cdb780f2f84bef8d` (2026-09-15) | [DOM watchdog](https://github.com/browser-use/browser-use/blob/d8110c5ff87ccba887aaa726cdb780f2f84bef8d/browser_use/browser/watchdogs/dom_watchdog.py#L267): 네트워크 조회에 별도 2초 기한. DOM과 캡처를 병렬로 시작하고 캡처의 남은 예산이 소진되면 DOM만 반환. [캡처 watchdog](https://github.com/browser-use/browser-use/blob/d8110c5ff87ccba887aaa726cdb780f2f84bef8d/browser_use/browser/watchdogs/screenshot_watchdog.py#L55): 강조 표시 제거 후 촬영, 취소가 cleanup에 삼켜지지 않도록 처리 | [MIT](https://github.com/browser-use/browser-use/blob/d8110c5ff87ccba887aaa726cdb780f2f84bef8d/LICENSE). Python/CDP 실행기는 MV3에 직접 포함 불가 | **패턴 채택 권고**: 단계별 제한 시간, 사용 가능한 DOM과 실패한 이미지 분리. 임의 다른 page target으로 대체하는 upstream fallback과 URL 전문 진단은 채택하지 않음. 누비의 바인딩/개인정보 경계를 유지 |
| Stagehand `514970e13f2ffe7528407dd2e57e41a77b61e785` (2026-09-24) | [waitForDomNetworkQuiet](https://github.com/browserbase/stagehand/blob/514970e13f2ffe7528407dd2e57e41a77b61e785/packages/extension/handlers/handlerUtils/actHandlerUtils.ts#L441): DOMContentLoaded와 남은 전체 예산, 지속 스트림 제외, 500ms 조용한 구간, 종료 시 모든 listener/timer 정리. [manifest](https://github.com/browserbase/stagehand/blob/514970e13f2ffe7528407dd2e57e41a77b61e785/packages/extension/manifest.json): 실제 MV3 runtime 존재 | [MIT](https://github.com/browserbase/stagehand/blob/514970e13f2ffe7528407dd2e57e41a77b61e785/LICENSE). MV3 코드는 참고 가능하지만 누비에 새 debugger/브라우저 실행기 전체를 도입할 이유는 없음 | **패턴 채택 권고**: 전체 관찰 예산과 명확한 종료/정리. 2초 지난 모든 요청을 inflight에서 제거하는 구현은 업무 완료 증거로 사용하지 않음. 서버 캐시와 자동 행동 재실행은 미채택 |
| Anthropic quickstarts `dee71163217524eed07d79d00ffea5a7d02cedda` (2026-09-24) | [best-practices loop](https://github.com/anthropics/claude-quickstarts/blob/dee71163217524eed07d79d00ffea5a7d02cedda/computer-use-best-practices/computer_use/loop.py#L231): 오래된 이미지 제거 전략과 메시지 용량 제한. [computer tool](https://github.com/anthropics/claude-quickstarts/blob/dee71163217524eed07d79d00ffea5a7d02cedda/computer-use-best-practices/computer_use/tools/computer.py#L255): 마지막 전달 이미지 크기 기준 좌표 변환 | [MIT](https://github.com/anthropics/claude-quickstarts/blob/dee71163217524eed07d79d00ffea5a7d02cedda/LICENSE). Python/pyautogui OS 조작은 확장 범위 밖 | 이미지 문맥 예산은 기존 누비 context manager 개선 여부를 확인하는 **비교 기준**. CSS 픽셀/viewport 캡처/30초 만료와 전체문서 클릭 금지 경계는 이미 있음. 제공자 전용 cache header나 macOS 입력 실행기는 미채택 |

현재 패키지 도입: **없음**. 기존 Playwright CRX, Pi, MiniSearch, DeepAgents, idb로 해결할 수 있는지 먼저 검증한다. 코드를 직접 복사하게 된다면 해당 고정 커밋의 저작권/전문 라이선스를 함께 보존해야 한다. 지금은 원문 코드 편입 없이 설계 패턴을 검토했다.

## 캡처 실행기에서 추가 재현이 필요한 후보

| 우선순위 | 현재 소스 확인 | 개선 후보 | 반영 전 필요한 재현과 완료 기준 |
| --- | --- | --- | --- |
| P0 | `browser-capture.js`는 screenshot 호출 7초와 크기/전후 geometry 검사를 갖는다. 앞뒤 `page.evaluate(layout)`와 마스크/후속 DOM 관찰까지 포함하는 단일 전체 기한은 이 함수에 없다 | 관찰과 캡처의 전체 예산을 명시하고 하위 단계에 남은 시간을 배분. 취소 후 늦은 응답을 이미지/클릭 상태에 반영하지 않음 | 영구보류 이미지, 평가 호출 보류, 캡처 중 navigation/취소를 주입해 정해진 시간에 종료하고 클릭 가능 screenshot ID가 생성되지 않는지 검사 |
| P1 | `capture_page`는 촬영 성공 뒤 DOM을 관찰한다. 촬영 예외가 나면 이 분기의 독립 DOM 결과도 반환되지 않는다 | 이미지 실패와 DOM 성공을 별도 공개 상태로 반환하는 복구 경로. 사용할 수 없는 이미지는 명확히 표시하고 시각 클릭은 막음 | screenshot만 실패하고 DOM은 정상인 조건에서 원인+최신 읽기 근거 제공, 원래 write 1회 유지. 마스크 실패 시 비마스킹 이미지 fallback 금지 |
| P1 | `settle()`은 DOMContentLoaded 5초 뒤 고정 250ms 대기. 화면/좌표 승인에는 별도 재검증이 있으며 이미 조건부 wait도 존재 | 무조건 network idle을 추가하기보다 관련 DOM 준비 조건과 전체 대기 예산을 유지. 변경이 필요하다면 지속 연결/부분 로딩 상태를 기록하고 재관찰하는 방법으로 제한 | 스트림/광고/지연 이미지가 관찰을 막지 않고, 필요한 늦은 대상은 fresh ref로 다시 관찰. 시간 초과나 quiet를 업무 완료로 판정하지 않음 |
| 재검토 | 누비는 이미 원래 목표 보존, 이미지 제외 요약, 제한된 최근 문맥, 이미지 지원 모델 확인을 수행 | Anthropic 이미지 제거 정책과 비교해 장시간 스크린샷 반복 시 payload 예산/근거 소유권을 추가 계측. 기존 코드와 중복되는 새 이미지 저장소는 추가하지 않음 | 이전/현재 이미지 구분, 원래 첨부와 최종 검토 필수 이미지 보존, 실제 provider usage 별도 측정. 근거 없이 비용 절감 수치를 쓰지 않음 |

위 첫 두 항목은 읽은 코드상 계약 차이다. 실제 실패 재현과 root의 반영 결과가 나오기 전에는 결함 수정 완료로 표기하지 않는다. 화면 캡처의 일부 실패를 허용한다는 것은 인증/정책/마스킹 실패를 허용한다는 뜻이 아니다. 승인/쓰기/저장 완료는 기존 호스트 검증을 유지한다.

## 증거 경계

공식 [Claude computer use 문서](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool), 공식 저장소 소스와 라이선스를 직접 확인했다. Stagehand는 현재 MV3 확장을 포함하므로 과거의 “Node 실행기라 확장에 불가능”이라는 일괄 평가는 쓰지 않는다. browser-use의 관찰 지연 회피와 Stagehand의 quiet는 상태 수집 정책이며, 업무 서버의 저장 완료 판정이 아니다. 실제 누비/Claude 동일 업무 비교, 회사망 Qwen 정확도, 토큰 비용은 이 연구에서 측정하지 않았다.

## 이번 반영 목록

[Anthropic orchestrator-workers와 evaluator-optimizer](https://www.anthropic.com/engineering/building-effective-agents)의 역할 분리와 평가 후 인계, [멀티에이전트 연구](https://www.anthropic.com/engineering/multi-agent-research-system)의 근거 있는 결과 합성을 적용 기준으로 사용한다. 위 Python/Stagehand 실행기를 복사하지 않고 기존 Pi, DeepAgents, LangChain, MiniSearch를 개선한다.

| 순서 | 재현한 공백 | 반영 내용 | 완료 기준 |
| --- | --- | --- | --- |
| 1 | 하위 검토가 이미지 두 장을 요청해도 wire에는 마지막 한 장만 포함 | 실시간 최신 화면과 고정 분석 이미지 배치를 분리. 실제 전달된 근거만 이미지 열람으로 인정 | 실제 PNG 두 장의 송신 payload, 취소/실패/텍스트 경계 확인 |
| 2 | 미해결 목록이 있어도 워커와 통합 결과가 complete | 공백/중복을 정리한 미해결 목록이 있으면 partial 유지 | leaf/통합/수동 하위 분석의 동일 완료 기준 |
| 3 | 압축 뒤 미열람 범위·실패 상태가 사라짐 | 인용과 별도로 제한된 research_work 상태를 보존 | 근거 없는 blocked, partial, 생략 개수, 후속 재조회 확인 |
| 4 | 진행 화면에서 일부 확인의 이유와 다음 행동이 누락 | 기존 상세 펼침에 미확인 사항과 다음 행동 표시. raw 전송 오류 제외 | 320/360/1100px, 키보드, 새로고침, 토큰 마스킹 확인 |

위 네 변경은 beta34 배포 이후의 후속 소스에 반영했다. UI는 미해결 항목을 최대 3개, 원래 Wiki 계약인 항목당 600자까지 접힌 상세에 보존한다. 짧게 자른 뒤 중복을 제거하면 서로 다른 예외의 마지막 조건이 사라지는 회귀도 수정했다. 문맥 압축의 참고 메모는 별도로 최대 3개×200자이며 절단/생략 수를 표시한다. 이 문서의 캡처 실행기 후보는 별도 재현 대상이며 반영 완료로 세지 않는다.

## 고정 후보 검증

[검증 요약과 소스 해시](../verification/harness-followup-2026-09-25/report.json). 서로 다른 두 폴더에서 입력 해시와 빌드 SHA-256이 같은 후보를 확인했다.

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 단위·디자인·후보 빌드 | 853개 통과, 디자인/빌드 성공 | [핵심 게이트](../verification/pre-release-2026-09-25T07-01-23-127Z/report.json) |
| 핵심 Chrome 회귀 | 22종×3회 + 11종 = 77회 통과 | 위 동일 후보의 80단계가 모두 정상 종료 |
| 화면과 접근성 | 26종 통과 | [화면 게이트](../verification/pre-release-2026-09-25T07-02-03-261Z/report.json), [360px 캡처](../verification/harness-followup-2026-09-25/subagents-workers-360.png) |
| 실제 PNG 두 장의 하위 검토 요청 | 원본 바이트·서로 다른 근거 ID·전달 후 읽음 상태 통과 | [Chrome 이미지 전송 검사](../verification/harness-followup-2026-09-25/vision-routing-browser.json) |
| 대형 문서 분업과 전체 기록 | 161쪽 PDF/13만 자 TXT, 워커 34개, 동시 2개, 통합 13회, 최종 검토 1회, 저널 373건/8페이지·누락 0 | [대형 문서 결과](../verification/harness-followup-2026-09-25/large-document-browser.json) |
| 공통 OpenWiki | TypeScript와 CLI 빌드 성공 | [빌드 로그](../verification/harness-followup-2026-09-25/openwiki-build.log) |

교차 리뷰 중 중지한 검사와, 모든 실행 단계는 통과했지만 공유 파일 변경을 감지한 검사는 최종 통과 수에서 제외했다. 이후 별도 폴더의 고정 후보로 다시 검증했다. **원본 작업 폴더에서는 다른 작업의 `src/QuestionForm.jsx`, `tests/question-forms-browser.mjs` 수정이 계속됐다.** 이번 하네스 구현 파일은 검증 후보와 바이트 단위로 같지만, 원본 전체의 현재 상태는 [별도 판정](../verification/harness-followup-2026-09-25/workspace-quality-status.json)에서 재검증 대상으로 남는다. 다른 작업의 파일을 덮어쓰지 않았으며 새 릴리즈를 배포하지 않았다.

검사는 실제 Chrome과 고정 모델 응답을 사용했다. 모델 요청에 이미지가 실렸다는 확인은 시각적 이해 정확도나 회사망 Qwen의 업무 성공률이 아니다. 실제 Qwen/Claude 동등 과제 성능과 토큰 비용 개선률은 미측정이다.
