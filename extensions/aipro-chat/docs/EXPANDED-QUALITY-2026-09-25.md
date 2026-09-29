# 브라우저 누비 복구 경로 확대 검증

2026-09-25. 기존 23개 작업 목록을 재대조하고 직전 핵심 회귀 71회에 포함되지 않은 12종을 추가 검증한다. 이번 작업은 기존 제품의 검증 범위를 넓힌 것이며 제품 코드를 변경하지 않았다. 핵심 보고서와 이번 선택 보고서를 하나의 통과 수로 합산하지 않는다.

## 확인 순서와 연결 항목

| 검사 | 연결 항목 | 실제 확인 대상 |
| --- | --- | --- |
| form-reconciliation-browser | NQ-05 | 20개 필드의 응답 유실 재대조, 바뀐 입력 노드/체크박스 거부, 중복 쓰기 방지 |
| uncertain-frame-browser | NQ-05 | content-script/Playwright 전환의 iframe 대상 유지, 다른 프레임의 일치값을 원래 쓰기 성공으로 오인하지 않음 |
| workflow-knowledge-browser | NQ-03 | 위키 기반 절차 초안, 수정/가져오기/새 입력과 재진입 보존. 스킬 조회를 실행 근거로 세지 않음 |
| subagent-progress-browser | NQ-11 | 대기/진행/부분/실패/취소 표시, 좁은 화면과 키보드 펼침, 재진입 유지 |
| model-stall-browser | NQ-10 | keepalive만 오는 스트림 복구, 이미지 근거 유지, 클릭/캡처 중복 0, 사용자 취소 후 재실행 금지 |
| page-content-browser | NQ-03 | 긴 본문 구조 보존, 문서 변경 후 이어읽기 거부, 숨김/입력 값을 본문 결과로 오인하지 않음 |
| review-context-browser | NQ-12 | 큰 과거 관찰 뒤 원래 요구사항 보존, 5개 입력 각 1회, 새 화면에서 재실행 금지 |
| outcome-recovery-browser | NQ-10 | 오래된 ref와 검증 실패를 다음 모델에 전달, 실제 입력 중복 방지, 복구 영수증 보존 |
| output-recovery-browser | NQ-10 | 출력 복구 후 본문 append/readback, 같은 길이 편집 충돌, 민감 입력 거부 |
| page-analysis-browser | NQ-03 | DOM에 나뉜 글자, 비활성 필드, 늦게 나타나는 읽기 결과 확인 |
| analysis-recovery-browser | NQ-11 | 실패한 배치 후 쓰기 금지, 수동 읽기로 복구, 최종 검토에서 빠진 요구만 보완 |
| script-recovery-browser | NQ-10 | 구문/locator/입력 불가 오류 구분, 기존 허용 입력만 수행, 진전 없는 반복에서 질문 |

각 종목은 새 Chrome 프로필로 3회 실행한다. 전체 단위, 디자인, 후보 빌드도 같은 입력으로 수행한다. 실패하면 그 실행을 중단하고 원인을 분리한다. 지나갈 때까지 반복한 결과로 실패 기록을 덮지 않는다.

## BP와 오픈소스 적용 판단

- [Anthropic 평가 환경 노이즈](https://www.anthropic.com/engineering/infrastructure-noise): 환경과 자원을 통제하고 모델 품질과 실행 환경 실패를 구분하는 방법론을 적용했다. Chrome 바이너리, 프로필 격리, 동시 실행 수 3, 반복 수 3과 소스/빌드 해시를 기록한다.
- [Playwright 격리](https://playwright.dev/docs/browser-contexts), [Best Practices](https://playwright.dev/docs/best-practices): 기존 Playwright의 실제 Chrome 실행과 개별 프로필을 재사용한다. 실제 제품 도구가 합성 페이지를 읽고 입력한 결과와 새로고침 후 상태를 검사한다.
- 기존 Pi 0.87.1, p-limit, MiniSearch/Readability/Turndown과 Qwen 합성 모델 계약을 유지한다. 후보 버전의 존재만으로 패키지를 교체하지 않는다. 이번 검사에서 재현된 결함이 있어야 해당 원인과 적용 비용을 비교해 변경한다.

이는 합성 응답으로 실행 경로를 검사하는 회귀다. 실제 Qwen의 추론 품질, 실계정 SSO, 사내 서버 저장, Windows/Edge 설치나 공식 WebArena 점수의 근거가 아니다. WebArena/HAR와 전체 배포 매트릭스를 이번 선택 검사에 포함하지 않는다.

## 근거와 현재 상태

- [검사 범위](../verification/expanded-quality-2026-09-25/scope.json)
- [진행 중 자동 상태](../verification/expanded-quality-2026-09-25/status-during.json): 새 검증 실행이 끝나기 전 과거 통과로 현재 후보를 인증하지 않는지 확인
- [의존성 취약점 검사](../verification/expanded-quality-2026-09-25/audit.json)

## 최종 결과

[최종 요약](../verification/expanded-quality-2026-09-25/report.json), [확대 검증 원본](../verification/pre-release-2026-09-25T03-07-39-488Z/report.json): **단위 787/787, 확대 Chrome 36/36(12종 × 3회)**, 디자인/후보 빌드 통과. 이번 선택 보고서는 39단계다. 자동 재시도로 통과시킨 종목 없이 계획한 세 번을 모두 통과했다.

직전 [핵심 71회 보고서](../verification/pre-release-2026-09-25T02-25-07-810Z/report.json)와 소스/검사/의존성/빌드 해시가 동일하다. 기존 핵심 결과를 이번 36회에 합산하거나 이번에 71회를 다시 실행했다고 표시하지 않는다. [최종 자동 상태](../verification/expanded-quality-2026-09-25/status-after.json)는 기존 핵심 보고서를 계속 선택하며 새 선택 보고서를 전체 핵심 보고서로 바꾸지 않는다.

검사한 범위에서 새 결함은 재현되지 않았다. 제품 코드/패키지 변경 없이 검사 범위와 문서를 보강했다. 알려진 의존성 취약점은 0건이다. 빌드 SHA-256은 `6677be8aaf9edc4d872ee1f6f5baa8fffd65de26404b5184e6808a77229c81ca`다.

외부 조건 대기 4개, 비채택 후보 5개의 기존 판단은 유지한다. 전체 배포 매트릭스/실계정 모델/실서비스 저장을 검사한 결과는 아니다. 공개 배포/설치는 수행하지 않았다.
