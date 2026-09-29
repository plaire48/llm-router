# 하위 분석 반환값 격리 검증

2026-09-25. NQ-15. 대상은 브라우저 누비의 기존 Pi 하위 분석 조정기다. 모델/검색 엔진을 교체하지 않고 보고서와 근거를 반환하는 경계를 보강했다.

## 재현과 수정

같은 JavaScript 실행 환경의 소비자가 반환값을 가공하면 원본이 함께 바뀌는 경로 5개를 재현했다. 모델에는 직렬화한 JSON을 전달하므로, 이 검사가 웹페이지나 모델의 직접 메모리 변조를 입증하는 것은 아니다.

| 재현 | 이전 영향 | 반영 |
| --- | --- | --- |
| 수집한 보고서의 상태/결론/인용/불확실성 수정 | 형제 사본과 이후 재조회 보고서 변경 | 공개 결과 전체의 독립 사본 반환 |
| 출처와 읽은 범위 수정 | 보관한 출처와 재조회 범위 변경 | 결과의 중첩 출처/범위까지 복제 |
| 원문 조회 이미지/출처/범위 수정 | 이후 원문 조회 내용 변경 | 원문 패킷과 이미지 독립 사본 |
| 전체 문서 도구 반환 범위 수정 | 하위 분석 캐시에 보관한 범위 변경 | 전체 문서 패킷 독립 사본 |
| 근거 관찰 콜백이 인자/문서 결과 수정 | 검증한 입력과 실제 읽기 범위가 불일치 | 콜백에 인자와 결과의 별도 사본 전달 |

기존 `assignment` 사본 패턴을 보고서/출처/범위/이미지까지 확장했다. 내부 job, cache, controller는 반환하지 않는다. 복제 대상은 기존 길이/개수 제한을 적용한 공개 결과이며 전체 실행 상태를 복제하지 않는다. 취소, 만료, 부분 결과 판정, 읽기 권한과 재시도 규칙은 그대로 사용한다. 콜백 예외 정책을 바꾼 작업은 아니다.

## BP와 오픈소스 선택

| 근거/후보 | 판단 | 실제 적용 |
| --- | --- | --- |
| [DeepAgents 하위 에이전트 문맥 격리](https://docs.langchain.com/oss/javascript/deepagents/subagents) | 독립 문맥과 명시적 결과 인계를 기존 조정기의 반환 경계에도 적용 | 패턴 적용. 새 DeepAgents 런타임/버전 도입 없음 |
| [Pi 0.87.1 Agent 소스](https://github.com/earendil-works/pi/blob/v0.87.1/packages/agent/src/agent.ts) | 모델 호출/도구 루프는 기존 검증한 Pi에 유지. 누비 소유의 결과 저장 경계를 수정 | 기존 OSS 유지. Pi 소스 복사/포크 없음 |
| [Worker structuredClone](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/structuredClone) | 지원되는 Chrome worker에서 중첩 사본 생성 가능. 이미 assignment에도 사용 | 표준 API 채택, 추가 패키지 없음 |
| [rfdc](https://github.com/davidmarkclements/rfdc) | 실제 소스와 MIT 라이선스 검토. 현재 데이터에 네이티브 복제가 충분하고 별도 복제 옵션 불필요 | 참고만 함. 의존성/번들 추가 없음 |
| 기존 TypeBox 1.3.27 | 설치 소스의 `system/environment/evaluate.mjs`는 CSP 지원 여부를 캐시하고 불가하면 interpreter를 선택 | 제품 설정/버전/CSP 변경 없음 |

`npm audit`의 알려진 취약점은 0건이었다. `outdated.json`에 새 버전 후보를 보존했다. 이번 결함은 누비의 참조 공유였으므로 관련 없는 라이브러리 일괄 업그레이드는 채택하지 않았다. 메모리/복제 속도 벤치마크나 실모델 정확도 향상을 측정한 것은 아니다.

## 검증 도구 오류도 분리

처음 문서 Chrome probe를 `worker.evaluate` 안에서 시작했을 때 TypeBox의 동적 코드 지원 감지가 성공한 뒤 비동기 호출에서 CSP 오류가 발생했다. [CDP Runtime 프로토콜](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json)은 디버거 평가의 CSP 우회 옵션을 별도로 정의한다. 설치된 TypeBox의 지원 감지 캐시 소스와 오류 로그를 함께 확인했다.

probe를 확장 서비스 워커 스크립트에서 직접 시작하고 디버거는 결과 Promise만 읽도록 변경하자 문서 스키마 검증과 읽기가 통과했다. 생산 코드에 `unsafe-eval`을 추가하거나 TypeBox의 검증을 끄지 않았다. 이 실패는 디버거 평가로 인한 검사 환경 문제로 분리하며, 제품의 문서 입력 검증 실패로 기록하지 않는다.

## 검증 근거

- [초기 3개 실패](../verification/analysis-snapshots-2026-09-25/before.log), [문서 2개 실패](../verification/analysis-snapshots-2026-09-25/document-before.log)
- [집중 검사](../verification/analysis-snapshots-2026-09-25/focused.log): 신규 5개 포함 42개 통과
- [실제 Chrome worker 검사](../verification/analysis-snapshots-2026-09-25/browser-final.json): 보고서/이미지/범위 사본, 문서 콜백/반환 사본, 6개 하위 분석, 두 번 압축 후 재조회, 근거 만료 후 부분 결과 유지. 합성 모델 호출 12+2회, 실제 Qwen 아님
- [CSP 진단](../verification/analysis-snapshots-2026-09-25/browser-schema-diagnostic.log), [서비스 워커 시작 검사](../verification/analysis-snapshots-2026-09-25/browser-worker-context.log)
- [취약점 검사](../verification/analysis-snapshots-2026-09-25/audit.json), [버전 후보](../verification/analysis-snapshots-2026-09-25/outdated.json)

## 동일 후보 최종 결과

[최종 요약](../verification/analysis-snapshots-2026-09-25/report.json), [74단계 원본 보고서](../verification/pre-release-2026-09-25T02-11-12-231Z/report.json): **단위 782/782, Chrome 71/71**, 디자인/후보 빌드 통과. `quality-baseline-v4`, 21종 × 3회 + 8종. 신규 5개 회귀를 포함하며 제품 소스/검사/의존성/빌드 해시가 검사 전후 일치한다.

[자동 품질 상태](../verification/analysis-snapshots-2026-09-25/status-after.json)는 이번 단일 보고서를 선택하고 구현 12개를 현재 핵심 회귀 통과로 표시했다. 외부 조건 4개와 비채택 5개는 완료로 승격하지 않는다. [선택 및 소스 해시](../verification/analysis-snapshots-2026-09-25/selection.json)도 보존했다.

- 빌드 SHA-256: `6677be8aaf9edc4d872ee1f6f5baa8fffd65de26404b5184e6808a77229c81ca`
- 후보 아카이브 SHA-256: `13783a33cd39b1452cc67448f6ed4e825a61d3d318014b31d3b357b51d28e1b8`

실제 Chrome의 합성 사이트/모델 검사다. 전체 배포 매트릭스나 실제 모델 의미 정확도의 검증이 아니다. 실계정/Qwen 품질, 실제 사이트 저장, Windows/Edge 설치, 공식 WebArena는 기존 외부 조건 대기 상태다. 공개 배포/설치는 수행하지 않았다.
