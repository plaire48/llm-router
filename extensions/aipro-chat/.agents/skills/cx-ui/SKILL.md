---
name: cx-ui
description: "CX 디자인 시스템으로 새 화면을 만들거나 기존 UI를 수정·검토한다. CX 도입, 공통 컴포넌트·토큰·템플릿 활용, 표·모달·토스트 구현 요청에 사용한다. 설치된 CX의 실제 API와 동작 기준을 찾아 서비스 코드에 연결한다. UI와 무관한 백엔드 작업에는 적용하지 않는다."
---

# CX UI

사용자의 화면 요구를 설치된 CX로 구현한다. Codex의 `$cx-ui`와 Claude Code의 `/cx-ui`는 같은 작업 지침을 사용한다. 호출 뒤의 자연어가 이번 작업의 범위다. 검토만 요청했으면 발견 사항을 보고하고, 구현을 요청했으면 코드와 검증까지 완료한다.

다른 도구에 ZIP·폴더로 등록하거나 Node.js를 실행할 수 없는 환경은 [다른 에이전트에서 사용하기](references/portable.md)를 먼저 읽는다. 사용 가능한 파일·문서로 같은 기준을 확인하고 해당 도구의 등록·호출 방식을 따른다.

## 현재 프로젝트부터 확인한다

작업 대상의 AGENTS.md·CLAUDE.md, package.json, 앱 진입점과 수정할 화면을 확인한다. 기존 프레임워크·라우팅·데이터·사용자의 작업 중 변경을 유지한다. 여러 앱이 있는 저장소는 해당 프런트엔드 프로젝트를 조회 대상으로 지정한다.

Node.js를 사용할 수 있으면 이 SKILL.md와 같은 폴더의 `scripts/lookup.mjs`를 실행한다. 아래는 프로젝트 루트에서의 예시이며, 실제로 읽은 스킬 폴더의 스크립트 하나를 선택한다.

```sh
# Codex
node .agents/skills/cx-ui/scripts/lookup.mjs . --summary
# Claude Code
node .claude/skills/cx-ui/scripts/lookup.mjs . --summary
```

출력의 `packageRoot`가 문서·소스 경로의 기준이다. 설치 버전, 프로젝트 검사 명령, 공개 API와 관련 자료를 확인한다. 스킬이 있는 저장소의 패키지를 소비 프로젝트에 설치된 버전으로 간주하지 않는다. CX를 못 찾으면 [도입·구현 흐름](references/workflows.md#cx가-없는-프로젝트)을 읽고 사용자가 제공한 다운로드 폴더/TGZ부터 확인한다.

조회 결과의 `docs/IDENTITY.md`와 요청에 해당하는 문서만 읽는다. 필요한 키워드로 좁혀 조회한다. `--summary` 대신 `로그인`, `모달`, `토스트`, `고정`, `--brand-action` 등을 전달하면 해당 API·토큰·예제 경로를 얻는다. 결과가 없으면 실제 export와 관련 소스를 확인하고 API를 추측하지 않는다.

## 요청에 맞는 출발점을 고른다

| 요청 | 읽을 자료와 구현 방향 |
| --- | --- |
| 새 앱·새 화면 | [도입·구현 흐름](references/workflows.md#새-앱과-새-화면), `library.templates`, `docs/TEMPLATES.txt`에서 필요한 템플릿 |
| 기존 화면을 CX로 맞추기 | [기존 화면 전환](references/workflows.md#기존-화면-전환), 현재 데이터 흐름과 `docs/COMPONENTS.md` |
| 색·폰트·간격·상태 강조 | `tokens/catalog.json`의 의미 토큰·조건, `docs/IDENTITY.md` |
| 정렬·고정·필터·편집 표 | `library.tables`, `agent/table-contract.json`, `docs/TABLES.txt` |
| 모달·확인·도움말 | `docs/COMPONENTS.md`의 DetailPanel·CxConfirmation, 필요한 `docs/PATTERNS.md` 부분 |
| 토스트·저장·재시도·로딩 | `library.feedback`, `agent/feedback-contract.json`, `docs/FEEDBACK.md` |
| 디자인 검토만 | [검토와 확인](references/workflows.md#검토와-확인), 변경 화면의 실제 계산 스타일·동작 |

`reference/`는 원본 제품의 참고 코드다. 독립 프로젝트에서 import할 API는 `agent/manifest.json`의 `portable`만 사용한다. 현재 CxTable은 기본 표시용이며 정렬·고정·필터가 내장된 DataGrid가 아니다. 표 계약의 미해결 항목과 서비스 소유 상태를 확인하고 필요한 기능을 범위에 맞게 조합한다.

## 같은 디자인으로 실제 동작을 구현한다

- 앱 진입점에서 CX `styles.css`를 한 번 연결한다. 기존 셸이 있으면 중복 CxAppShell을 만들지 않고 템플릿의 `embedded`를 사용한다.
- 색·서체·간격은 설치된 의미 토큰을 사용한다. 시그니처 블루와 로컬 Noto Sans KR, 밝은 테마를 유지한다. 별도 배치는 공개 `cx-layout-*` 또는 토큰을 참조하는 화면 CSS로 작성한다. 업무에 맞는 정보 위계·레이아웃까지 판단한다.
- 공통 버튼·입력 크기는 CSS의 포인터 조건을 따른다. CxButton·ActionButton에 없는 `size` prop이나 화면별 강제 크기를 추가하지 않는다. 실제 props는 공개 문서와 소스로 확인한다.
- `login`은 ActionButton의 action, `logIn`은 Icon 이름이다. 핵심 동작의 글자와 아이콘 단독 버튼의 접근 가능한 이름을 유지한다.
- 기존 API·저장 함수를 연결하고 결과가 확인된 뒤 완료를 알린다. 실패 시 초안·오류·복구 경로를 유지한다. 데모 요청은 합성 데이터 범위를 밝힌다. 요청 중복·응답 역전·미저장 닫기는 해당 화면에서 필요한 경우 검증한다.
- 토스트의 원은 약 3초의 표시 시간이다. 오류·재시도도 자동으로 닫히므로 필수 복구는 화면에 남긴다. 작업 중에는 busy/조회 상태를 사용하고, notifyToast의 옵션 객체와 useFeedback의 boolean 인자를 구별한다.
- React가 아닌 프로젝트는 기존 프레임워크를 유지한다. CSS·토큰·로컬 폰트를 적용하고 키보드·모달·상태 동작은 해당 프레임워크에 구현한다. CX에 없는 API를 만드는 대신 실제 공통 확장이 필요한지 판단한다.

세부 템플릿 연결과 최소 JSX 예제는 [도입·구현 흐름](references/workflows.md)에 있다. 같은 값·API 목록을 이 스킬에 복제하지 않고 설치된 패키지를 기준으로 한다.

## 구현한 범위만 검증하고 전달한다

프로젝트의 디자인 검사·빌드와 관련 테스트를 실행한다. `design:check`가 없으면 `packageRoot/scripts/check.mjs`에 실제 UI 폴더를 전달한다. 다른 패키지 매니저의 기존 명령은 유지한다.

변경한 화면을 넓은/좁은 화면에서 확인하고 관련 상태를 실제로 조작한다. 입력 오류, 저장 실패·재시도, 모달 키보드·초점 복귀, 표 내부 스크롤, 긴 한국어, 로딩·토스트가 대상이다. UI와 무관한 화면 전체를 일괄 재검증하지 않는다. 브라우저나 실제 서비스 연결을 확인하지 못하면 자동 테스트 결과와 구분해 적는다.

최종 답변은 구현한 화면·사용한 CX 구성·검증·남은 서비스 연결을 간단히 설명한다. 공통 토큰이나 공개 API 자체를 바꿔야 하면 소비 프로젝트의 node_modules에 숨겨 수정하지 말고 CX 변경으로 다룬다. 이 스킬은 배포·푸시·외부 전송 권한을 추가하지 않는다.
