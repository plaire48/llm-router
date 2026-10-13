# Nubi Office X 0.8.6 Beta 1

`office_read_requires_get Calculate` 경로를 수정했습니다. 읽기 요청에 잘못 섞인 Calculate는 고정된 네이티브 계산 호출로 분리하고 계산 후 실제 Value2/Formula를 다시 읽습니다. calculate_and_read도 최초 선택 창 대신 현재 연결된 통합문서를 사용하며 새 문서 생성 이후에 동작합니다. 계산 상태가 완료되지 않았으면 완료로 보고하지 않습니다.

`Worksheets.Item.Range`를 객체 이름으로만 찾거나 Item/Range 선택 인자를 전달하지 못하던 경로를 수정했습니다. 시트 번호/이름과 셀 주소를 명시한 경로를 현재 통합문서에 연결하며, 인자가 없으면 임의로 추측하지 않습니다. 새 read_cells는 현재 연결 문서의 실제 셀 값·수식·네이티브 핸들을 반환합니다. Item의 인자가 없거나 missing/null이면 COM 호출 전에 명확히 거절합니다. 무수정 선호출 Item 0x8002000E·대상 오류는 실제 셀을 새로 읽고 수정안 재제출로 연결하며 잘못된 호출을 그대로 반복하지 않습니다.

`Merge`가 Workbook/Worksheet에 호출되는 문제를 줄이도록 merge_cells를 추가했습니다. 실제 Range의 Merge/UnMerge를 승인·원본 비교·병합 상태와 좌상단 데이터 읽기 검증에 연결합니다. 좌상단 외 데이터가 있는 범위는 내용을 보존한 뒤 병합하도록 알려줍니다.

실제 읽기 결과의 `{reference: ...}`를 쓰기 인자가 받지 못하던 문제와 ISO 날짜 문자열이 날짜 객체로 바뀌어 거절되던 문제를 수정했습니다. 잘못된 핸들과 비직사각 배열은 호출 전에 정확한 위치를 반환합니다. 이 인자 처리 수정은 Excel·Word·PowerPoint 공통입니다.

누락·만료·다른 읽기 도구의 snapshotId는 실제 원본을 다시 읽어 새 식별자를 반환합니다. 모델이 원본을 검토하고 수정안을 재제출하며 부분적·불확실한 쓰기를 재실행하지 않습니다. 일반 도구 오류 뒤 셀 도구로 수정이 확인되었는데도 완료 응답이 막히던 상태를 연결했습니다.

사본 내보내기나 렌더 실패가 뒤 단계의 빈 경로 오류로 바뀌어 genoffice_tool_failed로 표시되던 경로를 수정했습니다. 실제 네이티브 오류·멤버·코드를 보존하고 후속 파일 엔진 실행을 중단합니다. SaveCopyAs 거절 원인 자체가 모든 사용자 환경에서 해결되었다는 의미는 아닙니다.

세 앱의 웹 화면 위 Office 작업창 제목 글자만 제거하고 아이콘 옆 누비 Agent 표기는 복원했습니다. 별도 GenOffice 편집기·새 대화/히스토리·이미지 기능은 제외합니다.

Office 앱을 모두 종료한 뒤 EXE를 실행하세요. Windows 빌드·COM 테스트 객체·설치된 WebView2 검증과 실제 Office 2016 검증은 별개입니다. 연결 가능한 실제 Windows Office 환경이 없어 사용자 문서 작성/저장과 Windows Claude/ChatGPT 계정은 직접 검증하지 못했습니다.

참고: [Microsoft Range.Calculate](https://learn.microsoft.com/en-us/office/vba/api/excel.range.calculate), [Range.Merge](https://learn.microsoft.com/en-us/office/vba/api/excel.range.merge), [VSTO 작업창 제목](https://learn.microsoft.com/en-us/dotnet/api/microsoft.office.tools.customtaskpanecollection.add?view=vsto-2022).

[Windows 빌드 및 검사](https://github.com/plaire48/llm-router/actions/runs/38396459415)를 통과했습니다. 최종 커밋 d4280b9053b44a992d5fb388c4706984e489df86의 Windows 소스 115개, 네이티브 코어 99개, x86/x64 COM 회귀와 설치된 WebView2 세 앱 클릭·입력 검사를 통과했습니다. Office 없는 Windows VM에서 설치 8.37초, 재설치 5.93초입니다.

동일 후보의 실제 macOS Claude는 모의 Item 0x8002000E 오류 뒤 실제 모의 원본을 다시 읽고 수정안 제출 후 최종 응답을 완료했습니다. 셀 읽기·문자/숫자·수식·병합·계산 결과 읽기 흐름도 완료했습니다. Office 동작은 모의 객체였으며 실제 Windows Office와 계정 실행 증거가 아닙니다.

EXE SHA-256: a0600122c888b7113ec4c7ee6812a956511feb935507cc2f8cf96d0ee88b8da1. 설치 파일 124589800바이트, 소스 ZIP 5463개 파일입니다. GenOffice 4582개·누비 88개 원본과 변경 소스 61개의 해시를 대조했습니다. 범위와 한계는 첨부 release-0.8.6.json을 참고하세요.
