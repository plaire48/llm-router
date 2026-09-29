# 브라우저 누비 품질 작업표

동일 후보 핵심 검증: [전체 보고서](beta34-browser.json). 실제 모델 정확도는 미측정이다.

| 순서 / ID | 항목 | 상태 | 연결 검사 | 다음 행동 |
| --- | --- | --- | --- | --- |
| 1 / NQ-16 | 회귀 점수와 프로세스 종료 근거 일치 | 구현 / 핵심 회귀 통과 | unit | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 2 / NQ-17 | 항목별 검사 근거와 다음 행동 연결 | 구현 / 핵심 회귀 통과 | unit | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 3 / NQ-15 | 하위 분석 보고서와 근거 반환의 독립 사본 | 구현 / 핵심 회귀 통과 | unit, analysis-retention-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 4 / NQ-13 | 현재 소스와 검증 근거를 자동 대조하는 작업 목록 | 구현 / 핵심 회귀 통과 | unit | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 5 / NQ-14 | Pi 0.87.1 업그레이드와 질문/승인 중지 경계 | 구현 / 핵심 회귀 통과 | unit, clarification-browser, popup-approval-browser, role-agents-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 6 / NQ-01 | 동일 후보 핵심 회귀 | 구현 / 핵심 회귀 통과 | unit, design, candidate-build | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 7 / NQ-02 | 실제 Qwen 업무 성공률 | 외부 조건 대기 / 완료 아님 | 실환경/도입 조건 별도 | 회사망의 평가 전용 인증을 연결하고 8개 정답 과제를 각각 3회 실행해 실제 Qwen 결과를 채점 |
| 8 / NQ-03 | 내장/외부 Wiki와 긴 문서 위임 | 구현 / 핵심 회귀 통과 | openwiki-agent-browser, wiki-folder-persistence-browser, document-retrieval-browser, wiki-quality-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 9 / NQ-04 | 실제 사이트 저장/등록 완료 | 외부 조건 대기 / 완료 아님 | 실환경/도입 조건 별도 | 대표 사이트와 저장/등록 완료를 판정할 서버 영수증 계약 확보 후 검증 |
| 10 / NQ-05 | worker 및 Chrome 종료 후 미확정 입력 | 구현 / 핵심 회귀 통과 | restart-write-browser, background-lifetime-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 11 / NQ-06 | native 확인창과 사용자 답변 | 구현 / 핵심 회귀 통과 | native-dialog-approval-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 12 / NQ-07 | 실계정 SSO와 Windows/Edge 설치 | 외부 조건 대기 / 완료 아님 | 실환경/도입 조건 별도 | Windows/Edge 환경과 각 제공자 실계정으로 로그인/모델 선택/설치 업데이트 검증 |
| 13 / NQ-08 | 공식 WebArena 독립 평가 | 외부 조건 대기 / 완료 아님 | 실환경/도입 조건 별도 | 공식 WebArena Docker 환경과 평가 인증을 연결하고 독립 grader 실행 |
| 14 / C01-C08 | 진단/파일 전송/알림/녹화/예약/조직 정책 | 구현 / 핵심 회귀 통과 | browser-routines-browser, browser-diagnostics-browser, browser-policy-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 15 / C10-C12 | 녹화 종료와 저장 복구 | 구현 / 핵심 회귀 통과 | browser-routines-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 16 / NQ-10 | 반복 감지와 필수 조건 보존 | 구현 / 핵심 회귀 통과 | context-browser, harness-repair-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 17 / NQ-11 | 하위 분석 원래 조건과 배치 검증 | 구현 / 핵심 회귀 통과 | analysis-retention-browser, role-agents-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 18 / NQ-12 | 압축 후 하위 분석 재조회 | 구현 / 핵심 회귀 통과 | analysis-retention-browser, context-browser | 소스 변경 시 연결된 검사와 동일 후보 핵심 회귀를 다시 검증 |
| 19 / NQ-18 | 큰 첨부 문서 분할 조사와 압축 후 최종 근거 | 구현 / 핵심 회귀 통과 | unit, large-document-browser, context-browser | 현재 후보의 v5 핵심 또는 전체 gate에서 문서 범위/압축/최종 근거 회귀를 검증 |
| 20 / NQ-19 | 역할별 워커 진행과 전체 실행 기록 | 구현 / 핵심 회귀 통과 | unit, subagent-progress-browser, trace-journal-browser | 현재 후보의 v5 핵심 또는 전체 gate에서 역할 표시와 전체 기록 회귀를 검증 |
| 21 / D01 | Pi 세션 분기/전체 하네스 교체 | 비채택 / 완료 아님 | 실환경/도입 조건 별도 | 새 사용자 요구나 재현 결함이 생기면 기존 비채택 근거를 다시 검토 |
| 22 / D02 | Pi 도구 진행 이벤트 별도 도입 | 비채택 / 완료 아님 | 실환경/도입 조건 별도 | 새 사용자 요구나 재현 결함이 생기면 기존 비채택 근거를 다시 검토 |
| 23 / D03 | Pi 스킬 파일 로더로 교체 | 비채택 / 완료 아님 | 실환경/도입 조건 별도 | 새 사용자 요구나 재현 결함이 생기면 기존 비채택 근거를 다시 검토 |
| 24 / D04 | 외부 telemetry SDK 도입 | 비채택 / 완료 아님 | 실환경/도입 조건 별도 | 새 사용자 요구나 재현 결함이 생기면 기존 비채택 근거를 다시 검토 |
| 25 / D05 | 검색 엔진/DeepAgents/UI 도구 일괄 최신화 | 비채택 / 완료 아님 | 실환경/도입 조건 별도 | 새 사용자 요구나 재현 결함이 생기면 기존 비채택 근거를 다시 검토 |

연결 검사는 해당 항목의 핵심 회귀 근거다. 개별 세부 기능 전부나 실서비스 성공을 입증하지 않는다. 단계별 로그는 quality:status -- --json의 evidenceStages에서 확인한다.
