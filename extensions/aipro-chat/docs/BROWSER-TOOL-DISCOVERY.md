# 브라우저 업무에 맞춘 스킬과 도구 선택

2026-09-23. nubi Beta 1.0.0 beta13. Chrome 확장 내부의 기존 Pi / Playwright CRX 실행기에 적용한다.

## 판단과 실행

사용자 요구사항 → 계획 → 필요한 근거 관찰 → 해당 단계의 도구 선택 → 행동 → 결과 확인을 반복한다. 도구 반환이 성공이어도 요구사항 충족을 별도로 확인한다. 정보가 부족하면 `ask_user`, 최종 전송/게시 등은 기존 승인 경로를 사용한다. 실패한 전체 스크립트를 그대로 재실행하지 않고 현재 값과 부분 실행 기록을 보고 다음 행동을 정한다.

| 필요한 일 | 먼저 사용할 근거와 도구 | 보완 경로 |
| --- | --- | --- |
| 현재 페이지 이해 | 역할/이름/설명/프레임을 담은 `browser_snapshot`, `inspect_dom` | `read_page` 문서 검색과 필요한 구간 |
| 링크, 토글, 메뉴 | 관찰된 ref로 `click_element`, `hover_element` | 열린 메뉴를 다시 읽기, 키보드 의미 동작 |
| 값 입력과 서식 | `fill_form`, `select_option`, 관찰한 편집기 도구 | 짧은 Playwright 스크립트, 실제 값/서식 확인 |
| 스크롤과 드래그 | 관찰한 대상의 `scroll_page`, `drag_element` | 새 화면 관찰과 위치 재확인 |
| DOM으로 불충분한 화면 | `capture_page`, `inspect_images` | 지원하는 시각 모델에서 근거 확인 후 좌표 동작 |
| 반복 업무 절차 | 스킬 설명 비교 → `read_skill` → 필요한 참조 | 등록된 `*.browser.js`를 제한된 브라우저 VM에서 실행 |
| 프로젝트 또는 연결 서비스 | OpenWiki 검색, MCP 도구 목록/스키마 | 필요한 근거만 가져와 브라우저 결과와 대조 |

이 표는 기존 지원 기능과 새 선택 흐름의 연결이다. 모든 API를 항상 켜거나 모든 웹사이트에서 동일하게 작동한다는 보장은 아니다. 현재 요청에 허용된 도구, 사이트 권한과 모델의 이미지 지원 범위를 유지한다. 사용자 OS 마우스를 움직이지 않으며 AI 포인터는 실제 브라우저 작업 위치의 표시다.

## 이번 적용

기존 `select_tools`는 그룹명으로만 도구를 연결했다. 이제 한국어/영어 업무 문장 `query`도 받는다. 기존 MiniSearch가 허용된 도구의 이름, 설명과 그룹의 업무 목적을 검색하고 최대 5개의 관련 스키마를 다음 모델 요청에 제공한다. 순위는 어휘 관련성이며 성공 확률이나 실행 권한이 아니다. 같은 목적을 수행하는 스크립트도 대안으로 검색될 수 있다.

`replace: true`는 단계가 바뀔 때 이전 선택 스키마를 걷어낸다. 관찰, 질문, 승인과 검증 같은 핵심 도구는 유지한다. 검색 결과가 없으면 기존 선택을 지우지 않고 검색어/그룹을 바꾸도록 안내한다. 선택만으로 페이지 접속이나 행동은 발생하지 않는다. 기존 실행기의 전체 허용 목록과 권한 검사는 그대로 유지한다.

`find_skills`는 설명만 반환한다. 요청에 연결된 스킬을 `read_skill`로 실제 읽은 뒤, 읽은 구간에 명시된 이미 허용된 도구를 최대 6개 노출한다. SKILL.md에 실행 가능한 브라우저 스크립트가 있으면 해당 실행 도구도 후보에 포함한다. 실패한 읽기, 변경된 스킬과 검색 결과만으로는 활성화하지 않는다. 스킬 안의 이름이나 지시가 새 권한 또는 최종 승인으로 바뀌지 않는다. Python/Node와 PC 파일 실행은 추가하지 않았다.

## 채택 근거

- [Anthropic Advanced Tool Use](https://www.anthropic.com/engineering/advanced-tool-use): 필요한 도구를 검색해 점진적으로 스키마를 제공하는 패턴. Claude 전용 서버 API를 호출하지 않고 현재 AI Pro/Qwen에도 적용 가능한 로컬 선택 방식으로 구현했다.
- [Agent Skills 클라이언트 구현](https://agentskills.io/client-implementation/adding-skills-support), [Pi 스킬](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md): 설명 → 본문 → 필요한 참조의 단계적 로딩. 기존 요청별 스킬 바인딩과 결합했다.
- [OpenAI Computer Use](https://developers.openai.com/api/docs/guides/tools-computer-use): 행동 후 최신 화면을 전달하고 애플리케이션에서 결과를 검증하는 루프. 페이지 내용과 권한을 분리하고 중대한 동작은 승인한다. OpenAI 전용 모델 호출을 새로 넣은 것은 아니다.
- [Playwright Actionability](https://playwright.dev/docs/actionability), [Playwright CRX](https://github.com/ruifigueira/playwright-crx): 실제 노드의 가시성/안정성/입력 가능 여부를 확인하는 기존 실행기를 유지한다. Node 서버가 필요한 브라우저 프레임워크로 교체하지 않았다.
- [MiniSearch](https://github.com/lucaong/minisearch): 이미 번들된 MIT 라이브러리를 재사용했다. 원격 검색 서버나 임베딩 모델을 추가하지 않는다. Pi MIT, Playwright CRX Apache-2.0의 기존 고지도 유지한다.

[Browser Use](https://github.com/browser-use/browser-use)의 로컬/클라우드 Agent와 [Stagehand](https://github.com/browserbase/stagehand)의 observe/act/extract 구조도 비교했다. Stagehand는 브라우저 옆 확장 실행기를 설명하지만, 공식 사용 예는 SDK가 브라우저를 시작하고 연결하는 형태다. 누비 MV3에 그대로 들어간다는 검증 없이 실행기를 교체하지 않는다. 현재의 관찰/실행/추출 분리와 화면 재확인에 참고하고, Chrome 확장 단독 조건을 충족하는 기존 CRX 경로를 유지한다. 이 두 패키지는 이번에 설치하거나 번들하지 않았다.

## 검증과 한계

`agent-harness.test.mjs`는 한국어 검색, 최대 후보 수, 단계 변경 시 스키마 축소, 결과 없음, 제한된 권한, 스킬 읽기 후 노출과 다음 모델 요청 반영을 검사한다. `skill-library.test.mjs`는 실제 요청별 스킬 바인딩을 통과한 읽기에서 실행 도구가 노출되고, 스크립트 VM과 변경 검사가 유지되는지 확인한다.

`harness-browser.mjs`는 합성 모델이 검색한 스키마를 다음 요청에서 받아 실제 Chrome 양식을 입력하고, 저장 실패와 누락된 본문을 수정한 뒤 최종 값을 검증한다. 이미 완료된 제목 입력은 한 번만 실행한다. 이는 실행기 회귀이며 Qwen의 자율적인 도구 선택 정확도는 아니다. 실제 Qwen 3.8 27B 계정 평가 전까지 성공률이나 토큰 절감률은 주장하지 않는다.

현재 검색은 어휘 기반이므로 표현 차이로 관련 도구가 빠질 수 있다. 그룹 선택을 대안으로 유지한다. 스킬이 자연어로만 도구를 설명하면 명시적 이름 감지가 되지 않을 수 있어 `select_tools`를 사용할 수 있다. 한정된 실서비스 평가에서 실패 사례를 모은 뒤 동의어/설명 개선이나 다른 검색 방법의 비용 대비 효과를 비교한다.
