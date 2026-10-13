# Nubi Office X 0.8.12 Beta 1

Agent가 현재 Office 문서나 선택한 파일 전체를 읽어 요청한 위치에 Markdown으로 저장합니다. GenOffice·Microsoft MarkItDown·Docling을 실제 변환 경로에 연결했습니다.

- Excel의 시트·셀 주소·수식·날짜·병합 범위, Word의 제목·목록·표·머리글·각주, PowerPoint의 슬라이드·표·발표자 노트를 보존합니다.
- 현재 문서는 SaveCopyAs나 새 창 없이 읽습니다. 변환 도중 문서가 바뀌면 저장 전에 확인합니다.
- PDF의 페이지·원문 텍스트를 GenOffice로 확인하고 Docling으로 표와 한국어 OCR을 분석합니다. OCR은 원문 대조 필요 상태로 표시합니다.
- 지정 경로 저장은 대화 안에서 확인하고 UTF-8 파일을 원자적으로 교체한 뒤 최종 파일의 SHA-256을 확인합니다. 저장 후 모델 응답 오류가 나도 저장을 반복하지 않습니다.
- 추가 변환 엔진은 처음 필요할 때 준비해 설치 파일 크기를 줄입니다. 준비·분석·추출 확인 상태를 채팅에 표시합니다.
- 기존 누비 채팅·모델 선택·문맥 토큰·압축 UI와 GenOffice 작성·편집·렌더링·복원 기능을 유지합니다. 웹 검색·이미지 기능·별도 편집기를 추가하지 않았습니다.

사용 예: **“현재 통합문서를 바탕화면의 매출 분석.md로 저장해 줘.”**

Windows 설치본에서 변환 엔진 최초 준비, 실제 DOCX·XLSX·PPTX·HTML 변환과 한국어 PDF OCR을 통과했습니다. 32·64비트 COM 테스트, 실제 Windows WebView2 클릭·입력, 설치·재설치·제거도 통과했습니다. 테스트 환경의 설치는 9.05초였으며 엔진 최초 준비를 포함한 변환 검증은 약 136초였습니다. macOS에서는 디지털 PDF 분석도 확인했습니다. Windows 빌드·설치·COM 테스트는 실제 Excel/Word/PowerPoint 2016 및 실계정 Claude/ChatGPT 연결 검증을 대신하지 않습니다. 현재 실제 Office 호스트는 연결되지 않았습니다.

[처리 범위와 제한](https://github.com/plaire48/llm-router/blob/1cb37f06322cb56949325b5954c91b259b31e2da/packages/office-x/docs/markdown-export.md)

[Windows 빌드와 검증](https://github.com/plaire48/llm-router/actions/runs/38479267500)
