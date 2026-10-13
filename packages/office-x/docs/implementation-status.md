# 0.8.9 변경

ExcelWorksheetPaths는 Worksheets/Sheets.Name과 실제 컬렉션 핸들의 Name을 읽기/쓰기 전에 거절한다. Prepare가 배치 전체를 검증해 앞선 셀 쓰기 뒤에 이 오류가 발생하는 경로를 차단한다. Item(index/name)이나 Add에서 반환된 실제 Worksheet의 Name은 지원하며 임의의 Item(1)을 삽입하지 않는다. 실제 객체 핸들과 계획의 명시적 재연결을 구분한다.

ExcelWorksheets는 실제 Worksheet 목록과 핸들/스냅샷을 페이지로 읽고, 이름이 명시된 추가/변경 계획을 생성한다. 추가/변경은 기존 Worksheets와 차트를 포함한 Sheets 이름을 비교하고 중복 이름을 쓰기 전에 거절한다. 모든 기존 이름/개수 원본을 다시 확인하며 승인 후 개수/대상 이름/다른 시트 이름을 검증한다. 별도 새 통합문서를 만들지 않는다. 도구 자체의 최대 400개 시트/1000개 스냅샷 단계 제한을 넘으면 일반 Office 도구를 페이지로 사용한다.

Native COM fixture의 Sheets.Name 허용 오류를 제거했다. 엄격한 오류 재현, 늦은 컬렉션 Name 거절/쓰기 없음, 목록/추가/이름 변경, 첫 시트 보존과 명시적 핸들 재연결을 검증한다. Core 모의 포트는 차트 이름 중복, chart-only workbook, 페이지, 원본 변경, 실제 불일치와 재실행 방지도 검사한다. 기존 GenOffice 원본은 변경하지 않는다.

검증 결과와 Windows 설치 파일 정보는 빌드 후 기록한다. 실제 Windows Office 2016과 사용자 오류의 전체 호출 스택은 미관측이다.

배치 전 COM 멤버 검사: BeginPreflight/EndPreflight의 임시 핸들 집합으로 실제 객체와 읽기 단계의 반환 객체를 바인딩한다. GetIDsOfNames만으로 리프 멤버를 확인하고 타입 라이브러리/시험 쓰기를 사용하지 않는다. 임시 COM 참조는 성공/실패 모두 해제한다. 미래의 Add 반환 객체, 이미 쓴 뒤 존재할 인덱스, 미래 참조 인수는 정적 인수 검사만 수행하고 실제 실행/읽기 검사에서 확인한다. GetIDsOfNames는 해당 객체의 이름 존재를 확인하지만 모든 인수 시그니처나 보호/저장 상태를 증명하지 않는다.

OfficeGeometry는 Excel ColumnWidth 문자 단위 0..255, RowHeight 포인트 0..409와 PowerPoint AddTextbox의 다섯 인수/포인트 단위를 검사한다. format_cells가 실제 Range를 읽고 전체 열/행 범위를 요약해 dimension 체크와 Value2/Formula 보존 검사를 제출한다. excel_dimension은 명시적인 정책으로 최대 0.15 문자/0.5 포인트만 허용하며 실제/예상/비교 방식을 영수증에 남긴다. office_single은 기대값의 정확한 Single 표현만 인정하고 느슨한 epsilon을 사용하지 않는다. Count/텍스트/셀 값에는 두 비교 방식을 허용하지 않는다.

네이티브 모의 검사에 읽기로 생성되는 계획 핸들, 늦은 지원 불가 멤버, 문서 루트의 잘못된 ColumnWidth, Word/PPT 배치 사전 거절, PPT Single 폰트 크기를 추가했다. 실제 Office가 없는 CI이므로 전체 COM 모델과 사용자 환경의 쓰기/저장/연결 성공을 증명하지 않는다.
