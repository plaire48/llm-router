누비 Workspace의 채팅 UI, 모델 로그인과 Claude 연결을 공유하는 GenOffice 기반 Office 2016 VSTO Beta입니다.

## 설치

`Nubi-Office-X-0.3.0-Setup.exe` 하나를 내려받아 실행하세요. Excel, Word, PowerPoint를 닫고 설치한 다음 각 앱의 **Office X → Office X 열기**를 선택합니다.

- Windows 10 이상, Office 2016, 관리자 권한이 필요합니다.
- Node 런타임 포함. WebView2가 없으면 설치 중 인터넷 연결이 필요합니다.
- Excel/Word/PowerPoint를 한 번에 설치하거나 사용할 앱만 선택할 수 있습니다.
- Beta EXE는 배포용 코드 서명이 없습니다. VSTO manifest에는 무결성 확인용 미리보기 서명만 있습니다.
- 기존 Nubi Office와 다른 폴더/추가 기능 ID로 설치됩니다.

## 첫 사용 범위

- Excel: 선택한 표 읽기, 빈 셀에 수량 × 단가 수식 적용과 결과 검증
- Word: 선택한 일반 문장 읽기와 한 문단 수정
- PowerPoint: 선택한 텍스트 상자 읽기와 한 문단 수정
- 모든 수정은 변경안 승인, 원문 재확인, 적용 결과 검증을 거칩니다. 자동 저장하지 않습니다.
- 복잡한 서식, 여러 문단, 자동 크기 텍스트 상자는 직접 편집 대신 채팅에서 수정안을 제공합니다.
- AIPro, ChatGPT, FabriX, Claude 연결 UI를 제공합니다. Claude는 별도 Claude Code 설치/로그인이 필요합니다.

## 검증 범위

Windows CI에서 세 앱 VSTO 빌드와 설치, 재설치, 제거 및 등록 검사를 수행합니다. 첨부 `install-smoke.json`에 측정값이 있습니다. 실제 Office 2016 실행과 실제 모델 계정 연결은 아직 검증되지 않았습니다. 원본 사본에서 첫 실행을 확인해 주세요.

소스 ZIP은 개발자용이며 설치에는 필요하지 않습니다.
