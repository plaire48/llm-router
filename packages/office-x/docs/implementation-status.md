# 0.8.7 변경

TaskPaneOpening은 VSTO Add에 String.Empty를 전달하지 않는다. 기본 표시 제목은 U+200B로 길이가 1이고 whitespace-only가 아니다. 공장 호출의 ArgumentException만 같은 창/호환 제목, 활성 창/호환 제목 순서로 제한하여 처리한다. 너비 인자 거절은 420에서 320, Office 기본 너비로 처리한다. 실제 Office의 빈 제목 검증 규칙이나 사용자 예외의 ParamName은 아직 관측되지 않았다.

세 VSTO 호스트의 최초 표시와 새 문서 연결이 공통 경로를 사용한다. 생성 중 예외 발생 시 컨트롤과 생성된 작업창을 정리하고 실패 단계가 포함된 진단을 표시한다. Dispose된 follower는 원래 세션에서 제거해 이후 포커스 판단을 막지 않는다. 새로운 화면 준비 전에 원래 작업창을 숨기지 않는다.

TaskPaneStartupDiagnostics는 단계, 예외 종류, 안전한 인자 이름, HRESULT, 확인 번호를 제공한다. 예외의 원문 메시지나 문서 내용/경로는 포함하지 않는다.

문서 도구와 모델 동작은 0.8.6과 동일하다. Windows 빌드와 설치된 WinForms WebView2 검증은 Office VSTO 내부 실행과 별개이며 실제 Office 2016 작업창 열기는 미검증이다.
