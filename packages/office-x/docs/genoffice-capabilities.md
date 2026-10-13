# GenOffice 기능 대응 — 0.8.1

원본 기준: genspark-ai/genoffice `438d9c65709952490c970beaa2599ef45e74431f`. 원본 4,582개 파일과 라이선스는 보존한다. 제품에는 별도 편집기를 설치하지 않는다. 원본 AgentLoop와 composeSkills, 실제 파일 엔진을 Office 작업창의 백그라운드 실행부로 사용한다. 누비는 채팅·계정·모델 transport와 CX를 제공한다.

| 기능 | Office 안의 실행 경로 | 검증과 한계 |
| --- | --- | --- |
| 전체 문서·개체 읽기 및 현재 문서 수정 | inspect_office / execute_office_operations → 실제 Office Object Model | 선택 셀 밖의 데이터 조회 가능. 실행 계약·직접 IDispatch 검사. 실제 Office 개체별 검증 필요 |
| 새 Office 문서 | 대상 선택 → create_document / open_document_artifact → 내용 재조회와 창·Agent 연결 | 현재 문서 요청은 원래 창에서 실행. 모의 계약·WebView2 검사; 실제 Office 창 전환 확인 필요 |
| Word·XLSX 원본 엔진 | list_original_operations / read_original_document / apply_original_operations → 백그라운드 CLI | 실제 DOCX/XLSX 편집과 독립 재조회 검사. 파일 엔진 결과는 사본 artifact이며 현재 문서 수정으로 보고하지 않음. 현재 문서는 네이티브 도구로 수정 |
| 웹 검색과 출처 | 원본 ai-search 체인 / read_web_page / 웹 검색 연결 폼 | 원본 서비스 경로. 실제 검색 서비스 품질·계정은 별도 확인 |
| 발표자료 생성·한 장 재작성 | 원본 parsePageSpec / buildDeckPptx / auditDeck → 현재 PPT에 가져오기·텍스트 재검사 | 실제 PPTX 정확한 장 수 검사. 이미지 없는 텍스트·도형 레이아웃. 현재 문서에는 replace/append |
| PPTX 고급 편집 | 원본 pptx-ops / runTxn → 현재 발표자료에 슬라이드 가져오기 | 도형·텍스트·표·차트·그룹·노트·레이아웃 등. 이미지/미디어 추가 작업 제외. 모든 마스터·애니메이션의 Office 보존은 미검증 |
| 문서 화면 렌더링 | PPT Slide.Export / Word·Excel PDF 내보내기 → PDFium | 문서 검증용 실제 페이지 렌더 경로 유지. 이미지 생성 기능과 별개. 실제 Office 렌더 확인 필요 |
| PDF·Markdown·HTML 처리 | 원본 pdf2docx / marked / sanitize-html → artifact·Office 가져오기 | 실제 PDF 변환 ZIP·Markdown·비활성 HTML 검사. 별도 PDF/HTML/Markdown 편집기 없음. OCR 미포함 |
| 전체 문서 복원 | 네이티브 전체 스냅샷 → DPAPI 보관 → 승인 후 새 Office 문서로 복원 | 기존 파일 유지. 세션 범위 복원 지점. 실제 Office·VBA·고급 서식 보존 확인 필요 |
| 저장·가져오기·스타일 | 네이티브 문서 파일 선택/저장, 원본 가이드와 스타일 템플릿 | 임의 파일 경로 조회 불가. 이미지/미디어 파일 선택 제외 |

제외 기능은 새 대화·대화 이력·별도 편집기, 이미지 검색·생성·삽입·미디어 분석이다. UI만 숨기는 방식이 아니라 Agent 도구 목록·실행 경로·설정과 설치 구성에서 제거한다. 오래된 모델 호출과 PPTX/Word 작업에 숨긴 이미지 추가도 거부한다. 기존 문서에 포함된 이미지를 읽거나 기존 문서를 렌더링·복원하는 기능은 문서 처리에 속한다.

원본 저장소의 편집기 전용 UI 기능까지 Office에서 동일하게 동작한다고 주장하지 않는다. 원본 파일 엔진이 거부하는 작업은 실패를 보고하며 별도 편집기로 우회하지 않는다. Workspace A2A와 Genspark 계정 UI는 활성화하지 않았다.

변경은 승인·스냅샷·재조회 검증을 거친다. 실패한 COM 쓰기는 자동 재실행하지 않는다. 이미 확인한 문서 변경과 후속 모델 응답 실패는 별도로 표시한다. COM 객체는 VSTO 안에서만 사용하고 UI/Agent에는 값 기반 계약을 전달한다.

Windows CI는 실제 WinForms WebView2에서 C# 계약, Windows 마우스 클릭과 키보드 입력, 오류 복구를 검사한다. Office 프로그램 내부와 실제 계정 모델은 이 검사에 포함되지 않는다. `Test-OfficeRuntime.ps1`로 Office PC에서 문서 입력·렌더링·복원을 확인할 수 있다.

동기 호출은 UI 컨텍스트가 없을 때 소유 스레드를 유지한다. VSTO 메시지 경로에서는 Windows Forms UI 컨텍스트를 설치해 승인 후 COM 호출을 유지한다. 읽기 전용 호출은 완료한 쓰기로 집계하지 않는다. 동일한 네이티브 오류 세 번 반복 시 Agent를 중단하고 진단 정보 복사를 제공한다.
