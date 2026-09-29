# Beta 1.0.0 페이지 분석과 자동 복구

표시 버전은 **Beta 1.0.0**, Chrome 업데이트 번호는 **1.4.8**이다.

## 재현과 수정

기존 1.4.7의 실제 Chrome 실행에서 아래 여섯 가지를 재현했다.

- 인라인 태그가 있는 문장을 DOM 순서와 다르게 읽어 텍스트 검증 실패
- 비활성 입력란을 읽기 전에 실행 오류로 차단
- 약 1초의 대기만으로 늦게 뜨는 결과를 실패로 판정
- 스크립트가 반환한 snapshot을 즉시 다시 수집해 방금 받은 ref 무효화
- 일반적인 읽기 API 누락으로 `script_api` 반환
- 관찰된 비활성 필드의 inputValue 읽기 실패

본문 순서와 긴 문단 보존, 키워드 발췌, 읽기/쓰기 구분, 5초 검증 대기, 최신 참조 유지, getByTitle/getByAltText와 상태/메타데이터 읽기를 적용했다. 보호 필드, 오래된 참조, 임의 속성 읽기와 비활성 필드 쓰기는 차단한다. 페이지가 바뀌면 새 관찰을 받아 검증만 다시 하며 앞선 입력을 자동 재실행하지 않는다.

## 하네스

Pi Agent Core를 유지하며 도구 실패 이후 같은 응답의 후속 호출을 보류한다. 연속 오류 2회 또는 브라우저 작업 도구 5회 이상 실행 후에는 같은 제공자/모델의 중간 요구사항 검토가 다음 접근법을 제안한다. 필요한 사용자 정보는 질문으로 받는다. 최종 검토는 실제 근거로 진전이 있으면 두 번을 넘어 보완한다. ref만 바뀌는 동일 근거는 진전으로 보지 않는다.

[오픈소스 검토](OPEN-SOURCE-HARNESS.md)는 Nanobrowser의 역할 분리, Stagehand의 관찰/행동 구분, Browser Use의 실제 결과 평가 원칙을 참고했다. 새 외부 런타임이나 해당 프로젝트 코드를 추가하지 않았다.

## 검증

**단위 검사 293개**, 디자인 검사, 빌드, 관련 브라우저 **14개 스위트 30회**를 모두 통과했다. 페이지 읽기, 분석 복구, 질문, DOM 대상 지정, 새 창, 스크립트 사전 검사/복구, 실행 하네스는 새 프로필에서 각 3회 확인했다. ChatGPT, FabriX, 디버거 연결 범위, 승인, 출력/컨텍스트 복구도 확인했다.

[통합 결과](evidence/beta-1.0.0-analysis/report.json), [수정 전 재현](evidence/beta-1.0.0-analysis/page-analysis-before.json), [수정 후](evidence/beta-1.0.0-analysis/page-analysis-after.json), [하네스 복구](evidence/beta-1.0.0-analysis/analysis-recovery-browser.json), [실모델 미실행 기록](evidence/beta-1.0.0-analysis/agent-live-evaluation.json).

ZIP SHA-256: `a39af515e8d825bbb95589ff5257d40c082a6ce088282b875047de301202cda9`

합성 모델이 잘못된 코드와 불완전한 답변을 내는 상황에서 실제 Chrome 실행 결과를 확인했다. 중간 검토가 페이지 읽기로 방향을 바꾸고, 최종 검토가 누락한 장소를 보완했다. 이 시나리오에서 입력과 디버거 연결은 0회였다. 기존 초안 입력 복구는 실제 필드값, 중복 입력 없음, 최종 검토 완료로 판정했다.

전체 기능 재검증이나 실제 서비스 모델 정확도 측정은 아니다. [실모델 평가 실행기](AGENT-EVALUATION.md)는 준비했지만 이 환경에 인증이 없어 `not_configured`로 기록했다. 실제 AI Pro 평가 점수나 모든 사내 사이트의 성공률을 주장하지 않는다.

## 설치

검증한 후보 ZIP을 다시 빌드하지 않고 그대로 배포한다.

[설치 ZIP](https://github.com/plaire48/ai_workspace/releases/download/nubi-v1.0.0-beta.5/nubi-beta-1.0.0.zip). 기존 설치 폴더에 덮어쓰고 확장을 새로고침한다.
