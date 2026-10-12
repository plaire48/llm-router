# GenOffice 기능 대응 — 0.5.0

기준: genspark-ai/genoffice, commit 438d9c65709952490c970beaa2599ef45e74431f. 동일 커밋의 apps/docs, apps/sheets, apps/slides AI tools와 packages/cli를 직접 대조했다.

## 기능을 막던 구조

0.4의 도구는 Excel 빈 셀 곱셈과 Word/PPT 단순 문단 교체에 한정됐다. 원본 AgentLoop 도입은 원본 문서 도구 전체 도입이 아니었다. 0.5는 임의의 기능별 허용 목록을 추가하는 대신, 고정된 현재 문서의 Office Object Model을 구조화한 get/set/call 실행기로 연결한다. 일반 셀, 문단, 표, 슬라이드 기능은 선택 영역, 빈 셀, 글꼴 혼합, 자동 크기 여부로 차단하지 않는다.

| 원본 작업군 | Office X 실행 경로 | 증거 상태 |
| --- | --- | --- |
| 문서/시트/슬라이드 문맥 읽기와 범위 탐색 | inspect_office에서 Document/Workbook/Presentation과 하위 개체 읽기 | 모의 실행 계약 테스트, 네이티브 호스트 컴파일 |
| 값/일반 수식, 표/피벗/차트, 필터/유효성/조건부 서식 | execute_office_operations → Excel Object Model | 호출 경로와 가이드 구현; 각 개체별 실제 Office 실행은 미검증 |
| 문단/런/표/스타일/목록/주석/필드/개정/머리말/꼬리말 | 같은 실행기 → Word Object Model | 호출 경로와 가이드 구현; 개체별 실제 실행 미검증 |
| 슬라이드/도형/텍스트/표/차트/정렬/그룹/노트 | 같은 실행기 → PowerPoint Object Model | 호출 경로와 가이드 구현; 개체별 실제 실행 미검증 |
| 새 문서와 발표자료 작성 | create_document → Documents.Add/Presentations.Add/Workbooks.Add 및 실제 내용 재조회 | 계획·스키마·재조회 계약 테스트; 실제 COM 미검증 |
| 저장과 PDF 출력 | save_document → Windows 저장 창과 Office SaveAs/ExportAsFixedFormat | 구현·컴파일; 실제 저장/재열기 미검증 |
| Agent 실행, 취소, 압축, 도구 유효성, 응답 검증 | 원본 GenOffice AgentLoop와 composeSkills | 원본 소스 유지, 실제 루프의 모의 모델 테스트 |
| 시트 디자인/작업 가이드, 슬라이드 품질 가이드 | load_office_guide가 원본 14개 문서를 제공; COM용 가이드 3개 추가 | 원본 해시 검증. 원본의 도구 이름은 COM 호출로 해석해야 함 |
| 원본 generate_deck/regenerate_slide의 전체 작성·렌더링 파이프라인 | 아직 직접 이식하지 않음; 현재는 모델이 내용을 작성하고 Office가 생성 | 완전한 기능 동등성을 주장하지 않음 |
| 웹 검색, 이미지 검색/생성, 미디어 분석 | 아직 서비스/원본 스킬 연결 안 됨 | 미구현 |
| PDF/Markdown/HTML 별도 편집기·변환 | 아직 Office 추가 기능에 연결 안 됨 | 미구현 |
| 원본 전체 스냅샷 롤백 | 아직 동일 기능 없음 | 미구현; Office 고유 실행 취소와도 동등성을 주장하지 않음 |

## 실행 계약

모든 변경안은 네이티브가 소유한 읽기 관측값에 연결한다. 승인 전에 내용과 작업 요약을 보여주며, 승인 시 원문 재확인과 변경 후 독립 조회를 수행한다. 검증 성공 뒤 새 관측값으로 후속 작업할 수 있다. 거절·취소·충돌·부분 실패 이후 자동 재실행하지 않는다. 실행 결과가 없으면 완료로 표현하지 않는다.

실행 대상은 현재 문서에서 얻은 COM 참조다. 셸·VBA·매크로 실행과 Application/Parent 우회는 노출하지 않는다. 저장은 경로를 사용자가 정하는 전용 도구를 사용한다. 실제 Office가 반환하는 문서 보호·잠금·지원되지 않는 API는 그대로 처리한다. 조회 페이지와 한 번의 전송량에는 실행 안정성을 위한 크기 한도가 있으며 더 큰 작업은 나누어 처리한다.

혼합 서식 문장 교체는 공통 앞뒤 문자열을 보존하고 바뀐 부분만 교체한다. 새 텍스트는 주변 서식을 따른다. 변경한 문자열의 모든 글자별 서식이 이전과 동일하다는 보장은 하지 않는다. 복잡한 개체는 공통 도구가 해당 구조를 직접 읽고 수정한다.

## Windows 검증

설치 빌드와 설치/재설치/삭제는 CI에서 수행한다. 실제 Office가 설치된 PC에서는 설치 폴더의 Test-OfficeRuntime.ps1으로 세 앱의 COM 실행을 검증할 수 있다. 이 스크립트는 새 임시 문서만 생성하고 저장하지 않고 닫으며, native-runtime JSON에 앱별 실제 결과를 기록한다. 실제 모델 판단 품질, VSTO 작업창 로드, 모든 Office 개체의 성공을 대신 증명하지 않는다.

참고: [Word Documents.Add](https://learn.microsoft.com/en-us/office/vba/api/word.documents.add), [PowerPoint Slides.Add](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.slides.add), [TextRange.Characters](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.textrange.characters), [Excel Workbooks.Add](https://learn.microsoft.com/en-us/office/vba/api/excel.workbooks.add).
