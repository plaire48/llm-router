# 0.8.10 변경

누비 Workspace의 현재 `ChatControls.jsx`, `workspace-identity.css`, `workspace-dialogs.css`를 대조해 Office 모달 공통 계약을 만들었다. 원본 vendor 파일은 변경하지 않았다.

모델, 웹 검색, FabriX, 문서 대상, 복원 폼이 같은 제목·본문·하단 버튼 위계를 사용한다. Office 폭에 필요한 줄바꿈과 스크롤만 별도로 처리한다. 전체 Office 문서 실행 도구와 GenOffice 기능 범위는 0.8.9와 같다.

검증 기록: `verification/modal-identity-0.8.10.json`, `verification/cx-audit/current-reference-sources.json`. 현재 Workspace CSS를 렌더링한 참조이며 실제 Electron 화면 증빙은 아니다. 입력칸은 Workspace에 선언된 폰트 체인을 직접 적용해 원본의 루트에서 계산된 폰트 축약 속성이 별도 폰트를 상속하는 차이를 없앴다.

실제 Windows Office 2016 및 사용자 계정 모델 실행은 접근 가능한 환경이 없어 미검증이다.
