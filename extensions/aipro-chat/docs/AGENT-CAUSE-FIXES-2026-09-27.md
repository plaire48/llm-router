> 최신 실측과 후속 수정은 [실검증 실패 기반 개선](LIVE-FAILURE-FIXES-2026-09-27.md)을 따른다. 아래 수치는 당시 기록이며 최신 전체 완료율이 아니다.

# 실제 실패 원인과 수정 후보

후속 변경: [남은 다섯 항목 개선](REMAINING-FIVE-FIXES-2026-09-27.md). 아래 여섯 건과 후보 해시는 이전 수정 시점의 기록이다. 최신 구현/검증 진행은 후속 문서를 따른다.

기준선은 동일 후보 30개 중 6개 통과, **20%**다. 목표는 24/30 이상이다. 아래 변경과 로컬 회귀 성공은 새로운 실모델 점수가 아니다. 이전 결과는 `verification/browser-30/final-records/manifest.json`에 해시와 함께 고정했다. 수정 후보의 30개 전체 독립 재채점은 아직 하지 않았다.

## 원인별 처리

| 우선순위 | 실제 증거 | 원인 | 반영 | 검증과 한계 |
| --- | --- | --- | --- | --- |
| 1 | H-09 승인 뒤 `approval_snapshot_changed`, 파일 0개 | 승인 대상을 `JSON.stringify`로 해시했다. Chrome 저장소 왕복으로 중첩 객체 키 순서가 바뀌어 같은 승인도 다르다고 판단했다. 메모리만 쓰던 기존 시험은 이를 놓쳤다. | `fast-json-stable-stringify` 2.1.0으로 키 순서만 정규화한다. 파일 순서/해시, 실제 문서 ID, URL, 값은 모두 비교한다. | 실제 Chrome 저장소 왕복과 새 실행 재개에서 수정 전 실패를 재현했다. 수정 후 원본 바이트 전송 1회, 승인 전 전송 0회, 소비한 승인 재사용 거부를 확인했다. 실모델 H-09 재채점은 별도다. |
| 2 | H-07 첫 검토가 문서 범위 외에 전체 마감일, 하위 담당과 최종 출처를 요구했다. E-02는 단계 검토에서 답변 문구 보완을 요구했다. | 현재 단계와 최종 답변 검토가 같은 지침과 `proposed_answer`를 사용했다. | 별도 단계 지침과 명시적인 `evaluation_contract.outcomes`를 쓴다. 단계 요청에는 최종 답변을 넣지 않는다. 최종 검토는 원래 요구사항 전체를 계속 검사한다. | 범위 누락 거부, 사용자 제약 보존, 단계/최종 검토 분리와 제공자별 형식 복구 검사. 실제 모델의 범위 준수 향상은 아직 미측정이다. |
| 3 | E-05의 영상 URL이 `/watch`까지만 보였다. `url_is`도 동일하게 쿼리를 버렸다. | 표시용 URL 정제 함수를 자원 일치 판정에 재사용했다. 서로 다른 영상도 일치할 수 있었다. | 호스트에서 원래 URL 전체로 일치를 판단한다. 출력은 비공개 쿼리를 제거하고 허용한 YouTube/Naver/KBS 자원 ID만 남긴다. | 실제 Chrome의 debugger 없는 읽기에서도 page=1/2를 구분한다. 출력에는 비공개 쿼리가 없고 잘못된 자원은 일치하지 않는다. 순서나 추가 쿼리가 다른 URL은 보수적으로 불일치다. |
| 4 | H-04/H-07 실제 분석 호출과 전달 기록이 있지만 검토기는 담당 배정을 미확인으로 판단했다. | 하위 결과 전달은 주 모델 대화에만 남고 독립 검토 근거에서 빠졌다. | 호스트가 실행 ID, 역할, 호출/읽기 수, 상태, 보고 범위와 전달 여부를 1회 기록한다. 화면 변경으로 실행 기록을 지우지 않는다. | 전달과 재수집 구분, 페이지 입력 뒤 기록 유지, 실제 검토 요청 전달을 검사한다. 이 기록은 배정/실행 증거이며 조사 결론, 전체 열람, 입력 성공이나 승인의 증거가 아니다. |
| 5 | M-04 답변이 디지털 자료실에 다른 행의 운영시간을 적용했다. | 병합 표를 행별 문자열로 펼쳐 열 위치와 rowspan 관계를 잃었다. | 기존 Readability/Turndown 경로에서 정제된 표의 병합 셀을 해당 행/열에 반복 배치한다. | 실제 Chrome에서 디지털 09–21과 세계 09–18의 연결을 확인했다. rowspan=0은 행 그룹 안에서만 확장한다. 겹친 표, 과도한 열, 중첩 표는 평탄화하지 않고 별도 관찰을 요구한다. |
| 6 | M-08의 `신청 설정`에서 승인 흐름으로 빠졌다. | 설정 화면 열기와 최종 신청을 같은 키워드로 분류했다. | 비제출 설정 이동을 준비 동작으로 구분한다. 실제 form submit, 복합 실행 문구와 설정 저장은 승인 대상으로 유지한다. | 분류 회귀와 기존 승인 거부 검사를 유지했다. 실제 M-08 전체 재채점은 별도다. |

## 소스 비교와 도입 판단

| 참고 대상 | 실제 확인한 범위 | 선택과 비선택 |
| --- | --- | --- |
| Claude 브라우저 1.0.94 | 내려받은 `sidepanel-so8SIo6y.js`의 `we`/`Ce` 루프, `mcpPermissions-tSjXinpi.js`의 결과 처리 경로를 다시 읽었다. 도구 ID에 연결한 실패 반환과 승인 대기를 확인했다. [정적 분석과 파일 해시](CLAUDE-HARNESS-STATIC-2026-09-26.md) | 실패를 다음 판단으로 전달하고 승인 뒤 같은 작업을 이어가는 패턴을 기준으로 누비의 저장소 경계를 재현했다. 원본 번들과 프롬프트는 복사하지 않았다. 공개 배포 파일 열람은 OSS 재사용 허가나 Claude 실성능 검증이 아니다. |
| [OpenCode processor](https://github.com/anomalyco/opencode/blob/b471c2b4495747353af768fbf2e0790c9d820ce2/packages/opencode/src/session/processor.ts) | 고정 커밋의 도구 ID별 진행/완료/오류, 실패 시 메타데이터 보존, 반복 호출 감지. MIT. | 도구 상태와 실패 경계를 구분하는 패턴을 참고했다. 브라우저 번들에 Effect/별도 OpenCode 런타임을 추가하지 않고 기존 Pi 실행기와 호스트 기록을 보완했다. 반복 횟수만으로 작업을 성공 처리하지 않는다. |
| [Codex plan handler](https://github.com/openai/codex/blob/814de47b69dd63a2660fd14f9af66690888d183e/codex-rs/core/src/tools/handlers/plan.rs) | 계획 인자를 파싱해 `PlanUpdate` 이벤트로 전달하는 도구 구현. Apache-2.0. | 계획 표시와 실제 결과 검증을 구분한다. 계획 업데이트 성공을 작업 정답으로 인정하지 않는다. 해당 파일이 전체 Codex 하네스라는 주장은 하지 않는다. |
| [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) | 공식 문서의 독립 문맥, 제한된 도구와 위임 범위 | 주 실행과 읽기 전용 분석의 경계를 유지한다. 이번에 Claude Code 비공개 핵심 소스를 확보했다고 주장하지 않는다. |
| [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [결과 중심 평가](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 기존 검토와 공식 방법론 | 단계에 필요한 문맥과 최종 결과를 구분하고 실제 완료 상태와 원본 근거로 평가한다. 종료 문구/계획 숫자/단위 검사 개수를 성공률로 대체하지 않는다. |
| [fast-json-stable-stringify](https://github.com/epoberezkin/fast-json-stable-stringify) 2.1.0 | 실제 소스의 재귀 키 정렬, 배열 순서 유지, MIT와 설치된 패키지/lock integrity | **실제 신규 도입.** 의존성 없는 작은 직렬화 모듈이며 네트워크 호출과 별도 런타임이 없다. 자체 해시 정규화 코드를 새로 만드는 대신 승인 비교에만 사용한다. 최근 릴리즈 빈도를 품질 근거로 삼지 않고 필요한 동작을 회귀로 검증한다. |

OpenCode/Codex 소스와 라이선스는 `verification/browser-30/benchmark-sources/manifest.json`에 커밋/파일 SHA-256을 기록했다. 새 OSS의 전체 라이선스는 후보 ZIP `script-licenses/fast-json-stable-stringify-LICENSE`에 포함한다. 등록/삭제/쓰기 상태를 비교하는 승인 해시에 일반 진전 비교용 `evidenceKey`를 쓰지 않았다. 해당 함수는 일부 ID를 생략하기 때문에 승인 용도로 부적합하다.

## 검증 자료

최종 단위 검사 **1,044/1,044**, 디자인 검사와 후보 빌드가 통과했다. 실제 Chrome **7개 회귀 묶음**이 통과했으며 모델 응답은 합성이다. 단계 검토 후 최종 검토, 한 번의 파일 전송, 재전송 차단과 새로고침 후 상태 보존을 포함한다. 마지막 패키징 전후 실행 JavaScript 101개 파일의 해시가 동일함을 확인했다. 후보 SHA-256은 `f2d31bf5996f484aead7d2c0cb432a18b7e7be779523e51d232cd5a77dc3ef74`다. [기계 판독 요약](../verification/browser-30/cause-fixes-summary.json)에 기준선과 새 후보의 미측정을 구분했다.

- 전체 단위 검사: `verification/browser-30/cause-fixes-unit-final.log`
- 디자인 정적 검사: `verification/browser-30/cause-fixes-design.log`
- 후보 빌드: `verification/browser-30/cause-fixes-build-final.log`
- 저장소 왕복 수정 전 실패: `verification/browser-30/cause-fixes-upload-storage-before.log`
- 수정 후 전송/녹화/예약 회귀: `verification/browser-30/cause-fixes-transfers-final.log`
- 실제 Chrome 회귀: `verification/browser-30/cause-fixes-browser-report.json`, 후속 `cause-fixes-browser-followup.json`
- 이전 실모델 승인 오류 원문 코드: `verification/browser-30/pre-reload-eval-events.json`

이번 Chrome 회귀는 실제 브라우저와 로컬 사이트를 사용하지만 모델 응답은 합성이다. 기존 단위 시험의 모호한 검토 횟수도 단계 검토와 최종 검토로 구분했다. 실패를 통과로 덮지 않고 최초 실패와 수정 후 로그를 별도로 남긴다.

## 아직 해결됐다고 할 수 없는 항목

1. M-09 같은 동일 URL의 페이지 넘김 집계: 현재 문서와 과거 페이지의 읽기 근거를 구분해 보존해야 한다. 과거 DOM을 다시 클릭 가능한 근거로 살려서는 안 된다. 기존 `research-source-capture`는 URL/문서 단위이며 같은 문서 내부 페이지 변경을 충분히 다루지 못한다. 후속 설계와 회귀가 필요하다.
2. 최종 답변 누락과 실모델 완주: 단계 지침 수정만으로 해결됐다고 판단하지 않는다. H-07 분할 결과, E-05 출처, M-04 운영시간, H-09 업로드를 먼저 재실행하고 동일 후보 30개 전체를 독립 채점해야 한다.
3. 사이트 차단/외부 오류, 다운로드 권한, 작업 후 소유 탭 정리: 별도 환경 및 수명 검증 대상이다. 권한 거부를 우회하거나 사용자 탭을 임의로 닫지 않는다.

현재 **실모델 품질은 기준선 20%, 새 후보는 미측정**이다. 소스 수정 6건을 80% 달성으로 표현하지 않는다. 릴리즈 배포는 하지 않았다.
