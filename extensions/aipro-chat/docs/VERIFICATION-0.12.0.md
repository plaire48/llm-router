# 0.12.0 Requirement review on the Pi harness

검증일: 2026-09-21

## 적용

- 오픈소스 Pi 0.86.1의 Agent 루프와 Playwright CRX 1.21.4를 유지했다. 추가 런타임 설치는 없다.
- 실행 결과 검증 후 원래 요구사항과 실제 관찰을 별도 모델 요청에서 대조한다. 누락은 Pi followUp으로 보완하고 다시 검증한다.
- 완료 전 답변과 검토 JSON을 숨기고 기존 진행 영역에서 요청사항 확인 상태만 보여준다.
- 사용자 메시지만 옅은 블루 말풍선으로 표시하고 Agent는 박스를 제거했다. 두 본문색을 같게 맞췄다.
- 검토 실패/취소/미완료가 완료로 기록되지 않으며, 이어가기도 기존 검증 의무를 유지한다.
- 별도 검토의 실제 사용량을 제공자별 집계한다. 마지막 실행 요청의 컨텍스트 사용량은 유지한다.
- Nanobrowser의 완료 판단 분리 패턴을 참고했다. 해당 소스나 패키지는 번들하지 않았다. [비교 근거](OPEN-SOURCE-HARNESS.md).

## 확인

| 검증 | 결과 |
| --- | --- |
| `npm test` | 168개 통과. 잘못된 증거/잘린 응답/누락 보완/중단/재개/AI Pro와 ChatGPT 요청 계약 포함 |
| `npm run design:check` | 문제 없음 |
| `tests/feedback-browser.mjs` 기반 화면 확인 | 8개 피드백 시나리오와 320/360/1100px 배치 확인. 두 본문 색/크기 동일, Agent 배경/테두리/그림자 없음, 생성 중 표시와 복사 성공/실패 복구 확인 |
| `npm run build` | 0.12.0 설치 ZIP 생성 |
| `tests/harness-browser.mjs` | 6개 시나리오. 저장 실패 복구, 빠진 본문 보완, 제목 중복 입력 방지, 두 번의 별도 검토, worker 완료 차단 |
| `tests/browser-agent-browser.mjs` | 14개 시나리오. 일반 대화, 자동 페이지 연결, iframe/shadow DOM 초안, 코드 오류 복구, 이미지 입력, 중지 |
| `tests/fabrix-browser.mjs` | 5개 시나리오. 연결 모달, 도구 변환, 실제 초안 값/저장 안내 확인과 검토 사용량 |
| `tests/context-browser.mjs` | 5개 시나리오. 압축, 체크포인트, 새로고침 후 반복 입력 없이 새 검증 |
| `tests/page-images-browser.mjs` | 7개 시나리오. 이미지 도구 선택/첨부 후 검토, 원본 파일 다운로드, 좁은 화면과 데이터 삭제 |
| `tests/captures-browser.mjs` | 11개 시나리오. 채팅 첨부, 실제 사이드 패널 다운로드, 재진입과 데이터 수명 |

임시 Chrome for Testing 149.0.7827.55 프로필에 패키징한 확장을 설치했다. DOM 입력/클릭/이미지 표시/다운로드는 실제 Chrome 동작이다. 업무 사이트와 모델 응답은 합성이며 검토 모델도 고정 응답이다. 테스트용 설치 복사본의 사이트 권한을 미리 부여했다.

`tests/page-skills-browser.mjs`는 실제 optional host permission 승인을 기다리는 별도 수동 UI 경로다. 이번 headless 실행은 해당 권한 승인 단계에서 멈췄으므로 전체 통과로 포함하지 않았다. 별도 브라우저 자동화 시나리오의 성공과 이 최초 권한 승인 검증을 혼동하지 않는다.

실제 AI Pro/FabriX 회사 API, ChatGPT 실계정, 모델의 누락 탐지 정확도나 사이트의 서버 저장 성공을 검증한 결과는 아니다. 같은 모델의 별도 검토도 오류가 있을 수 있다. 재개 시 새 관찰을 요구하며 이전 결과의 자동 재실행을 보장하지 않는다.

브라우저 검증 자료는 로컬 `verification/`에 보관한다.
