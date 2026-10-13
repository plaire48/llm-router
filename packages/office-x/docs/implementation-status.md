# 0.8.6 변경

계산은 calculate_office의 고정된 Calculate 메서드 호출과 CalculationState 확인으로 처리한다. inspect_office에 잘못 섞인 Calculate는 앞선 객체 읽기, 고정 계산 호출, 계산 후 전체 읽기로 분리한다. 계산 실패/대기 결과는 재호출하거나 성공 스냅샷으로 만들지 않는다. calculate_and_read는 bound document의 활성/이름 지정 시트와 최대 101x20 범위를 조회한다. 새 문서 이후 legacy ExcelPort로 돌아가지 않는다.

ExcelRangeTools는 Range의 병합/해제를 같은 OfficeAutomationSession 승인·원본 비교·읽기 검증으로 연결한다. 좌상단 외 값/수식 손실을 사전에 거절한다. 일반 도구의 선호출 실패 후 확인된 셀 수정은 공통 실행별 영수증 상태로 최종 응답 검증을 통과한다. 이후 실패/불확실한 변경은 이전 성공으로 덮지 않는다.

OfficeArguments는 reference/ref 네이티브 핸들, scalar, rectangular matrix, missing optional arguments를 변환한다. Wire.Parse/Clone은 ISO 날짜 텍스트를 유지한다. inputPath/inputRule/InvocationStarted가 영수증까지 전달된다. 악성 코드 실행, Application/Parent와 파일 멤버 우회, 불확실한 쓰기 재실행은 허용하지 않는다.

snapshot_required는 무수정 선호출 실패인 경우에만 실제 원본을 다시 읽는다. 반환된 새 ID와 원본은 수정 완료가 아니며 모델의 수정안 재제출과 승인이 필요하다. GenOffice 파일/렌더 연결은 native failure를 다음 단계 실행 전에 보존해 보고한다.

작업창 제목 두 생성 위치 모두 String.Empty를 사용하고 WebView 안 아이콘 옆 브랜드는 유지한다. 실제 Office 작업창의 시각 결과는 미검증이다.

실제 Windows Office 2016/Windows 모델 계정은 미검증이다. 네이티브 COM 테스트 객체와 실제 설치/WinForms WebView2 검증은 별도 범위다.
