# 0.13.2 도움말

검증일: 2026-09-21

설정 헤더의 물음표 아이콘에서 도움말을 연다. 같은 CX DetailPanel 안에서 7개 주제를 하나씩 펼친다. 시작 방법, 페이지 작업, 대화 이력, 이미지, 스킬, 모델과 사용량, 오류 복구를 현재 UI 기준으로 정리했다. 기존 CX 아이콘과 Noto Sans KR, 사용자 HTML 기준의 옅은 블루와 여백을 유지한다.

help-content.js를 앱과 오프라인 안내의 공통 원본으로 사용한다. 빌드가 GUIDE.md를 생성해 설치 ZIP에 포함한다. 개발 연결 규격은 docs/DEVELOPMENT.md로 옮기고 TESTING.md는 검증 명령과 범위를 안내한다. 설치 ZIP에는 개발 문서 대신 GUIDE.md를 포함한다.

## 확인 결과

- npm run design:check와 npm run build 통과.
- 격리한 Chrome 확장에서 로그인 전과 합성 AI Pro 로그인 후 도움말 열기 확인.
- 하나의 모달 안에서 주제 펼치기, Enter/Space 조작, 저장소 상태 갱신 후 열린 주제 유지 확인.
- 닫기와 Escape로 설정에 돌아오고, 도움말 아이콘에 초점 복귀 확인. 돌아온 아이콘에서는 Escape 한 번으로 설정을 닫는다.
- 320×480, 360×480, 360×800, 1100×850에서 가로 넘침 없이 표시. 짧은 창에서도 마지막 답변까지 스크롤 가능.
- 도움말을 여닫아도 대화 ID, 초안과 연결 페이지 유지. 새로고침 후 초안 복원 확인.
- 도움말 조작으로 추가 모델 요청이 발생하지 않으며 로그인 전 네트워크 요청 없음.
- GUIDE.md와 설치 폴더의 GUIDE.md가 공통 원본의 출력과 일치. 브라우저 런타임 오류 없음.

시각 확인: verification/help-360.png, help-trouble-320.png, help-trouble-360.png, help-trouble-1100.png, help-skills-desktop.png. 실행 결과는 verification/help-browser.json에 기록했다. 검증 자료는 로컬에 보관한다.

이번 검증은 도움말 UI와 패키징 범위다. 실제 계정 로그인과 회사망 API는 다시 검증하지 않았다. 인증, 모델 호출과 자동화 실행 계약은 변경하지 않았다.
