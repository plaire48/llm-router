# 0.8.2 변경

Excel 새 문서 작성, 셀 입력과 검증, 암호화 체크포인트, 파일 열기 및 저장을 타입 라이브러리 없이 호출하도록 수정했다. OfficeAutomationPort의 큰 정수는 int 범위 안에서만 int로 변환하고 그 밖에는 Excel의 숫자 표현인 double로 전달한다.

Windows 전용 C++ IDispatch 객체는 GetTypeInfo를 TYPE_E_INVDATAREAD로 실패시키면서 Excel 모양의 Workbooks, Worksheets, Range, Value2, SAFEARRAY, SaveCopyAs를 구현한다. 기존 동적 호출은 실패했으며, 수정된 호스트를 32비트 및 64비트로 검사한다. 설치된 Excel의 실제 동작을 대신하는 증거는 아니다.

작성 결과는 독립적인 읽기 확인을 통과해야 verified가 된다. 셀 쓰기 횟수와 불확실한 결과 구분을 유지한다. Core 일반 예외도 실패한 멤버·단계·HRESULT·예외 유형을 보존한다. 반복 중단 제한을 완화하거나 확인되지 않은 쓰기를 성공으로 표시하지 않는다.
