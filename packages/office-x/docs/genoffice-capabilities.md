# GenOffice 기능 대응 — 0.6.0

기준: genspark-ai/genoffice, commit `438d9c65709952490c970beaa2599ef45e74431f`. 원본 12개 패키지, 842개 파일을 수정하지 않고 사용한다. Agent는 원본 AgentLoop와 composeSkills이며 누비는 UI·로그인·모델 transport를 제공한다.

| 기능 | 연결한 실행 경로 | 검증 범위 |
| --- | --- | --- |
| Office 전체 내용·개체 읽기, 값·수식·서식·표·차트·피벗, 문단·목록·주석·머리말, 도형·슬라이드·노트 | inspect_office / execute_office_operations → 현재 문서의 Office Object Model | 실행 계약 68개; 실제 개체별 COM 미검증 |
| 새 Word·Excel·PowerPoint 문서 생성 | create_document → 실제 Office 생성·내용 재조회·창 활성화·Agent 연결 | 모의 실행·화면 검사; 실제 창 전환 미검증 |
| 웹·이미지 검색 및 출처 | 원본 ai-search의 Parallel·Serper·Serply·Tavily·Exa·Firecrawl 체인 | 실제 서비스 요청 경로 연결; 실제 서비스 응답 품질 미검증 |
| 이미지 생성·수정과 이미지/영상/음성 분석 | 원본 ai-provider 미디어 프로토콜과 서비스 목록; DPAPI 연결 설정 | 모의 HTTP로 원본 생성 프로토콜과 실제 PNG 파일 확인; 실제 계정 미검증 |
| 이미지 삽입 | 파일 artifact → Word InlineShapes / Excel·PPT Shapes.AddPicture | 네이티브 구현·컴파일; 실제 삽입 미검증. Office 2016에 PNG/JPEG/GIF/BMP 삽입; WebP는 PNG/JPEG 변환 필요 |
| 발표자료 전체 생성·한 장 재작성 | 원본 pipelines parsePageSpec / buildDeckPptx / auditDeck 및 현재 선택 모델 | 실제 원본 PPTX로 정확한 페이지 수 검사. Office가 읽은 텍스트 해시 재검사 경로 연결 |
| 원본 PPTX 고급 작업 | 원본 pptx-ops registry / runTxn, 원본 parser·serializer | 모든 원본 작업 이름·가이드 노출. 현재 문서에는 슬라이드를 가져오고, 새 문서 선택 시 전체 파일을 엶. 모든 마스터·애니메이션·고급 개체의 Office 보존 미검증 |
| 실제 문서 렌더링 | PPT Slide.Export → PNG; Word·Excel ExportAsFixedFormat → PDFium 페이지 PNG | 네이티브 컴파일·PDFium 실제 실행; Office 렌더링 미검증 |
| PDF 변환 | 원본 pdf2docx → DOCX / PPTX / XLSX | 실제 PDF와 생성 ZIP 검사. 스캔·변환 저하·페이지 경고 반환; 원본 OCR 서비스는 별도 이식하지 않음 |
| Markdown·HTML | marked·sanitize-html → 실제 artifact / 현재 Word 본문 InsertFile / 새 Word 파일 | 실제 변환·비활성 HTML·독립 텍스트 해시 검사 계약. 원본 Tiptap 편집기 UI는 제외 |
| 전체 문서 롤백 | Word WordOpenXML / Excel SaveCopyAs / PPT SaveCopyAs → DPAPI 스냅샷 → 새 문서로 복원 → 파일 해시와 내용 재검사 | 네이티브 구현·컴파일. 기존 문서와 원본 파일 유지. 세션 종료 후 목록 재사용 없음; 모든 문서·VBA·고급 서식 보존 미검증 |
| 저장·파일 가져오기 | Windows 파일 선택 및 저장 창; private artifact ID와 실제 파일 해시 | 네이티브 구현·컴파일; 사용자 선택 외 임의 경로 조회 불가 |
| 품질 가이드·스타일 | 원본 시트/슬라이드 가이드, pptx-ops 작업 가이드와 스타일 템플릿 | 원본 해시 검증. 스타일 템플릿은 현재 작업창의 로컬 작업 폴더 |

## 문서 대상과 실행 결과

생성 위치가 애매한 요청은 현재 문서와 새 문서 중 선택한다. 현재 문서 선택은 기존 창에 적용한다. 새 파일을 열면 실제 새 문서에 실행 대상을 연결하고 새 작업창에 진행·승인·결과를 전달한다. 오래된 문서 관측값이나 다른 활성 창을 임의로 수정하지 않는다.

변경 전에 승인과 스냅샷을 거친다. 실패한 COM 쓰기는 자동 재실행하지 않는다. `0x80028018` 호출 전 실패는 입력 완료가 아니며, `0x800A03EC` 적용 여부가 불확실하면 부분 결과로 표시한다. 새 요청은 문서를 다시 읽고 계획한다. 문서 생성 성공과 이후 모델/렌더링 응답 실패는 별도 결과다.

복원은 현재 문서를 덮어쓰는 실행 취소가 아니다. 전체 스냅샷을 새 창에 연다. 암호화된 스냅샷 외 생성·가져오기·렌더링 파일은 `%LocalAppData%\OfficeX\Work`의 작업 폴더에 보관하며, 열려 있는 생성 파일을 보호하기 위해 자동 삭제하지 않는다. 사용자는 저장 창에서 결과를 최종 저장한다.

Claude 채팅 로그인은 이미지 생성용 인증이 아니다. 검색은 키 없는 원본 Parallel 경로와 DuckDuckGo fallback을 사용할 수 있고, 이미지 생성·분석은 별도 서비스를 연결한다. Genspark 계정·클라우드, 원본 Electron 편집기, Workspace A2A는 이번 배포에 활성화하지 않았다.

## Windows 검증

Windows 빌드와 설치·재설치·삭제는 CI에서 수행한다. 설치 폴더의 `Test-OfficeRuntime.ps1`은 Office PC에서 임시 문서의 입력·렌더링·스냅샷 복원을 실제 COM으로 검사한다. VSTO 창 표시와 실제 LLM 판단 품질은 별도 실환경 확인이 필요하다. 설치 성공이나 모의 테스트 결과를 실제 Office·모델 성공으로 합산하지 않는다.

타입 라이브러리 오류의 문화권 근거: [Microsoft 자동화 오류 안내](https://support.microsoft.com/id-id/help/320369/bug-old-format-or-invalid-type-library-error-when-automating-excel). Claude 실패 분류: [공식 구조화 응답 문서](https://code.claude.com/docs/en/agent-sdk/structured-outputs).

원본 엔진 회귀 검사: `npm run test:engines`. OOXML 스키마 검사는 xmllint가 필요하다. 원본 테스트는 원본 저장소의 node_modules 위치를 가정하므로 검사 스크립트가 개발 전용 의존성 링크를 만든다. 이 링크와 개발 의존성은 Windows 설치 파일에 포함하지 않는다.
