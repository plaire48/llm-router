# Nubi Office X 0.8.6 Beta 1

`office_read_requires_get Calculate` 경로를 수정했습니다. 읽기 요청에 잘못 섞인 Calculate는 고정된 네이티브 계산 호출로 분리하고 계산 후 실제 Value2/Formula를 다시 읽습니다. calculate_and_read도 최초 선택 창 대신 현재 연결된 통합문서를 사용하며 새 문서 생성 이후에 동작합니다. 계산 상태가 완료되지 않았으면 완료로 보고하지 않습니다.

`Merge`가 Workbook/Worksheet에 호출되는 문제를 줄이도록 merge_cells를 추가했습니다. 실제 Range의 Merge/UnMerge를 승인·원본 비교·병합 상태와 좌상단 데이터 읽기 검증에 연결합니다. 좌상단 외 데이터가 있는 범위는 내용을 보존한 뒤 병합하도록 알려줍니다.

실제 읽기 결과의 `{reference: ...}`를 쓰기 인자가 받지 못하던 문제와 ISO 날짜 문자열이 날짜 객체로 바뀌어 거절되던 문제를 수정했습니다. 잘못된 핸들과 비직사각 배열은 호출 전에 정확한 위치를 반환합니다. 이 인자 처리 수정은 Excel·Word·PowerPoint 공통입니다.

누락·만료·다른 읽기 도구의 snapshotId는 실제 원본을 다시 읽어 새 식별자를 반환합니다. 모델이 원본을 검토하고 수정안을 재제출하며 부분적·불확실한 쓰기를 재실행하지 않습니다. 일반 도구 오류 뒤 셀 도구로 수정이 확인되었는데도 완료 응답이 막히던 상태를 연결했습니다.

사본 내보내기나 렌더 실패가 뒤 단계의 빈 경로 오류로 바뀌어 genoffice_tool_failed로 표시되던 경로를 수정했습니다. 실제 네이티브 오류·멤버·코드를 보존하고 후속 파일 엔진 실행을 중단합니다. SaveCopyAs 거절 원인 자체가 모든 사용자 환경에서 해결되었다는 의미는 아닙니다.

세 앱의 웹 화면 위 Office 작업창 제목 글자만 제거하고 아이콘 옆 누비 Agent 표기는 복원했습니다. 별도 GenOffice 편집기·새 대화/히스토리·이미지 기능은 제외합니다.

Office 앱을 모두 종료한 뒤 EXE를 실행하세요. Windows 빌드·COM 테스트 객체·설치된 WebView2 검증과 실제 Office 2016 검증은 별개입니다. 연결 가능한 실제 Windows Office 환경이 없어 사용자 문서 작성/저장과 Windows Claude/ChatGPT 계정은 직접 검증하지 못했습니다.

참고: [Microsoft Range.Calculate](https://learn.microsoft.com/en-us/office/vba/api/excel.range.calculate), [Range.Merge](https://learn.microsoft.com/en-us/office/vba/api/excel.range.merge), [VSTO 작업창 제목](https://learn.microsoft.com/en-us/dotnet/api/microsoft.office.tools.customtaskpanecollection.add?view=vsto-2022).
