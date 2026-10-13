# Nubi Office X 0.8.8 Beta 1

Excel의 Count 검증을 실제로 읽은 기존 시트 수 기준으로 보완했습니다. 시트를 하나 추가하면 추가한 개수 1이 아니라 기존 전체 개수에 1을 더해 확인합니다. Agent는 관측한 Count와 추가할 개수(delta)를 사용하고 셀 값, 수식, 시트 이름은 별도로 확인합니다. Range.Count는 빈 셀까지 포함하는 범위의 셀 수이며 입력된 값의 수가 아닙니다.

배치 중간이나 결과 검사에 있는 Item 인자 누락, 명시적 시트/범위 경로의 선택자 누락, 잘못된 배열 구조와 알려지지 않은 대상을 승인 전에 검사합니다. 앞부분 셀 입력 뒤에 인자 오류가 발생해 후속 작업이 막히는 경로를 줄였습니다. 인덱스와 주소를 임의로 보충하지 않습니다.

관측한 Worksheets/Sheets의 Count와 직접 Add 호출로 결과를 확정할 수 있는 계획은 예상 개수를 쓰기 전에 검증합니다. 잘못된 예상값은 아직 변경하지 않은 상태에서 Agent가 다시 읽고 수정하도록 반환합니다. 일반적인 구조 변경의 결과는 추측하지 않고 실제 쓰기 후 확인합니다. 문자열이나 소수 형태의 개수 검증은 쓰기 전에 거절합니다.

쓰기가 완료된 뒤 Count 비교가 다르면 나머지 내용 검사도 읽어 결과를 보관합니다. 오류 정보에는 예상 개수와 실제 개수를 표시하며 복사되는 오류 요약에 셀 내용은 넣지 않습니다. 실제 검증 불일치를 성공으로 바꾸거나 이미 수행한 Add/쓰기 작업을 자동 반복하지 않습니다.

`writes_stopped_for_this_run`이 뒤따르면 앞선 실패의 종류와 Count 기대값/실제값을 유지합니다. 후속 차단 오류로 첫 원인이 덮이지 않도록 했습니다. 새로운 사용자 요청은 현재 문서를 다시 읽어 시작하며 같은 실행의 불확실한 쓰기를 자동 반복하지 않습니다.

NumberFormat 대상 연결 오류를 줄이기 위해 셀 주소와 시트 이름으로 실제 범위를 호스트가 찾는 format_cells를 연결했습니다. 표시 형식, 굵게, 줄 바꿈을 적용하고 기존 값/수식이 그대로인지 확인합니다. 다른 고급 서식과 GenOffice 도구도 계속 사용할 수 있습니다.

0.8.7의 작업창 열기 호환 처리는 유지합니다. 별도 GenOffice 편집기, 새 대화/히스토리, 이미지 기능은 포함하지 않습니다. Office 앱을 모두 종료한 뒤 설치하세요.

실제 사용자 환경의 오류 상세와 실제 Windows Office 2016에는 접근할 수 없어 이번 신고가 잘못된 Count 예상값 때문인지는 확정하지 못했습니다. Windows COM 모의 실행과 실제 Office의 동작은 구분합니다.

참고: [Excel Worksheets.Add 인자](https://learn.microsoft.com/en-us/office/vba/api/excel.worksheets.add), [Range.Count](https://learn.microsoft.com/en-us/office/vba/api/excel.range.count).

[Windows 빌드와 검사](https://github.com/plaire48/llm-router/actions/runs/38405564386) 통과: 소스 123개, 코어 118개, x86/x64 네이티브 COM 모의 검사, 설치된 WinForms WebView2의 세 앱 클릭/입력 검사. Office가 없는 Windows VM에서 설치 12.97초, 재설치 8.48초입니다. 실제 Office 내부의 셀 쓰기/저장 검증은 아닙니다.

실제 macOS Claude 연결과 GenOffice AgentLoop에서 모의 Excel 시트 3개 조회, 개수 오류 계획 수정, 시트 하나 추가, A1 값 42, format_cells 표시 형식 0.00 적용, 최종 응답 전달을 확인했습니다. Windows Claude나 실제 Office의 검증과는 구분합니다.

설치 파일 SHA-256: 1b039729252aaf7425928a4522896d727cec45d6b3635d64062a951e5d7d8d0a. 124601888바이트, 소스 5475개 파일입니다. GenOffice 4582개와 누비 88개 원본, 변경된 제품/테스트 소스 60개 해시를 대조했습니다. 상세 범위는 release-0.8.8.json을 참고하세요.
