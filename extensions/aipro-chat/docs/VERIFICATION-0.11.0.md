# 0.11.0 Character and result verification

검증일: 2026-09-21

## 적용

- 사용자가 선택한 청록색 새를 민트/아쿠아/청록 그라데이션으로 고도화했다. 부리 추가안은 제외했다. 이름은 누비(Nubi)로 확정했다.
- 첫 화면, 상단, 답변과 확장 PNG 아이콘에 적용했다. 제공자 버튼은 기존 공식 로고를 유지한다.
- 한글 누비 전용 글자와 캐릭터를 조합한 로고, 사용자가 지정한 메인 소개, 누비 시스템 프롬프트를 적용했다. HTML의 색상 농도와 CX 본문 서체를 유지한다.
- 앱 안에서는 빠른 짧은 날갯짓, 작은 떠오름/착지, 눈 깜빡임을 보여준다. 답변 pending→done 때만 잠깐 눈웃음을 짓는다. Chrome 툴바 PNG 자체는 정적이다.
- 도구 그룹 선택과 독립된 verify_page 검사를 Pi 루프에 연결했다. 검증 전 완료 텍스트는 보류하고 worker도 미검증 완료를 거부한다.

## 확인

| 검증 | 결과 |
| --- | --- |
| `npm test` | 159개 통과 |
| `npm run design:check` | 문제 없음 |
| `npm run build` | ZIP 생성 |
| `tests/welcome-browser.mjs` | 320/360/1100px 배치, 하단 입력창, 모션 설정과 재진입 확인 |
| `tests/mascot-browser.mjs` | 투명 프레임, 빠른 날갯짓/떠오름/깜빡임, 작은 PNG 규격, 정지/감소 설정 확인 |
| `tests/harness-browser.mjs` | 3개 시나리오 통과, 실제 입력/저장 실패/수정/재검증, 미검증 완료 거부 |
| `tests/browser-agent-browser.mjs` | 14개 시나리오 통과, iframe/shadow DOM 메일 초안과 스크립트 오류 복구 |
| `tests/fabrix-browser.mjs` | 5개 시나리오 통과, 동적 스크립트 선택과 초안 값/저장 안내 검증 |
| `tests/captures-browser.mjs` | 11개 시나리오 통과, 읽기 전용 스크립트 캡처/첨부/다운로드 유지 |

임시 Chrome 프로필에 패키징한 확장을 설치했다. DOM 입력/클릭/검증/이미지 표시/다운로드는 실제 브라우저에서 실행했고 인증과 모델 응답은 합성이다. 모델이 성공 조건을 올바르게 선택하는 성능이나 실제 회사 서비스의 저장/SSO, ChatGPT 실계정 성공을 증명하는 결과는 아니다. 가시적인 저장 안내와 입력값 유지가 서버 영속성을 독립 보증하지는 않는다.

브라우저 검증 자료는 로컬 `verification/`에 둔다. 이미지 원본/생성 프롬프트는 `design/brand/`, 하네스 계약은 `docs/AGENT-HARNESS.md`다.
