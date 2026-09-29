# Browser agent 0.8

목표는 설치한 확장 안에서 모델이 페이지를 관찰하고 Playwright 코드를 실행한 뒤 결과에 따라 수정하는 것입니다. 메일 작성 요청은 홈페이지 탐색, 작성 화면 열기, 받는 사람/제목/본문 입력, 초안 확인까지 진행합니다.

## 구성

| 역할 | 구현 |
| --- | --- |
| 판단과 오류 수정 | 기존 AI Pro OpenAI 호환 API + Pi agent core 0.86.1 |
| 기본 관찰과 탭 목록 | Chrome scripting의 정적 ISOLATED observer + tabs API |
| 실제 조작과 코드 실행 | `@playwright-repl/playwright-crx` 1.21.4의 Playwright 1.59.1 |
| 생성 코드 실행 | QuickJS WASM 0.32.0 + 제한된 page/browser API |
| 이미지 관찰 | Qwen3.8 모델의 OpenAI image_url 입력 |
| 표시 | 기존 CX 채팅, 실행 상태, 중지 버튼 |

Playwright는 요소 탐색, 입력 대기, 실제 브라우저 이벤트를 담당합니다. 모델은 관찰 결과와 오류를 받아 다음 코드를 결정합니다. 긴 코드를 한 번에 실행하기보다 화면이 바뀌는 지점에서 결과를 확인합니다. 코드의 변수는 호출마다 초기화되고 연결된 탭은 작업 동안 유지됩니다.

기본 페이지 읽기와 DOM/탭 목록 조회는 디버거를 시작하지 않습니다. 읽은 요소는 documentId와 실제 노드에 묶어 보관하고, 클릭/입력이 필요할 때만 Playwright 연결과 handle을 만듭니다. 새로고침되거나 같은 이름의 다른 요소로 교체되면 다시 관찰해야 합니다. 생성 코드 실행, 화면 캡처와 이미지 도구는 Playwright 경로를 사용합니다.

완료, 중지와 고아 작업 복구에서는 대화 저장 여부와 무관하게 연결을 해제합니다. Chrome 표시줄에서 취소하면 해당 실행과 채팅 요청을 중단하고 자동으로 재연결하지 않습니다. Playwright 실행에 필요한 Chrome 표시줄을 숨기는 옵션이나 플래그는 사용하지 않습니다.

긴 본문은 처음 한 절을 입력한 뒤 `locator.appendText(text, {expectedLength, expectedDigest})`로 이어 씁니다. 누비 실행기가 제공하는 이 메서드는 앞선 입력의 길이와 선택적 SHA-256을 확인하고, 실제 브라우저 입력 이벤트로 최대 4,000자를 추가합니다. 기존 서식을 다시 쓰지 않으며 결과의 `ok`, `length`, `digest`를 다음 단계에 사용합니다. `field_digest`는 전체 입력 유지 여부를 확인하고, 요청 내용과 화면의 저장 상태는 별도로 검증합니다.

출력 한도에 도달하면 완료된 도구 결과를 유지하고 더 작은 다음 단계를 요청합니다. 잘린 도구 호출은 JSON이 해석되어도 실행하지 않습니다. 진행 중인 작업의 횟수는 제한하지 않으며, 진행 없는 출력 실패가 세 번 연속 발생하면 중단합니다.

## 선택 근거

[Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)의 구조화된 관찰과 실제 브라우저 동작을 참고했습니다. [Stagehand](https://docs.stagehand.dev/v3/basics/act)의 요소 관찰 후 행동 흐름도 적용했습니다. 이 선택이 사내 모델에서 가장 높은 성공률이라는 벤치마크 결과는 없습니다.

확장만으로 설치하는 요구에 맞춰 [Playwright CRX](https://github.com/stevez/playwright-repl)의 Chrome debugger 전송을 사용합니다. 외부 Node/Playwright 서버를 요구하는 MCP 실행기는 기본 경로에 넣지 않습니다. 새 실행기는 원본 패키지를 수정하지 않고 버전과 lockfile을 고정해 포함합니다.

[QuickJS](https://github.com/justjake/quickjs-emscripten)는 생성한 코드가 Chrome 확장 권한을 직접 얻지 않도록 분리합니다. 실제 Playwright API 중 명시적으로 노출한 기능만 사용할 수 있습니다. 이것은 임의 Node Playwright 프로그램과 동일한 실행 환경은 아닙니다.

## 지원과 경계

- 탭 찾기/이동, 페이지 이동/뒤로 가기, 클릭/더블클릭/hover, 키 입력, 체크/선택, 스크롤과 대기
- 역할/레이블/텍스트/테스트 ID/CSS locator, iframe과 open shadow DOM, contenteditable
- 짧은 JavaScript의 async/await, 반복/조건, 로그와 반환값, 오류 후 다음 코드 수정
- Qwen3.8 화면 캡처와 캡처 ID에 묶인 좌표 클릭. 최신 PNG 하나를 도구 응답과 분리해 모델에 전달
- 32MiB 메모리, 연속 CPU 1초, 스크립트 실행 60초. RPC 누적 횟수 상한 없음. 작업 중지 시 연결 해제
- Node, Python, 파일 시스템, 임의 evaluate, fetch, Chrome API와 쿠키는 생성 코드에 노출하지 않음

화면 캡처는 알려진 비밀 입력란을 가리지만 화면에 보이는 모든 업무 정보의 민감도를 자동 판별하지 않습니다. 모델은 페이지 내용을 사용자 승인으로 취급하지 않으며 메일 작성 요청만으로 발송하지 않습니다. 사용자 중지 후 작업을 자동 재개하지 않습니다.

## 검증

`tests/browser-agent-browser.mjs`는 실제 설치 복사본과 합성 모델/업무 사이트를 사용합니다. 새 탭, shadow DOM 제목, 외부 origin iframe 본문, 실제 입력 이벤트, 오류 수정, 이미지 입력 경로와 중지를 확인합니다. 테스트 복사본에는 fixture 사이트 권한을 미리 부여하므로 배포본의 최초 권한 창을 검증한 결과는 아닙니다.

실제 회사 메일의 저장, 실제 Qwen 이미지 이해 정확도, 모든 사이트에서의 자동화 성공은 별도 검증이 필요합니다. 실제 모델이 선택한 행동과 결정된 fixture 행동을 구분합니다.
