# 누비 Workspace 배포 전 품질 점검

범위는 Desktop의 기존 기능과 VOC 보관/검색, Windows 창 관찰/동작이다. JSM 실계정 수집, 실제 모델 정확도와 사용자 Windows 11 환경을 검증한 것은 아니다. A2A는 비활성화하고 실행 번들에서 제외했다. 브라우저 중심 JSM 수집은 [설계안](JSM-VOC-WORKSPACE.md) 단계다.

## 수정

- VOC 본문 한 줄이 16K 문자를 넘으면 읽기가 실패했다. 줄/문자 위치 커서로 이어 읽으며 한국어와 이모지 원문을 빠짐없이 복원한다.
- Windows UIA의 목록은 AutomationId, 개별 속성은 semantic selector를 반환할 수 있다. 동일 요소의 명시적인 alias만 연결하고 다른 요소/불일치 응답은 거부한다. 입력값 조회와 요소 캡처도 확인한 selector를 사용한다.
- 캡처 파일은 경로 문자열의 철자 대신 실제 파일 경로를 대조한다. Windows의 짧은 경로 확장을 수용하면서 다른 파일을 반환하는 오류는 거부한다.
- 실제 Windows 검사에 대상 검색, 검색 결과 없음, 버튼 실행 후 값 확인을 추가했다. 설치 앱의 worker에서 VOC 저장/중복 방지/검색/긴 본문 읽기를 확인하고, 재설치 후에도 앱을 다시 실행한다.

## 방법론과 오픈소스

[OpenCode의 검색과 구간 읽기](https://opencode.ai/docs/tools/)를 참고해 필요한 자료를 찾은 뒤 제한된 크기로 읽게 했다. [Anthropic의 agent 평가 방법론](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)에 따라 성공 문구보다 저장 파일, 해시, 재조회 값과 설치된 실행 파일을 검사한다.

기존 AJV, MiniSearch, Pi, SQLite와 Microsoft winapp을 재사용한다. 새 에이전트 프레임워크는 추가하지 않았다. 경로 보완은 [.NET GetFullPath 공식 계약](https://learn.microsoft.com/en-us/dotnet/api/system.io.path.getfullpath?view=net-10.0)의 짧은 경로 확장을 고려한다.

## 확인 결과

- macOS 회귀 검사 126개 통과.
- 실제 Chrome UI 46개와 공유 UI 14개 통과. A2A 화면 비노출 포함.
- 브라우저/Electron 빌드와 macOS Electron 구동 통과. 실제 worker IPC의 VOC 저장/검색/분할 조회와 OpenWiki 검색 확인.
- `npm audit --omit=dev` 알려진 취약점 0건. 이 시점의 의존성 검사이며 전체 보안 보증은 아니다.
- Windows 설치 배포: 진행 중. 최종 CI 보고서가 통과하기 전에는 배포 완료로 표시하지 않는다.

## 남은 기능과 검증

- JSM 브라우저 수집기, 첨부 변환, 선택한 PC 폴더 내보내기는 아직 미구현.
- 현재 VOC는 사용자가 제공한 JSON이다. 저장 바이트 검증과 사실/해결 여부 검증을 구분한다.
- Windows 실사용 앱, 실계정과 Qwen 응답 품질은 별도 표본 평가가 필요하다.
- 검색은 최신 티켓 100건/텍스트 예산 내에서 수행하고 누락을 표시한다. 대용량 검색과 동일 origin의 여러 Jira context 구분은 후속 작업이다.
