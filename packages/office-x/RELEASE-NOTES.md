# Nubi Office X 0.8.12 Beta 1

Agent가 현재 Office 문서나 선택한 파일 전체를 읽어 요청한 위치에 Markdown으로 저장합니다. GenOffice·Microsoft MarkItDown·Docling을 실제 변환 경로에 연결했습니다.

- Excel의 시트·셀 주소·수식·날짜·병합 범위, Word의 제목·목록·표·머리글·각주, PowerPoint의 슬라이드·표·발표자 노트를 보존합니다.
- 현재 문서는 SaveCopyAs나 새 창 없이 읽습니다. 변환 도중 문서가 바뀌면 저장 전에 확인합니다.
- PDF의 페이지·원문 텍스트를 GenOffice로 확인하고 Docling으로 표와 한국어 OCR을 분석합니다. OCR은 원문 대조 필요 상태로 표시합니다.
- 지정 경로 저장은 대화 안에서 확인하고 UTF-8 파일을 원자적으로 교체한 뒤 최종 파일의 SHA-256을 확인합니다. 저장 후 모델 응답 오류가 나도 저장을 반복하지 않습니다.
- 추가 변환 엔진은 처음 필요할 때 준비해 설치 파일 크기를 줄입니다. 준비·분석·추출 확인 상태를 채팅에 표시합니다.
- 기존 누비 채팅·모델 선택·문맥 토큰·압축 UI와 GenOffice 작성·편집·렌더링·복원 기능을 유지합니다. 웹 검색·이미지 기능·별도 편집기를 추가하지 않았습니다.

사용 예: **“현재 통합문서를 바탕화면의 매출 분석.md로 저장해 줘.”**

실제 DOCX·XLSX·PPTX·HTML·PDF 변환과 한국어 OCR 테스트가 macOS에서 통과했습니다. Windows 설치본 변환 및 COM 검증은 배포 빌드에서 별도로 실행합니다. Windows 빌드·설치·COM 테스트는 실제 Excel/Word/PowerPoint 2016 및 실계정 Claude/ChatGPT 연결 검증을 대신하지 않습니다. 현재 실제 Office 호스트는 연결되지 않았습니다.

자세한 처리 범위와 제한: docs/markdown-export.md
