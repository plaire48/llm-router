# 스킬 활용과 도구 선택

누비는 프로젝트 스킬을 검색한 뒤 필요한 지침만 읽는다. 작업별 도구 선택 안내와 실제 실행 권한은 분리한다.

## 반영한 방식

- Agent Skills 형식의 YAML frontmatter를 기존 `yaml` 2.9.0으로 읽는다. `.agents/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, `.opencode/skills/<name>/SKILL.md`를 지원한다. 동일 이름도 전체 경로로 구분한다.
- `discover_capabilities`는 기존 MiniSearch 7.2.0으로 이름과 설명을 검색한다. 코드 변경, OpenWiki-SDS와 DB 근거, VOC, 실행 환경, Windows 앱, 메신저 초안, 오류 복구의 도구 순서와 확인 기준도 반환한다. 실제 등록된 도구만 안내한다.
- `read_skill`은 검색에서 받은 경로와 해시를 확인하고 본문 또는 상대 참조를 최대 8,000자씩 읽는다. 목록에는 본문을 넣지 않는다. 변경된 파일은 다시 검색해야 한다.
- 실제 Pi 실행 루프와 작업 기록에 연결했다. 화면에는 `스킬과 도구 찾기`, `스킬 지침 확인`으로 표시한다. 새 프레임워크나 별도 실행기는 추가하지 않았다.
- 스킬 스크립트는 텍스트다. 필요한 명령은 기존 소스 조회와 실행 준비 승인으로 연결한다. `allowed-tools`는 실행 허가가 아니다. 스킬 읽기는 소스 수정 관찰을 만들지 않는다.

## 선택 근거

[OpenCode의 스킬](https://opencode.ai/docs/skills/)과 [실제 skill 도구](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/skill.ts)의 필요 시 로딩 방식을 참고했다. OpenCode 런타임 전체를 새로 넣거나 코드를 복제하지 않았다. [Agent Skills 명세](https://agentskills.io/specification)의 이름과 설명, 상대 참조 구조를 채택했다. Python 기반 참조 검사기를 제품에 넣으면 설치 의존성이 늘어 기존 YAML 파서를 사용했다.

[Anthropic의 도구 설계](https://www.anthropic.com/engineering/writing-tools-for-agents)에 따라 도구의 목적, 선행 조건, 결과 해석과 실패 후 행동을 명시했다. 검색 점수는 적합성의 후보 순위이며 모델 판단이나 업무 정확도를 대신하지 않는다. MiniSearch는 MIT, YAML은 ISC 라이선스이며 기존 잠금 파일과 라이선스 고지를 유지한다.

## 범위와 검증

현재 작업 Workspace 루트만 읽는다. 홈 스킬, 상위 저장소 탐색, 원격 다운로드, 자동 설치, 심볼릭 링크는 지원하지 않는다. 최대 120개 디렉터리를 조사하고 초과 시 부분 검색임을 반환한다. 스킬은 32KiB, frontmatter는 8KiB로 제한한다. YAML alias, 잘못된 이름, 중복 필드와 비밀 경로를 거부한다. 큰 참조 파일은 별도로 나눠야 한다.

실제 Pi 도구 루프에 합성 모델 응답을 주어 검색 → 지침 읽기 → 미관찰 수정 거부를 검사했다. 경로 격리, 변경된 해시, 중복 이름, 손상된 YAML, 참조 분할과 도구 검색도 검사한다. 실제 사내 모델의 스킬 선택 정확도나 업무 성능 향상은 아직 측정하지 않았다. A2A와 Office/Chrome 위임은 활성화하지 않는다.

메신저 입력과 전송은 별개다. 수신자와 초안을 확인하고 전송은 별도 동작 승인을 받는다. 현재는 UIA로 읽고 쓸 수 있는 컨트롤만 지원하며, 임의 키보드 주입이나 입력 불가 컨트롤에 대한 자동 우회는 제공하지 않는다.

사용자는 이제 상단 `스킬 관리`에서 ZIP/폴더를 등록할 수 있다. `use_skill`이 등록 패키지의 지침과 리소스 경로를 불러오고 `read_skill`이 필요한 참조만 읽는다. 등록 범위와 검증 근거는 [SKILL-REGISTRATION.md](SKILL-REGISTRATION.md)를 따른다.
