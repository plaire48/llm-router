# 0.8.5 변경

일반 Excel 셀 요청은 ExcelCellWrites를 통해 OfficeAutomationSession의 동일한 승인·대상 셀 원본 비교·읽기 검증에 연결된다. 기존 ExcelSession 곱셈 데모 경로는 테스트/데모에만 남는다. set_formula는 일반 수식을 지원하고 write_cells는 기존 셀·선택 외 대상도 지원한다. 문자열의 NumberFormat을 일시적으로 @로 설정한 뒤 복원하며 HasFormula=false와 Value2를 확인한다. 수식은 Formula/HasFormula를 검사하고 큰따옴표 리터럴의 대소문자를 보존해 함수 이름 표기 차이를 비교한다. 계산 결과 정확성은 이 검사와 별도다.

RequestCheckpoint는 SaveCopyAs 실패를 status=unavailable 경고로 전달한다. 동일 문서/실행 실패는 캐시하고 Begin 및 Rebind 시 초기화한다. 백업 없음은 승인 폼과 영수증에 노출한다. 새 문서 creation의 current/new 불일치는 작성 위치 선택으로 해소한다. 생성 성공 후 런타임 context.documentId/documentTarget을 갱신한다. 기존 선택 경로는 생성 이후 사용하지 않고 새 문서 Office 도구를 사용한다.

모델 연결에서는 안전한 원인 코드가 UI까지 전달된다. 보관한 인증 복원의 임시 실패는 새 OAuth를 시작하지 않으며 토큰 갱신을 포함하는 ChatGPT 복원 전체를 재시도하지 않는다. 재시도는 모델 목록 GET 조회에 한정한다. 자동 로그인은 유지하지 않는다. 조용한 모델 목록 갱신 실패는 전역 연결 실패로 표시하지 않는다.

실제 Windows Office 2016/Windows 모델 계정은 미검증이다. 네이티브 COM 테스트 객체와 실제 설치/WinForms WebView2 검증은 별도 범위다.
