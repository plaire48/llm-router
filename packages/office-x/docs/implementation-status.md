# 0.8.8 변경

OfficeCountChecks는 Count의 숫자 기대값과 delta를 검증한다. delta는 같은 대상/멤버/인자의 Count가 포함된 네이티브 snapshot에서만 정수 기대값으로 변환한다. 승인 화면과 실행은 변환된 동일한 기대값을 사용하며, 쓰기 후 관측값을 기대값으로 대체하지 않는다. 최초 시트 수 1과 3의 추가와 값 입력, 다중 Add의 Count 인자, 검증안 오류의 쓰기 전 거절/수정, source drift, 실제 불일치와 재실행 방지를 검사한다.

관측한 document.Worksheets/Sheets 핸들의 Count는 해당 핸들의 직접 Add와 setter만 있는 경우에 한해 예상 총개수를 사전 검증한다. 임의 구조 변경 호출, 핸들 재지정, 관측하지 않은 대상의 절대 개수는 추측하지 않는다. readback은 불일치가 나도 이후 읽기 검사를 수행하고 모든 완료한 검사 결과를 receipt에 보관한다. 읽기 자체가 실패하거나 취소되면 그 시점에서 멈춘다. 실제 불일치는 partial이며 다시 쓰기를 허용하지 않는다.

Office skill의 도구 스키마와 안내는 equals 또는 Count 전용 delta를 지원한다. 쓰기 전 개수 오류는 native 상태를 읽고 계획을 수정한다. UI에는 안전한 정수 Count 정보만 표시/복사하며 다른 검사에 포함된 문서 내용을 오류 요약에 포함하지 않는다.

실제 Windows Office 2016과 사용자 오류의 기대값/실제값은 미관측이다. 설치, WinForms WebView2, Core 모의 포트, 네이티브 IDispatch fixture, 실제 모델 연결 검증은 각각 별도 범위다.

배치 전체 단계와 checks의 인자 구조/Item 선택자/명시적 indexed path/대상 핸들을 승인 전에 검사한다. 이후 단계의 Item 누락으로 앞선 셀 쓰기가 partial이 되는 경로를 차단한다. 실제 COM 객체 해석과 반환 객체 종류, 새 핸들 유효성은 실행 중 확인하며 임의의 인덱스를 보충하지 않는다. 공통 receipt 추적은 후속 쓰기 차단 시 첫 실패의 멤버, 코드, 안전한 Count 결과를 유지한다.

format_cells는 주소와 선택적 시트 이름으로 실제 Range를 재조회하고 NumberFormat/Font.Bold/WrapText를 검증한다. 같은 승인/원본 비교/receipt 경로를 사용하며 서식 후 Value2와 Formula 보존을 함께 검사한다. 범위는 공통 읽기 제한 101행/20열로 나누고 다른 고급 서식은 inspect_office/execute_office_operations로 계속 제공한다.
