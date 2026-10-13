# Nubi Office X 0.8.9 Beta 1

Excel, Word, PowerPoint의 쓰기 계획에 실제 COM 멤버 사전 검사를 추가했습니다. 현재 존재하는 객체와 읽기로 얻을 수 있는 계획 내 핸들은 GetIDsOfNames로 확인하며 타입 라이브러리를 불러오거나 시험 쓰기를 하지 않습니다. 뒤쪽의 지원하지 않는 멤버도 앞선 쓰기 전에 확인합니다. 아직 생성되지 않은 객체와 쓰기로 바뀔 인덱스는 생성 후 검증 대상입니다.

Worksheets.Name 오류 경로를 수정했습니다. Worksheets/Sheets는 시트 목록이며 Name은 개별 Worksheet에서 읽거나 변경해야 합니다. 컬렉션의 Name을 사용한 요청과 배치 중간의 잘못된 경로를 쓰기 전에 거절합니다. 어떤 시트를 의도했는지 임의로 판단해 첫 시트로 바꾸지 않습니다.

read_worksheets, add_worksheet, rename_worksheet를 연결했습니다. 실제 문서의 시트 이름과 핸들을 읽고, 한 시트를 추가하거나 관측한 이름의 시트를 변경합니다. 원본 확인, 승인, 실제 이름/개수 재조회, 다른 시트 이름 보존 검사를 수행합니다. 차트 시트의 이름과 충돌하는 새 이름도 쓰기 전에 확인합니다. 시트 목록 조회는 페이지 방식이며 큰 작업은 기존 Office 작업 도구를 계속 사용할 수 있습니다.

아직 쓰지 않은 Worksheets.Name 오류는 실제 시트 목록을 읽어 Agent에게 돌려줍니다. Agent가 대상을 확인하고 수정한 계획을 제출하며 이미 수행한 쓰기를 자동 반복하지 않습니다. 부분 변경이나 불확실한 결과는 복구 성공으로 바꾸지 않습니다.

기존 COM 모의 객체가 시트 목록의 Name을 잘못 허용해 이 오류를 놓쳤습니다. 이제 해당 호출을 실제 API처럼 거절하도록 수정하고 목록 조회, 새 시트 추가, 개별 시트 이름 변경과 읽기 검사를 추가했습니다. 이 검사는 설치된 실제 Office의 실행과 구분합니다.

format_cells에 열 너비와 행 높이를 연결했습니다. ColumnWidth는 0–255 문자 단위, RowHeight는 0–409 포인트로 쓰기 전에 검사합니다. 전체 열/행에 적용되는 범위를 승인 요약에 표시합니다. 서식 검사에는 제한된 반올림 허용 범위(0.15 문자/0.5 포인트)를 명시하며 셀 값과 수식은 그대로 확인합니다.

Excel의 Boolean과 Word/PowerPoint의 -1/0 강조 속성 차이도 읽기 검사에 반영했습니다. Word/PPT의 굵게 true를 실제 -1 반환값과 다르다고 판단해 작업을 중단하던 경로를 방지합니다. 좌표/폰트의 Single 비교와 열/행 반올림 방식은 해당 앱의 알려진 속성에서 자동 반영하고 승인 계획과 영수증에 남깁니다. Count, 셀 값, 텍스트는 이 변환의 대상이 아닙니다.

PowerPoint AddTextbox의 다섯 인수와 포인트 단위를 먼저 검사합니다. 좌표와 폰트 크기의 Single 반올림을 정확히 비교하는 검사 옵션을 추가했습니다. Excel Font.Color와 PowerPoint Font.Color.RGB의 객체 차이, Word Range의 위치 인수도 모델 가이드에 반영했습니다.

0.8.8의 Count, Item 인자와 셀 서식 수정은 유지합니다. 별도 편집기, 새 대화/히스토리, 이미지 기능은 포함하지 않습니다. Excel, Word, PowerPoint를 모두 종료한 뒤 설치하세요. 실제 Office 2016 환경에는 접근할 수 없어 그 환경의 정상 완료는 직접 확인하지 못했습니다.

참고: [Worksheet.Name](https://learn.microsoft.com/en-us/office/vba/api/excel.worksheet.name), [Worksheets.Item](https://learn.microsoft.com/en-us/office/vba/api/excel.worksheets.item).

참고: [Excel 열 너비](https://learn.microsoft.com/en-us/office/vba/api/excel.range.columnwidth), [Excel 한도](https://support.microsoft.com/en-us/excel/excel-specifications-and-limits), [PowerPoint AddTextbox](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.shapes.addtextbox), [PowerPoint Font.Size](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.font.size).

반환 타입 참고: [Word Font.Bold](https://learn.microsoft.com/en-us/office/vba/api/word.font.bold), [PowerPoint Font.Bold](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.font.bold).

[Windows 빌드와 검사](https://github.com/plaire48/llm-router/actions/runs/38414913230) 통과: 소스 127개, 코어 132개, x86/x64 네이티브 COM 모의 검사, 설치된 세 앱 채팅창 클릭/입력 검사. Office가 없는 Windows VM에서 설치 9.4초, 재설치 5.37초입니다. 실제 Office 내부 쓰기/저장 검증은 아닙니다.

실제 macOS Claude 연결과 GenOffice AgentLoop에서 시트 목록 조회, 지정한 두 번째 시트만 이름 변경, A1 값 42, 표시 형식 0.00, 열 너비/행 높이 적용과 최종 응답 전달을 모의 Excel로 확인했습니다.

설치 파일 SHA-256: 8d3f67338e095c24ae6b05643ee90a9cb665766883a44ca68f9a4c7ce093a0d0. 124611536바이트. 소스 파일 5489개, GenOffice 4582개와 누비 88개 원본 및 제품/테스트 소스 63개 해시를 대조했습니다. 상세 범위는 release-0.8.9.json을 참고하세요.
