# Naver 실제 사이트 고난도 50개 과제

`evaluation/naver-50.mjs`에 10개 영역 × 5개씩 **50개의 서로 다른 읽기 전용 업무**를 정의했다. 스포츠 경기 결과와 선수·종목 혼동, 지역별 기상 시각, 박물관 입장 마감, 지도 목적지와 접근성, 쇼핑 옵션·멤버십 가격, 업체 지점·리뷰 시점, 잠정/확정 실적, 부동산 매물/실거래, 기술 글의 버전·OS, 영상 검색/추천·자막 범위를 다룬다. 각 과제는 여러 화면을 읽고 원문·URL·시각·단위·미열람 구간을 보존하도록 요구한다. 저장·구매·예약·좋아요·구독은 수행하지 않는다.

방법은 [Anthropic의 task/trial/grader/trace/outcome 구분](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), [OpenAI의 trace와 데이터셋 평가](https://developers.openai.com/api/docs/guides/agent-evals), [Codex의 실제 UI·로그 관찰 하네스](https://openai.com/index/harness-engineering/), [OpenCode의 역할별 도구 권한](https://opencode.ai/docs/agents)을 참고했다. 이 출처들은 설계 근거다. 누비의 성능 점수가 아니다. 이미 사용하는 Playwright와 누비 `read_page`/`capture_page`로 실제 사이트의 시작 화면을 검사한다. BrowserGym 같은 공개 벤치마크는 통제된 비교에 유용하지만, 사용자가 요청한 실제 Naver 화면을 대신하지 않으므로 이번 평가에는 도입하지 않았다.

`NUBI_PUBLIC_SITE_SET=naver node scripts/probe-public-sites.mjs`는 별도 Chrome 프로필에서 Naver 검색의 고유 시작점 10개를 방문한다. 보고서에는 과제 50개 표, HTTP 상태, 누비가 읽은 페이지 범위·해시, 캡처, 차단/미확인 상태를 남긴다. 하나의 시작 화면을 다섯 과제가 공유하더라도 **시작점 접근만 공유**한다. 과제의 다단계 수행·최종 답변·정확도는 각각 별도의 실제 모델 trial과 독립 채점이 없으면 `unscored_no_model`이다. 향후 실모델 평가는 각 과제를 최소 3회 실행하고, 완료된 trial만 pass@1/pass@3/pass^3으로 집계한다. 로그인 전용 기능은 인증 없이 열람한 것으로 세지 않는다.

2026-09-26 실사이트 조사 결과는 `verification/naver-sites-2026-09-25T15-03-23-333Z/report.json`과 같은 폴더의 `TASKS.md`, `naver-nubi-capture.png`에 있다. 10개 시작 검색은 모두 HTTP 200이며 누비 `read_page`로 접근했다. 10개 모두 접근 가능한 frame의 발견/검사 수가 일치했지만, 이 중 5개에서 제어 요소의 일부가 절단되어 `partialFrames`에 남았다. 따라서 화면 일부를 못 읽었을 수 있으며, 접근 성공을 과제 성공이나 전체 페이지 열람으로 평가하지 않는다. 실제 모델 인증이 없는 이번 실행의 50개 완료 점수는 **미측정**이다.

## 2026-09-26 GPT-5.6 Luna 실측과 원인 분리

격리된 Chrome for Testing에서 누비 확장 자체의 ChatGPT SSO로 로그인해 `gpt-5.6-luna`를 선택했다. 요청별 `POST /backend-api/codex/responses` HTTP 200과 누비의 모델 ID를 대조했다. 첫 네 과제만 여러 차례 진단했고 50개 정확도는 여전히 **미측정**이다. `awaiting_user`는 과제의 빈칸 때문에 질문한 상태이며 성공으로 계산하지 않는다. `timeout`은 평가 하네스가 시험을 중단한 상태이지 사이트 결과의 실패/성공 판정이 아니다.

| 단계와 기록 | 확인된 현상 | 판정 |
|---|---|---|
| 원본 v1, `verification/naver-sso-luna-2026-09-25T16-53-14-032Z.json` | 01-01과 01-03에서 각각 42·31회 모델 요청 뒤 `goal_review_failed`; 01-02는 선수/대회가 빠져 질문; 01-04는 중단 | 인증·네트워크 장애가 주원인이라는 가설 배제 |
| 실패 이유 계측, `verification/naver-sso-luna-2026-09-25T17-06-21-541Z.json` | 01-01의 35회 요청이 모두 HTTP 200, 종료 이유 `evidence_invalid` | 검토 모델이 없거나 현재 사용할 수 없는 근거 ID를 완료 근거로 인용 |
| 근거 강등 후보, `verification/naver-sso-luna-2026-09-25T17-13-45-021Z.json` | 01-01·02는 질문 대기, 01-03은 81회 요청 후 시간 만료; 잘못된 근거를 완료로 인정하지 않은 채 재조사 | 인용 오류로 즉시 실패하던 문제만 개선. 완료율 향상은 아직 입증되지 않음 |

코드·방법론 비교에서 [OpenCode의 세션 처리기](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts)는 전송 재시도와 도구 결과 처리를 구분했고, [Codex의 계획 도구 처리기](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/plan.rs)는 구조화된 계획 인자를 검증한다. [Anthropic의 컨텍스트 설계](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)는 관련성이 높은 도구 결과를 유지하고 필요할 때 원문을 다시 읽도록 권한다. [Anthropic의 에이전트 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)는 과제의 결함, trace, 실제 결과를 분리한다. [OpenAI의 Codex 하네스](https://openai.com/index/harness-engineering/)는 실제 UI·로그 관찰로 실패를 재현하고 검증한다. 이는 설계 참고이며 각 제품과 동등 성능의 증거가 아니다. Claude Code의 내부 실행 코드는 공개 비교 대상이 아니므로 [Claude Agent SDK의 공개 계약](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py)과 Anthropic 공식 문서까지만 참고했다.

반영한 개선은 세 가지다. 첫째, 검토 입력에 **현재 인용 가능한 근거 ID 목록**을 별도로 넣고, 재시도에도 잘못 인용하면 해당 항목을 `unknown`으로 낮춰 다시 조사하게 한다. 완료로 승격하지 않는다. 둘째, 읽기 전용 조사의 계획에서 추상적인 기사 비교를 `verify_page`로 검증하라는 잘못된 지시를 제거했다. 원문 열람·URL·열람 범위를 근거로 사용하고, 실제 입력·저장 등의 변경만 `verify_page`로 확인한다. 셋째, 원본 과제 v1은 그대로 두고 `evaluation/naver-50-v2.mjs`에 처음 세 과제의 누락된 대상 선택 규칙과 결과가 없을 때의 답변 조건을 명시했다. v1과 v2 점수는 같은 표본으로 합산하지 않는다.

새 프레임워크는 도입하지 않았다. 이미 번들된 Pi 하네스와 검증 파서가 이 문제의 실행 경계에 있고, Python OpenAI Agents SDK 또는 별도 OpenCode 런타임을 MV3 확장에 더하면 설치·인증·크기 비용만 늘어난다. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)와 [Claude 구조화 출력](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)은 스키마 형식 오류를 줄이는 후보지만, 누비 ChatGPT SSO 경로에서 해당 파라미터 지원이 검증되지 않았고 근거 ID의 사실성은 스키마만으로 보장되지 않는다. 현재는 인용 허용 목록과 검증·수정 경로를 우선 적용했다.

수정판은 `npm test` 869/869, `npm run design:check` 0건, `npm run build:candidate` 성공을 확인했다. 이는 코드 계약 검사이며 실모델 과제 완료 증거가 아니다. 재시험 기록은 별도로 추가한다.

v2 과제 01-03 한 건을 같은 Luna SSO 경로로 재시험한 `verification/naver-sso-luna-2026-09-25T17-27-46-896Z.json`에서는 50회 모델 요청과 50회 HTTP 200 후 6분 평가 제한에 도달했다. `verify_page` 오류가 네 번 남았고 완료 검토는 실행 중이었다. 따라서 근거 인용 강등, 인용 가능 ID 명시, 과제 선택 규칙만으로는 반복 탐색이 해결되지 않았다. 읽기 전용 비교에도 페이지 상태 검사를 요구하던 공통 프롬프트를 추가로 분리했다. 이 후속 변경의 실모델 완료 효과는 아직 검증 전이다.

웹페이지 읽기 자체도 분리 측정했다. `node scripts/benchmark-page-reading.mjs`의 공개 Naver 검색 결과 HTTP 200, 같은 페이지의 3회 반복 중앙값은 전체 화면 DOM 276ms/63,501B, 질의 중심 화면 DOM 281ms/32,797B, 본문 추출+질의 40ms/6,034B였다(`verification/naver-page-reading-2026-09-26.json`). 본문 방식은 링크 조작·프레임·접힌 콘텐츠를 보지 않으므로 전체 화면 방식과 품질이 동등하다는 뜻이 아니다. 읽기 전용 조사에서는 본문 근거를 먼저 읽고, 조작 대상·누락 구간이 필요할 때 화면 스냅샷을 추가하도록 지시했다. 이 수치는 페이지 내 추출과 반환량만 측정하며 모델 추론, 확장 메시징, 다단계 과제 완료 시간을 포함하지 않는다.

DOM 조상 컨텍스트와 가시성 계산을 한 번의 관찰 안에서만 캐시했다. 같은 네이버 페이지의 변경 전후 교차 측정 8회 중앙값은 전체 스냅샷 333→59ms, 질의 중심 327→52ms였다. 최적화 후 별도 실행한 `verification/naver-page-reading-optimized-2026-09-26.json`은 HTTP 200에서 각각 69ms/65ms, 본문 질의 29ms였다. 고정 페이지의 상위 문서·iframe 출력 4조건이 변경 전후 일치하고, 숨김·민감값·프레임·새 ref 검사도 통과했다. 이는 추출 시간 개선이며 전체 업무 시간의 개선은 아니다.

실제로 최적화판을 사용한 v2 01-01 재시험(`verification/naver-sso-luna-2026-09-25T17-49-20-680Z.json`)은 모델 요청 52회가 모두 HTTP 200이었지만 약 362초에 시간 만료됐다. `read_page` 2회, `browser_snapshot` 3회, `verify_page` 4회(오류 2회), 중간 `review_task` 4회가 있었고 `delegate_analysis`는 0회였다. 완료 검토는 실행 중이었다. 따라서 DOM 속도 개선과 읽기 전용 프롬프트 수정만으로 과제 완료 병목을 해결했다고 말할 수 없다. 요청 완료 이벤트가 수집되지 않아 이 시험의 모델 전체 응답 시간은 `completed: 0`으로 **미측정**이며, HTTP 200을 추론 시간이나 정답률로 바꾸지 않는다.

이 결과를 보고 후속 후보에는 사이트 데이터 쓰기와 단순 출처 탐색을 구분했다. 탭 전환·URL 이동·실제로 이동한 링크 클릭은 반환된 새 화면 근거로 확인하고, 입력·토글·저장 등의 변경에는 기존 `verify_page`를 유지한다. 서로 다른 실제 출처 두 개를 읽은 명시적 읽기 전용 비교에서만 짧은 분석 워커 둘을 한 번 자동 배정하는 경로도 추가했다. 후속 후보의 실제 모델 활성화·완료율은 재시험 전까지 미확인이다. 새 계측기는 첫 HTTP 응답 시간과 실행 중 단계 타임라인을 별도로 수집하며, 스트림 전체 소요 시간이 포착되지 않으면 미측정으로 남긴다.

후속 후보의 `npm test` 878/878, 디자인 검사, 후보 ZIP 빌드, 관련 Chrome 7개 선별 회귀가 통과했다(`verification/pre-release-2026-09-25T18-10-34-677Z/report.json`). 일반 링크와 iframe 링크의 실제 이동·새 화면 관찰도 별도로 확인했다. 같은 Luna SSO로 재시험하려고 평가용 Chrome을 열었으나 `verification/naver-sso-luna-2026-09-25T18-14-08-255Z.json`은 로그인 완료 없이 종료됐다. 모델 호출·과제 trial이 **0건**이므로 이 후보의 실모델 위임 빈도, 전체 시간, 정답률은 여전히 미측정이다. 앞선 52회 모델 호출 실패와 합성 워커 통과를 하나의 성공률로 합산하지 않는다.
