# Windows Claude 연결

탐지는 설치 방식보다 `claude --version`의 실행 성공을 기준으로 한다. Office 어댑터 `runtime-src/claude-cli.mjs`에서 경로와 실행 방식을 확인하며 누비 원본 CLI 프로토콜과 인증 저장소는 유지한다.

| 설치 환경 | 처리 |
| --- | --- |
| 공식 설치, PATH의 EXE | 버전 실행 후 같은 EXE로 연결 |
| npm 기본·사용자 지정 prefix | 공개 package.json의 Claude bin을 확인하고 포함된 Node로 실행. JSON 인자를 셸 문자열로 변환하지 않음 |
| CMD·BAT 래퍼 | CMD 전용 실행, 배치 인자 이스케이프, 환경변수를 통한 인자 전달 |
| PS1 래퍼 | PowerShell 실행, 임시 JSON 파일로 인자 전달 |
| 설치 후에도 열려 있는 Office | 현재 사용자·시스템 PATH 재조회, 발견한 PATH를 후속 호출에도 전달 |
| PowerShell 별칭·함수 | Windows PowerShell·PowerShell 7을 확인. 필요할 때 해당 프로필을 읽고 같은 셸에서 실행 |
| 여러 설치 중 하나가 손상됨 | 해당 버전 실행 실패 후 다음 후보 확인 |

실행 경로는 로그인, 인증 상태, 모델 목록, 실제 답변에 공통 적용한다. 버전 실행 성공 뒤에도 기존 CLI 기능 검사와 로그인이 필요하다. 탐지 실패, 실행 실패, 시간 초과를 다른 메시지로 표시한다. 사용자 실행 정책이나 설치 경로를 변경하지 않는다. CLI stderr나 프로필 출력, 인증 파일 내용은 표시하거나 기록하지 않는다.

`npm test`에 경로 탐지 검사와 실제 프로세스 인자·stdin·취소·시간 초과 검사를 포함했다. Windows에서 실행하면 추가로 CMD, PS1, 사용자 지정 npm 설치의 실제 프로세스 검사도 실행한다. `Build-Windows.ps1`은 전체 테스트와 Claude 로그인·모델·GenOffice 연결 검사를 실행한다.

Windows 11 실제 PC, 프로필별 실행 정책, 실제 Claude 계정 및 Office 내 실행은 현장 검증 대상이다. WSL 안에서만 실행되는 Linux Claude는 이 Windows 어댑터의 자동 탐지 대상이 아니다.

공식 근거: [Claude Code 설치와 버전 확인](https://code.claude.com/docs/en/setup), [Node의 Windows CMD/BAT 실행 규칙](https://nodejs.org/download/release/v25.9.0/docs/api/child_process.html).
