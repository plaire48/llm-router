# 브라우저 실행 결과 기반 복구

2026-09-23. 로컬 Beta 1.0.0 후보에 적용. 실패한 도구의 결과를 다음 모델 판단에 돌려주고, 실제 화면 변화와 반복 실패를 구분한다.

## 선택한 BP와 오픈소스

| 근거 | 적용 | 선택 이유 |
| --- | --- | --- |
| [Browser Use의 에이전트 실행기](https://github.com/browser-use/browser-use/blob/d8110c5ff87ccba887aaa726cdb780f2f84bef8d/browser_use/agent/service.py) | 동작 이력과 실제 페이지 상태를 함께 확인하고 반복 시 접근을 재검토하는 패턴 | 클릭 성공 여부만으로 작업 진전을 판단하지 않음. `record_action`, `record_page_state`, `_inject_loop_detection_nudge` 참고 |
| [Playwright 자동 대기와 검증](https://playwright.dev/docs/actionability) | 기존 actionability 대기, 정확한 관찰 대상, 결과 조건 재확인 | 가림/비활성/요소 변경을 무시한 force 클릭이나 DOM 강제 클릭 대신 원인 수정 |
| [Pi agent loop](https://github.com/earendil-works/pi/blob/main/packages/agent/src/agent-loop.ts) | 기존 0.86.1 런타임의 도구 전후 훅과 후속 모델 호출 유지 | 제공자 계약, 승인, 취소와 같은 대화를 유지하면서 매 동작 결과를 판단 |
| [Acorn](https://github.com/acornjs/acorn) | 기존 8.18.0 tokenizer로 스크립트의 의미 있는 토큰 비교 | 주석/공백이나 새 참조 문자열 때문에 같은 실패가 다른 시도로 보이지 않음. 실행이나 코드 주입이 아님 |

[Browser Use 0.13.10의 패키지 정의](https://github.com/browser-use/browser-use/blob/d8110c5ff87ccba887aaa726cdb780f2f84bef8d/pyproject.toml)는 MIT 라이선스와 Python 3.11 이상을 명시한다. 확장만 설치하는 제품 조건에 맞춰 런타임을 추가하지 않고 패턴을 참고했다. 구현 코드를 복사하거나 Browser Use 자체를 번들에 넣지는 않았다. Pi, Playwright, Acorn은 기존 의존성을 사용한다. 이 선택은 배포 구조에 대한 판단이며 Qwen의 모델 성능 비교 결과가 아니다.

## 재현한 결함과 수정

1. 실패 사이에 `browser_snapshot`이 성공하면 실패 횟수가 초기화되어 중간 검토가 늦어졌다. 같은 화면을 다시 읽는 것은 오류 해결로 취급하지 않는다.
2. 같은 성공 결과의 누적 횟수가 작업 전체에 남아, 새로운 검색 결과를 여러 번 확인한 정상 작업도 중단됐다. 실제 결과가 바뀌면 반복 감지 구간을 새로 시작한다.
3. 참조 ID가 새로 발급되면 같은 대상의 실패도 다른 호출로 보였다. 현재 실행에서 관찰한 대상의 프레임, 위치와 의미 정보를 비교에만 사용한다. 실행은 여전히 최신 실제 참조로만 한다.

`browser-recovery.js`는 실행 중에만 비교 상태를 유지한다. 실제 페이지 내용/상태와 값/검증 결과의 변화를 비교하고, timestamp, ref, 화면 ID, 분석 ID, 설명과 로그는 진전으로 세지 않는다. 성공한 조회가 중간에 끼어도 화면 변화 없는 두 실패는 기존 중간 검토를 호출한다. 같은 실패는 기존 복구 한도 안에서 질문으로 전환할 수 있다. 진행하는 전체 작업의 동작 수를 제한하지 않는다.

원인별 안내는 고정된 분류를 기존 첫 system 메시지에 합친다. 가림은 오버레이 확인, 대상 변경은 재관찰, 결과 검증 실패는 실제 조건 비교와 누락 단계 수정으로 이어간다. 페이지 원문이나 입력값은 system 안내에 합치지 않는다. 비교 키도 진단/진행 UI에 저장하지 않는다. Qwen의 단일 system 계약, 기존 실행 기록, 완료한 입력 재실행 방지, 최종 HITL과 사용자 취소를 유지한다.

## 검증

- 단위: 같은 화면 재조회 사이의 실패 누적, 참조/주석/공백 변경, 서로 다른 프레임의 대상 구분, 실제 결과 변화 시 초기화, 안내의 원문 배제.
- `outcome-recovery-browser`: 실제 Chrome에서 대상을 두 번 재렌더링해 stale 참조를 만들고, 중간 조회가 성공해도 즉시 재검토하는지 확인한다. 검색 결과 검증이 실패하면 범위를 변경하고 재검색한다. 입력 1회, 검색 2회, 실제 결과, 오류 기록과 새로고침 보존을 검사한다.
- `error-recovery-browser`, `script-recovery-browser`, `analysis-recovery-browser`: 기존 응답 유실/추론 재시도/스크립트 수정/독립 검토와 함께 검사한다.

Chrome 검사는 합성 Qwen 응답과 합성 사이트를 사용하며 실제 확장 도구를 실행한다. 실제 회사 페이지와 Qwen의 계획 정확도, 자동 수정 성공률, 토큰 비용은 별도 평가 대상이다. 공개 배포와 로컬 후보 검증을 구분한다. 실행 결과와 선택 스위트는 `verification/pre-release-*/report.json`에서 확인한다.
