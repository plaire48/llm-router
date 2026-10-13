# Nubi Office X 0.8.3 Beta 1

`office_read_requires_get`와 `office_member_path_not_supported`를 일으키던 문서 호출 처리를 수정했습니다. `Font.Bold`, `Interior.Color`, `TextFrame.TextRange.Text`는 중간 개체를 조회한 뒤 마지막 속성에 접근합니다. `call`로 전달된 알려진 읽기 속성은 getter로 처리하며 변경 작업은 읽기 도구에서 실행하지 않습니다.

Word·PowerPoint 새 문서 생성·내용 확인·창 활성화를 직접 IDispatch로 변경했습니다. 새 문서의 실제 COM 식별자와 활성 창을 확인한 뒤 연결을 교체합니다. 문서 생성 성공과 후속 연결·응답 실패는 별도로 표시합니다.

시작 시 자동 로그인하지 않습니다. Agent가 준비되면 로그인 버튼이 활성화되고 사용자가 눌렀을 때만 저장된 연결을 복원합니다. 모델 목록과 연결이 준비되면 보내기를 사용할 수 있습니다.

Claude의 JSON 결과 형식을 처리하고 응답 형식 실패는 한 번 복구합니다. 이미 검증된 문서 작업 이후에는 도구 없이 결과 안내만 복구하므로 쓰기를 재실행하지 않습니다. 실패한 멤버·HRESULT는 실행 오류 정보에 바로 표시하며 복사할 수 있습니다.

새 대화·히스토리·이미지 도구와 별도 GenOffice 편집기는 포함하지 않습니다. 기존 GenOffice 문서 기능과 누비 모델 UI를 유지합니다.

Office 앱을 모두 종료하고 EXE를 실행하세요. Windows 네이티브 COM 테스트 객체와 채팅창 검사 결과는 실제 Office 2016 또는 사용자 Claude 계정 검증을 대신하지 않습니다. 실제 Windows Office 환경은 현재 연결할 수 없어 해당 검증은 미완료입니다.
