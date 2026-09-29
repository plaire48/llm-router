# 1.0.1 상단 토스트

모든 CX 토스트를 화면 상단 중앙에 표시합니다. 작은 창은 12px, 큰 창은 24px의 상단 여백을 사용하며 안전 영역을 반영합니다. 모달 안 알림의 접근성 범위와 기존 닫기/자동 종료 동작을 유지합니다.

## 확인

- `npm run design:check` 통과
- `npm run build:candidate` 통과
- `node tests/feedback-browser.mjs` 통과: 실제 Chrome 확장으로 320px, 360px, 1100px에서 채팅과 모달 토스트의 상단 위치/가로 중앙/화면 내 배치를 확인
- 실제 클립보드 복사, 실패 후 재시도, 자동 종료, Escape, 초점 유지, 모션 감소와 재진입 상태 확인
- 결과: [검증 기록](evidence/1.0.1-report.json)

모델 응답과 오류는 합성 데이터입니다. 실제 회사 계정/SSO는 이번 CSS 패치에서 재검증하지 않았으며, 1.0.0 전체 기능 검사를 반복한 결과가 아닙니다.

검사한 후보 ZIP을 다시 빌드하지 않고 설치 파일로 승격했습니다.

- 파일: `aipro-chat-extension-1.0.1.zip`
- SHA-256: `976bf65b8bd0035c75f041ae3c84658f4b0fc575ace3cb38ff370ca9d4124ba5`
