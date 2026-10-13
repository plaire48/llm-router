# 0.8.4 변경

기존 native Core에 Excel 줄바꿈·탭 및 행별 열 수 차이 재현 테스트를 추가했을 때 두 사례가 document_content_invalid로 실패했다. 수정 후 문자 내용을 보존하고 부족한 뒷칸만 빈 문자열로 채운 내부 사본을 승인·생성·읽기 검증에 사용한다. 200행·20열, 셀 2000자, 시트 5개 및 전체 100000자 제한은 유지한다. 크거나 복잡한 내용은 작은 초기 문서를 만든 뒤 별도 Office 작업으로 이어서 작성할 수 있다.

검증 오류는 문서 내용 대신 inputPath/inputRule만 반환하며 invocationStarted=false다. 잘못된 이름과 중복 이름, 제어 문자, 차원 제한은 그대로 거절한다. 입력 오류 때문에 기존 문서가 변경됐다고 보고하지 않는다. Word 표 스키마는 네이티브와 같은 50행·10열로 안내한다.

CheckpointNow는 이미 만든 사본으로 상태 해시를 계산한다. 별도 State() 사본 호출을 반복하지 않는다. SaveCopyAs를 Office가 거절하면 PrepareCheckpoint는 available=false와 멤버/HRESULT를 반환한다. execute_office_operations는 이 정보를 기존 승인 폼에 전달한다. 사용자는 적용 안 함 또는 복원 사본 없이 적용을 선택한다. 적용 후 원본 비교·독립 읽기 검증과 불확실한 쓰기 재실행 차단은 유지한다. 성공 영수증에도 checkpoint.available=false를 남긴다. 전체 롤백이 생겼다고 주장하지 않는다. 직접 사본 내보내기/GenOffice 파일 변환은 완전한 사본이 필요한 경우 실패를 그대로 반환한다.

상단 누비 Agent 텍스트는 UI에서 제거했으며 누비 원본 파일은 변경하지 않았다. 모델/복원 버튼 및 네이티브 리본을 유지한다.

Windows C++ COM 회귀는 실패하는 타입 라이브러리를 가진 테스트 객체에서 줄바꿈 셀·빈 뒷칸·SaveCopyAs 0x800A03EC 거절 이후 명시적 승인에 따른 값 입력과 읽기 검증을 수행한다. 실제 Office 2016/VSTO 문서와 사용자 Windows 모델 연결은 미검증이다.
