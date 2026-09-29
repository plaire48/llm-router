# 개발과 연결 규격

사용자 안내는 [누비 도움말](../GUIDE.md)을 참고하세요.

## 에이전트 실행기

Pi agent core 0.86.1이 대화 상태와 도구 실행, 다음 응답 진행을 담당합니다. 기존 AI Pro Bearer 인증과 스트리밍 형식은 그대로 사용합니다. 도구 입력과 실행 실패를 모델에 반환하여 수정을 시도합니다. 누적 실행 횟수로 작업을 중단하지 않습니다. 같은 결과만 반복되면 중단하며 적용하거나 취소한 입력은 다시 실행하지 않습니다. 오래된 도구 결과가 커지면 최근 관찰을 남기고 축약합니다. Pi CLI나 별도 Node 프로그램을 설치할 필요는 없습니다.

사이트 저장 정보는 저장소 읽기를 허용한 스킬에서만 localStorage/sessionStorage의 키 목록을 확인한 뒤 필요한 키를 선택해 읽습니다. 인증 관련 키와 알려진 비밀값 패턴은 제외합니다. 쿠키와 확장의 인증 저장소는 읽지 않습니다. 임의 업무 데이터 전체의 민감 여부를 판별하는 기능은 아닙니다. 도구 원문은 영구 기록하지 않으며, 최종 답변에 사용된 업무 정보는 대화에 남을 수 있습니다.

채팅창을 닫거나 새로고침해도 worker의 실행은 계속됩니다. Chrome 종료나 worker 강제 종료 후에는 체크포인트를 일시 중지하고 사용자 이어가기 때 재관찰합니다. 작업 기록은 도구 이름과 실행 상태만 대화에 저장합니다. OpenCode 실행기나 외부 MCP 클라이언트가 포함된 버전은 아닙니다. 생성한 JavaScript는 확장에 포함된 QuickJS에서 제한된 Playwright API로 실행합니다. Python, Node, 임의 evaluate, 로컬 파일 실행과 원격 MCP 등록은 지원하지 않습니다. OpenWiki를 연결하면 서버가 허용한 프로젝트 문서와 소스를 읽을 수 있습니다. 메일 작성은 초안이며 발송은 명시적으로 요청한 경우에만 수행하도록 지침을 적용합니다.

## 연결 규격

SSO는 /auth/cli/login?port=... → localhost /auth?code=...&status=00 → POST /auth/exchange 순서입니다. 교환은 URL-encoded code 필드, 응답은 JSON token입니다. code는 저장하지 않습니다.

모델 조회는 GET /api/models, SSO 채팅은 POST /api/v1/chat/completions이며 둘 다 Authorization: Bearer <token>입니다. 수동 API key의 채팅 경로는 /open/api/v1/chat/completions를 유지합니다. max_tokens는 24576, stream과 stream_options.include_usage는 true입니다. 페이지가 연결되면 실제 실행 가능한 도구와 tool_choice: auto를 추가합니다.

예시 CLI 프롬프트의 정확성과 간결성 원칙을 브라우저 기능에 맞춰 적용합니다. 추론 원문은 저장하지 않고 생성 단계만 표시합니다. 추론 토큰은 출력에 포함되며 중복 합산하지 않습니다. 출력 한도로 끝난 답변에는 안내를 표시합니다. 응답 대기는 최대 10분이며 언제든 중지할 수 있습니다.

로컬 라우터나 보조 프로그램은 필요 없습니다. AI Pro 로그인은 declarativeNetRequest 세션 규칙으로 해당 로그인 탭·포트의 최상위 GET /auth 콜백을 확장 문서로 전환합니다. localhost 소켓에 도달하기 전에 처리하며 debugger를 연결하지 않습니다. nonce/문서/탭/frame/만료를 검사하고 코드 교환이 끝나면 탭과 규칙을 제거합니다. 대기 중 worker 휴면은 유지하고 교환 도중 재시작은 재로그인으로 안내합니다. 구버전의 HTTP 헤더/본문 fetch/XHR 콜백 수신은 사용하지 않습니다. ChatGPT 로그인도 같은 세션 규칙으로 정확한 localhost:1455/auth/callback을 확장 문서로 전환합니다. PKCE는 로그인 대기 중 trusted session에만 보관하고 교환 시작/취소 때 제거합니다. FabriX 연결 테스트도 debugger를 사용하지 않습니다. 브라우저 자동화 중에도 Playwright가 debugger에 연결하며 작업 완료나 중지 시 해제합니다. 일반 소스 읽기와 입력 제안은 content script로 동작합니다.

Chrome 계약: [DNR 세션 규칙과 리디렉션](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), [공개 확장 리소스](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources). 공개 문서는 auth-return.html 하나이며 localhost와 AI Pro/EP SSO 출처만 허용합니다. 이 규칙은 다른 탭의 요청을 가로채지 않습니다.

## 사용자 첨부 계약 (1.2.0)

채팅 파일 입력은 PNG/JPEG/WebP, PDF, Word(docx)와 UTF-8 텍스트 소스를 읽는다. 파일 선택/끌어놓기/붙여넣기는 같은 첨부 경로를 사용한다. 붙여넣은 짧은 문장은 입력창에 남고 2,000자 또는 30줄 이상은 텍스트 파일 카드로 표시한다. 클립보드 HTML을 렌더링하거나 실행하지 않는다. worker의 직렬 큐가 대화 ID/제공자/작업 중 상태를 확인한 뒤 `nubi-user-attachments` IndexedDB에 바이트를 저장하고 초안에는 메타데이터만 반영한다. 참조 저장이 실패하면 새 파일을 제거하며 이전 초안을 유지한다. 첨부 선택만으로 모델 요청을 보내지 않는다.

전송은 파일 ID/대화/제공자를 다시 검사한 뒤 파일을 사용자 메시지에 연결한다. 추론 직전에 필요한 최근 이력의 파일만 읽는다. 텍스트는 이름/해시가 붙은 참고 자료, 이미지는 `image_url`로 전달하며 Pi 내부 이미지와 Responses `input_image`로 변환된다. 참조 이미지와 브라우저 관찰을 섞지 않는다. 원격 이미지 URL과 첨부 코드 실행은 지원하지 않는다.

AI Pro 이미지 지원은 기존 Qwen3.8 계약을 따르고 ChatGPT는 번들 Pi 모델 카탈로그의 image 입력을 확인한다. FabriX에는 텍스트만 전송한다. 현재 메시지의 이미지 미지원은 전송 전에 차단해 초안을 유지한다. 이전 턴 이미지가 새 모델과 호환되지 않으면 이름과 이미지 누락 사실을 명시하며 본 것으로 답하지 않도록 한다. 실제 계정의 모델 지원은 별도 검증 대상이다.

한 메시지 최대 4개/8 MiB, 이미지 4 MiB/20 MP, 문서 8 MiB, PDF 2,000쪽, 텍스트 4,000,000자/추출 12 MiB, 보관 80개/80 MiB다. 보관 예산은 추출 텍스트도 포함하며 모델 문맥에는 필요한 구간만 조회한다. 원문은 임의로 자르지 않는다. 재시작 후 참조 없는 파일을 정리하고 대화 삭제는 해당 파일만 제거한다. 이력/초안의 파일은 제공자 전환으로 섞이지 않는다. 대화 압축은 원본 파일을 지우지 않으며 요약에는 파일 이름과 텍스트 근거를 유지하고 이미지 바이트를 제외한다. 요구사항 검토는 참고 이미지와 새 페이지 관찰을 별도로 전달받는다.

PDF.js 6.3.289와 Mammoth 1.12.3의 브라우저 모듈을 별도 worker에 번들한다. PDF worker/CMap/표준 글꼴도 로컬 자산이며 PDF의 JavaScript 실행, 외부 파일과 원격 파서 코드를 허용하지 않는다. 문서 읽기는 20초 제한이고 DOCX는 ZIP 확장량을 미리 검사한다. 추출한 텍스트와 원본 파일은 IndexedDB에 두며 미리보기는 React 텍스트로 표시하고 다운로드는 원본 바이트를 제공한다. PDF/Word의 그림/도표/배치와 OCR은 지원하지 않는다. 빈/암호화/손상 문서는 명시적 오류를 내고 전송하지 않는다. 파서 내부 메시지가 결과로 오인되지 않도록 메시지 종류와 요청 ID를 확인한다. 공식 API: [PDF.js](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [Mammoth](https://github.com/mwilliamson/mammoth.js).

첨부 UI는 타입별 개별 칩 대신 공통 카드/모달을 사용한다. 파일명, 아이콘 자리, 높이와 버튼 위치를 고정하고 한 줄 가로 스크롤로 입력 공간을 보존한다. 모든 카드의 실제 기하/글꼴과 Tab 접근을 세 화면 폭에서 비교한다. 일반 글/PDF/Word는 같은 본문 서체, 소스는 같은 모달 안의 구문 강조로 구분하고 복사/다운로드는 오른쪽 하단에 둔다. 상호작용 참고: [공식 이미지 입력 안내](https://developers.openai.com/codex/image-inputs), [파일 보기 안내](https://learn.chatgpt.com/docs/artifacts-viewer). Codex 앱 직접 UI 열람은 도구 제한으로 수행하지 못했으며, 동일한 픽셀 복제로 표현하지 않는다.
