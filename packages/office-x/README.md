# Nubi Office X 0.8.15

Windows Office 2016의 Excel, Word, PowerPoint 안에서 누비 채팅과 GenOffice Agent를 사용합니다. 별도 GenOffice 편집기는 설치하지 않습니다.

[Windows 설치 파일](https://github.com/plaire48/llm-router/releases/tag/office-x-v0.8.15-beta.1)을 받아 Office 앱을 닫고 실행하세요. 각 앱의 **누비 Agent** 탭에서 시작합니다.

GenOffice AgentLoop, Word/XLSX 파일 엔진, PPTX 작업·생성·레이아웃 검사, PDF 변환을 재사용합니다. 현재 Office 문서는 네이티브 작업 도구로 수정하고 결과를 다시 읽습니다. 누비 Workspace의 계정·모델 선택, Claude 연결, 폰트·색감·강조를 유지합니다. 추론 설정과 토큰 사용량·남은 문맥 비율·대화 요약을 연결했습니다.

웹 검색·새 대화·대화 이력·별도 편집기·이미지 검색/생성/삽입/분석 기능은 제외했습니다. 발표자료와 문서의 검증용 렌더링은 유지합니다. 현재 문서와 새 Office 문서 선택은 실제 문서 작업의 대상 지정입니다.

채팅 입력은 작업 중에도 가능하며, 전송은 현재 작업 종료 후 가능합니다. 시작 오류가 나면 입력 잠금을 해제합니다. 연결 오류가 화면 전체를 덮지 않도록 복구 레이어를 분리했습니다.

[변경 내용](RELEASE-NOTES.md) · [기능과 검증 범위](docs/genoffice-capabilities.md) · [라이선스](THIRD-PARTY-NOTICES.md)

개발: `npm ci`, `npm run build`, `npm test`. Windows 설치 빌드: `Build-Windows.cmd` 또는 `scripts/Build-Windows.ps1`.

문서 작업 오류가 반복되면 채팅의 **실행 오류 정보**를 펼쳐 **문서 작업 오류 복사**를 사용하세요. 실패 도구, 멤버와 코드를 함께 확인할 수 있습니다.

[문서를 Markdown으로 저장](docs/markdown-export.md): 현재 문서나 선택한 파일 전체를 읽고 요청한 위치에 저장합니다.
