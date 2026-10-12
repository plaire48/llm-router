# 누비 Agent Office 0.5.0

Windows Office 2016의 Excel, Word, PowerPoint에서 누비 채팅과 GenOffice Agent를 사용합니다.

[Windows 설치 파일](https://github.com/plaire48/llm-router/releases/tag/office-x-v0.5.0-beta.1)을 받아 Office 앱을 닫고 실행하세요. 각 앱의 **누비 Agent** 탭에서 시작합니다.

선택 영역 밖의 문서를 읽고, 기존 내용과 서식을 수정하고, 새 문서·발표자료·통합문서를 생성하는 공통 Office 실행기를 제공합니다. 요청한 저장과 PDF 출력도 연결합니다. 누비 Workspace의 로그인, Claude, 폰트와 색감을 유지합니다.

[변경 내용](RELEASE-NOTES.md)과 [GenOffice 기능 대응 및 실제 검증 범위](docs/genoffice-capabilities.md)를 확인하세요. 원본 전체 제품의 기능 동등성이나 실제 Office COM 실행을 검증 완료한 버전은 아닙니다.

개발: `npm ci`, `npm run build`, `npm test`. Windows 설치 빌드는 `Build-Windows.cmd` 또는 `scripts/Build-Windows.ps1`을 사용합니다.

[구현 기록](docs/implementation-status.md) · [아키텍처](docs/architecture.md) · [라이선스](THIRD-PARTY-NOTICES.md)
