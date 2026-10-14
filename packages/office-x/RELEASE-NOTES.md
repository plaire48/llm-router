# Nubi Office X 0.8.13 Beta 1

Windows Office 2016의 수식·문서 창·결과 검증에 맞춰 GenOffice 연결부를 수정했습니다.

- 새 Excel 문서를 만든 뒤 전체 입력 범위를 텍스트 형식으로 남기던 문제를 수정했습니다. 기존 문자열·앞자리 0은 그대로 유지하고 이후 입력하는 수식은 계산할 수 있습니다.
- `set_formula`는 텍스트 형식인 대상 셀만 일반 형식으로 전환한 뒤 실제 Formula·HasFormula·서식을 읽어 검증합니다. 숫자·통화·백분율 서식은 유지합니다. 새 문서의 숫자와 수식은 각각 전용 도구로 넣도록 Agent 지침을 보강했습니다.
- PowerPoint와 Word의 창 바인딩은 Office 2016 Interop의 창 인터페이스를 사용합니다. PowerPoint의 숨겨진 HWND 멤버 이름 조회 실패를 재현하고 수정했습니다. 문서와 창의 일치 검증은 유지합니다.
- GenOffice PPTX 텍스트 필드 경로를 수정해 실제 슬라이드 텍스트와 Windows Office 결과를 비교합니다.
- Word·PowerPoint에서 호출 전에 거부된 멤버·인수 오류는 실제 문서 구조와 새 snapshot을 다시 읽고 네이티브 가이드로 다른 계획을 수립합니다. 부분·불명확한 변경은 재실행하지 않습니다. 복구는 횟수를 제한합니다.
- 오류 정보의 버전이 0.8.11로 고정돼 있던 문제를 수정했습니다. Markdown 내보내기와 변환 엔진의 필요 시 준비 방식을 유지합니다.

Windows 소스 테스트 153개, 코어 테스트 134개, 32·64비트 COM 테스트와 실제 WebView2 클릭·입력을 통과했습니다. 설치 9.33초, 재설치 6.29초, 제거 1.71초를 확인했으며 설치된 변환 엔진의 최초 준비·문서 변환·한국어 OCR도 통과했습니다. 27개 Word·PowerPoint 멤버와 인수 조합을 Office 15 Interop의 Office 2016 호환 API 기준에 대조했습니다. 이 검증은 실제 Office 2016 및 실계정 Claude/ChatGPT 연결 검증을 대신하지 않습니다. 현재 실제 Office 호스트는 연결되지 않았습니다.

[Windows 빌드와 검증](https://github.com/plaire48/llm-router/actions/runs/38489644724)
