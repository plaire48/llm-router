# 다른 에이전트에서 사용하기

## ZIP이나 폴더로 등록

ZIP은 `cx-ui/SKILL.md`를 진입점으로 하며 references·scripts·agents를 같은 폴더에 둔다. SKILL.md만 떼어 옮기면 상대 참조와 검색 스크립트가 빠진다.

- Codex·Claude Code에는 압축을 푼 폴더에서 `node cx-ui/scripts/install.mjs`를 실행해 설치할 도구와 프로젝트 폴더를 선택한다. Node.js 22 이상이 필요하다. 비대화형 환경에서는 `node cx-ui/scripts/install.mjs "/path/to/project" --target codex`처럼 경로와 codex·claude·all 중 하나를 명시한다. 선택이 없으면 설치하지 않는다. 기존 복사본이 다르면 중단하고 비교·백업 후 다시 설치한다.
- 스킬 ZIP 업로드를 지원하는 도구에는 전달받은 ZIP을 등록한다. 등록 화면이 요구하는 폴더 구조를 확인한다.
- 폴더형 스킬을 지원하면 압축을 푼 cx-ui 폴더를 해당 도구의 스킬 경로에 복사한다. Codex 프로젝트는 `.agents/skills/cx-ui`, Claude Code 프로젝트는 `.claude/skills/cx-ui`를 사용한다.
- 스킬 등록 기능이 없으면 cx-ui 폴더를 작업공간에 두고 `cx-ui/SKILL.md를 읽고 이 화면에 CX를 적용해줘`처럼 파일 경로를 지정한다. 첨부형 도구에는 요청과 관련된 참조 문서도 함께 전달한다.

기존에 같은 이름의 스킬이 있으면 수정 내용을 비교하고 백업한 뒤 갱신한다. 다른 도구에서 `$cx-ui`나 `/cx-ui` 호출이 자동 지원된다고 가정하지 않는다. 등록·파일 첨부·자연어 요청은 해당 도구의 기능에 맞춘다. agents/openai.yaml은 Codex용 표시 정보이며 다른 도구의 필수 입력은 아니다.

## 실행 도구가 있는 경우

Node.js를 사용할 수 있으면 이 스킬의 scripts/lookup.mjs에 **작업 대상 프로젝트 경로**를 전달한다. 스킬의 설치 위치가 달라져도 같은 스크립트를 사용한다.

```sh
node /path/to/cx-ui/scripts/lookup.mjs /path/to/project --summary
```

프로젝트에 CX가 없으면 [도입 흐름](workflows.md#cx가-없는-프로젝트)을 따른다. 이 ZIP은 에이전트 지침과 조회 도구이며, React 컴포넌트·CSS·폰트가 든 CX 개발 키트/TGZ는 별도로 연결한다.

## Node.js나 로컬 파일 실행이 없는 경우

실행할 수 없는 lookup을 반복하지 말고 사용자가 제공한 CX 문서·패키지 또는 접근 가능한 카탈로그를 확인한다. 정적 문서도 같은 배포 버전의 자료를 사용한다.

1. CX 버전과 디자인 기준: package.json 또는 카탈로그 버전, docs/IDENTITY.md.
2. 실제 API: agent/manifest.json의 portable과 docs/COMPONENTS.md.
3. 필요한 화면만: docs/TEMPLATES.txt, 표는 agent/table-contract.json, 토스트는 agent/feedback-contract.json.
4. 실제 구현: 해당 버전의 템플릿·컴포넌트 소스와 CSS. Pages에서는 같은 경로의 HTML 문서 보기로 읽을 수 있다.

도구가 외부 링크를 읽지 못하면 필요한 자료를 파일로 전달받는다. 자료를 보지 못한 상태에서 컴포넌트 이름·props·색상 값을 추측하지 않는다. 파일 편집·빌드·브라우저 실행이 없는 도구는 확인 가능한 범위의 코드와 적용 절차를 제공하고 실제 실행을 검증했다고 기록하지 않는다.
