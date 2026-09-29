# openwiki-SDS

OpenWiki 0.5.2의 고정 소스에 사내 제공자를 추가한 **openwiki-SDS 0.6.0** (`openwiki-sds`) 패키지입니다. 공식 OpenWiki 배포본과 구분하며, 원본 커밋은 `UPSTREAM.json`에 기록합니다. OpenAI API 키와 ChatGPT 브라우저 로그인은 기존 구현을 유지합니다.

## 설치와 첫 실행

Node.js 22.22 이상을 준비한 뒤, 받은 파일이 있는 폴더에서 실행합니다. 설치에는 npm 의존성을 내려받을 수 있는 네트워크가 필요합니다.

```sh
npm install -g ./openwiki-SDS-0.6.0.tgz
```

기존 `@llm-router/openwiki` 전역 설치본이 있다면 이름이 변경되었으므로 아래 순서로 교체합니다. 인증과 Wiki는 패키지 폴더 밖의 기존 위치를 사용합니다.

```sh
npm uninstall -g @llm-router/openwiki
npm install -g ./openwiki-SDS-0.6.0.tgz
```

실행 명령은 `openwiki` 그대로입니다. 문서화할 프로젝트 폴더에서 실행합니다.

```sh
openwiki --init
```

제공자 목록에서 **AI Pro (Browser SSO)**, **AI Pro CLI** 또는 **FabriX**를 선택합니다. 이후 Wiki 갱신은 `openwiki --update`, 그래프 탐색은 `openwiki visualize`를 사용합니다. 이 패키지는 OpenWiki 자체의 CLI이며 Chrome 확장 설치를 요구하지 않습니다. LLM Router, Python, OpenCode도 필요하지 않습니다.

기존 전역 `openwiki` 명령과 충돌한다면 강제 덮어쓰기 대신 로컬로 설치할 수 있습니다.

```sh
npm install --prefix ./openwiki-tools ./openwiki-SDS-0.6.0.tgz
```

문서화할 프로젝트 폴더에서 `openwiki-tools/node_modules/openwiki-sds/dist/cli/cli.js`의 실제 경로를 `node`에 전달합니다.

## 누비에서 Wiki와 소스 읽기

프로젝트 폴더에서 다음 명령으로 로컬 Wiki를 열고, 누비의 프로젝트 연결을 선택합니다.

```sh
openwiki visualize openwiki --project-root .
```

`--project-root`는 누비에 읽기를 허용할 소스 폴더입니다. 생략하면 Wiki 문서만 연결합니다. 연결 뒤 Wiki 탭은 닫아도 되지만 터미널의 OpenWiki 서버는 실행 중이어야 합니다. 정적 내보내기는 이 연결을 지원하지 않습니다.

누비는 검색한 Wiki와 소스 일부를 현재 선택한 모델로 전달합니다. 파일 경로, 실제 줄 범위와 SHA-256 해시를 함께 반환하며 변경된 파일은 다음 조회에 반영합니다. Wiki 그래프 구성 시각을 원본 소스의 최신성으로 표시하지 않습니다. 파일 수정, 명령 실행, 설치, 빌드 기능은 포함하지 않습니다.

로컬 서버에 일회 연결 코드와 8시간 세션을 추가했습니다. 코드는 페이지를 다시 열면 생성되며 5분 뒤 만료합니다. 토큰은 서버 메모리에만 보관하고 연결 해제 또는 서버 종료 시 사용할 수 없습니다. 자료 API는 Bearer 인증을 요구하며 loopback Host와 요청 Origin을 검사합니다. 연결 전 식별 API는 서비스·버전·지원 기능만 반환합니다.

소스는 지정한 폴더 안의 UTF-8 텍스트만 읽습니다. 숨김 파일, 인증·비밀 파일, 빌드/의존성 폴더, symlink, `.gitignore`·`.openwikiignore` 제외 경로는 읽기와 검색에서 차단합니다. 파일은 512 KiB 이하, 반환 범위는 최대 200줄·16,000자이며 검색은 기본 5개입니다. 제한으로 검색이 중단되면 `truncated`를 반환합니다.

실제 로컬 HTTP 검사는 연결·일회 코드 재사용·만료·해제·서버 간 토큰 격리, 경로 탈출·제외 파일·symlink·대용량 차단, Wiki 전용 연결과 소스 변경 후 재조회까지 확인합니다. 회사망 로그인이나 실제 모델 응답 평가는 별도입니다.

## AI Pro (Browser SSO)

1. 제공자에서 AI Pro (Browser SSO)를 선택하면 로그인 브라우저가 열립니다.
2. 기존 SSO 계정으로 로그인합니다. 토큰 교환이 성공하면 openwiki-SDS 인증 완료 화면이 표시됩니다.
3. 브라우저 창을 닫고 openwiki-SDS 터미널에서 모델을 선택해 설정을 마칩니다.

`/auth/cli/login?port=...` → loopback `/auth?code=...&status=00` → `/auth/exchange` 계약을 사용합니다. 일회성 code는 메모리에서 한 번만 교환하며 파일과 로그에 저장하지 않습니다. 인증 토큰으로 `/api/models`를 조회하고 `/api/v1/chat/completions`를 호출합니다. 두 요청 모두 `Authorization: Bearer <token>`을 사용합니다.

로그인 URL은 다음 안내 바로 아래에 표시하며 `c`로 복사할 수도 있습니다.

```text
Opening your browser to sign in to AI Pro...
If it does not open, paste this URL into your browser:
https://aipro.sdsdev.co.kr/auth/cli/login?port=<임시 포트>
```

인증 완료 화면은 Agent Factory SDK 덱의 시각적 방향을 참고한 openwiki-SDS HTML/CSS/SVG 디자인입니다. 은은한 파랑·보라·민트 배경, 책·터미널 아이콘, 체크 선 그리기, 순차 등장, 떠다니는 아이콘과 별 애니메이션을 사용합니다. 시스템의 모션 줄이기 설정에서는 움직임을 끕니다. AI Pro 로고·이미지와 이전에 제공받은 HTML의 디자인 자산을 포함하지 않습니다. 인증 code 수신만으로 성공을 표시하지 않으며, 토큰 교환과 유효성 확인이 끝난 뒤 “인증이 완료되었습니다”와 터미널 복귀 안내를 표시합니다. 교환 실패·취소·시간 만료 시에는 해당 상태를 표시합니다. 아이콘과 Noto Sans KR 폰트는 응답 HTML에 포함해 별도 이미지 파일이나 외부 리소스를 요청하지 않습니다. 폰트는 변경하지 않은 Unicode 서브셋을 사용하며 SIL Open Font License와 저작권 고지를 내장 CSS에 보존합니다. 이 변경은 브라우저 로그인 제공자에 적용됩니다. Base URL·Token·Model ID를 직접 입력하는 AI Pro CLI 방식은 유지합니다.

유효한 이름을 가진 모델을 `target`, `is_agent`와 무관하게 표시합니다. 기본 선택은 목록에 있는 경우 `GLM-5.2-NVFP4`입니다. 인증 만료 시 `openwiki --init`에서 다시 로그인합니다. 검증되지 않은 갱신 API를 추정하여 호출하지 않습니다. 모델 목록에 포함되는 것과 각 모델이 OpenWiki 도구를 안정적으로 사용하는 것은 별도입니다.

OpenWiki가 자체 로그인을 수행하며 기존 Chrome 확장의 인증값을 읽거나 복사하지 않습니다. 터미널과 로그인 브라우저는 같은 PC에서 실행해야 합니다. loopback 수신기는 로그인 중에만 `127.0.0.1`의 임시 포트에서 실행됩니다.

## AI Pro CLI

`openwiki --init`에서 **AI Pro CLI**를 선택하고 다음 세 값을 직접 입력합니다.

1. **Base URL**: 사용할 OpenAI 호환 API 기본 주소. `/v1` 등의 실제 API 경로를 포함하고 `/chat/completions`는 붙이지 않습니다.
2. **Token**: 발급받은 토큰.
3. **Model ID**: 사용할 모델 ID.

일반 **OpenAI-compatible**와 같은 요청 경로를 사용하고, 요청 헤더에 정확히 `User-Agent: AIPROCLI`를 추가합니다. 입력한 주소의 `/chat/completions`에 `Authorization: Bearer <입력한 토큰>`을 보내며 `messages`, `tools`, `tool_calls`와 SSE를 처리합니다. 고정 AI Pro 주소, 모델 목록 조회, 브라우저 로그인은 사용하지 않습니다. 별도 AI Pro CLI 프로그램 설치도 필요하지 않습니다.

Base URL은 `AIPRO_CLI_BASE_URL`, 토큰은 `AIPRO_CLI_TOKEN`, 모델은 `OPENWIKI_MODEL_ID`로 저장합니다. Browser SSO의 `AIPRO_ACCESS_TOKEN`을 가져오거나 덮어쓰지 않습니다. 토큰은 JWT 형식으로 제한하지 않으며 `Bearer ` 접두사를 포함해 붙여넣어도 한 번만 붙여 전송합니다. 만료·폐기된 토큰은 같은 설정에서 교체합니다.

이전 배포에서 CLI 설정 중 **“AI Pro 모델 조회에 실패했습니다. Enter로 다시 조회하거나 Esc로 돌아가 로그인하세요.”**가 나왔다면 CLI에 Browser SSO 모델 조회가 잘못 연결된 문제입니다. `openwiki-SDS-0.6.0.tgz`로 업데이트하고 `openwiki --init`에서 세 값을 설정하세요. 0.5.3은 모델 목록 API를 호출하지 않으므로 이 조회 실패로 설정이 막히지 않습니다.

임의의 로컬 Base URL로 실제 Node HTTP 요청을 보내 주소·토큰·모델·헤더, 일반 OpenAI-compatible와 동일한 요청 본문, 도구 왕복과 SSE를 검증합니다. 실제 회사망 AI Pro CLI 호출은 아직 검증하지 않았습니다.

## FabriX

제공자에서 FabriX를 선택하고 다음 값을 입력합니다.

| 항목       | 용도                                                       |
| ---------- | ---------------------------------------------------------- |
| API Token  | `x-openapi-token: Bearer ...` 인증                         |
| Client Key | `x-fabrix-client` 인증                                     |
| Endpoint   | HTTPS 기본 주소 또는 `/openapi/chat/v1/messages` 전체 주소 |
| 모델 ID    | FabriX에서 허용된 모델 ID                                  |

모델 선택 뒤 응답과 도구 호출/결과 왕복을 두 단계로 테스트합니다. 각 단계에서 형식 재요청이 한 번 발생할 수 있습니다. 통과해야 설정을 저장하고 다음 단계로 진행합니다. 이 테스트에도 모델 사용량이 발생할 수 있습니다.

FabriX의 텍스트 API를 OpenAI Chat Completions 형식으로 변환합니다. 원래 계약에는 native function calling이 확인되지 않아, 요청별 nonce와 도구 JSON 스키마를 전달하고 응답을 검증한 뒤 OpenWiki 도구로 연결합니다. 등록되지 않은 도구, 다른 요청의 nonce, 잘못된 인자는 실행기에 전달하지 않습니다. `auto`, `none` tool choice를 지원하고 이미지 입력은 지원하지 않습니다. 응답 검증 후 반환하므로 FabriX 답변은 버퍼링됩니다.

### 위키 생성 중 도구 응답 오류 처리

이전 버전은 모델 응답이 규약과 다르면 모두 `502 FabriX: fabrix_tool_protocol`로 표시했습니다. 이는 OpenWiki 변환기가 만든 상태 코드이며, FabriX 서버가 HTTP 502를 반환했다는 뜻은 아닙니다.

- JSON 전체를 감싼 Markdown 코드 블록을 처리합니다. 앞뒤 설명, 여러 JSON 객체, reasoning 문장 안의 JSON을 임의로 추출하지 않습니다.
- 문서 형식 지시는 답변의 `content` 또는 도구 인자에 적용하도록 명시합니다. 현재 요청 ID도 대화 뒤에 다시 안내합니다.
- 형식 검증에 실패하면 원래 대화로 한 번만 다시 요청합니다. 실패 응답은 실행하거나 다음 요청에 첨부하지 않습니다. 재요청도 nonce·도구 이름·인자 스키마를 모두 검증합니다.
- 두 번째 응답도 실패하면 `fabrix_tool_protocol`과 세부 원인(`invalid_json`, `request_id_mismatch`, `invalid_arguments` 등)을 표시합니다. 로컬 상태 400과 재시도 금지 헤더로 SDK의 반복 호출을 막습니다. 실제 상위 서버의 HTTP 오류는 원래 상태를 유지합니다.
- 재요청 사용량을 합산하며, 알 수 없는 사용량을 완전한 합계로 표시하지 않습니다. 스트림 종료 이벤트의 출력 길이 제한도 구분합니다.

수정 TGZ를 다시 설치한 뒤 위키 생성을 재실행하세요. 설정은 기존 OpenWiki 전용 환경 파일을 사용합니다. 같은 오류가 남으면 **모델 ID와 세부 원인 코드**로 해당 모델의 응답 형식을 확인해야 합니다. 이 수정은 실제 실패 응답을 확보한 원인 확정이나 회사망 모델 성공 검증을 의미하지 않습니다.

## 저장과 회사망

인증과 설정은 OpenWiki 전용 `~/.openwiki/.env`에 저장합니다. macOS/Linux는 파일 권한 `0600`, Windows는 기존 OpenWiki 사용자 ACL 처리를 사용합니다. `OPENWIKI_CONFIG_DIR`로 별도 폴더를 지정할 수 있습니다. 패키지나 프로젝트 안에 실제 인증값을 포함하지 않습니다.

| 제공자     | 환경 변수                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| AI Pro     | `OPENWIKI_PROVIDER=aipro`, `AIPRO_ACCESS_TOKEN`, `OPENWIKI_MODEL_ID`                                        |
| AI Pro CLI | `OPENWIKI_PROVIDER=aipro-cli`, `AIPRO_CLI_BASE_URL`, `AIPRO_CLI_TOKEN`, `OPENWIKI_MODEL_ID`                 |
| FabriX     | `OPENWIKI_PROVIDER=fabrix`, `FABRIX_API_TOKEN`, `FABRIX_CLIENT_KEY`, `FABRIX_BASE_URL`, `OPENWIKI_MODEL_ID` |

AI Pro SSO·CLI 토큰과 FabriX 인증값은 진단에서 값과 앞뒤 일부를 모두 숨깁니다. 회사 CA가 필요하면 Node 시작 전 `NODE_EXTRA_CA_CERTS`에 인증서 경로를 지정합니다. TLS 검증을 끄지 않습니다. 일반 AI Pro와 FabriX 요청에는 User-Agent를 수동 설정하지 않습니다. AI Pro CLI 모드만 위에 명시한 `AIPROCLI` 헤더를 사용합니다.

## 개발·검증

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm exec vitest run test/enterprise test/config test/setup test/agent/create-model.test.ts test/agent/openai-chatgpt-oauth.test.ts test/agent/environment-debug-value.test.ts test/cli/startup.test.ts
npm run build
npm pack --pack-destination ../../releases/openwiki
```

모의 검증은 실제 loopback 수신, 코드 교환, 취소/만료, 모델 목록, LangChain 도구 호출과 SSE, FabriX 도구 인자 검증, 설정 저장/재조회, 설정 화면의 성공·실패를 포함합니다. **실제 회사망 AI Pro SSO와 FabriX 계정, 실제 모델의 Wiki 생성 품질은 이 개발 환경에서 검증하지 않았습니다.** 기존 OpenAI/ChatGPT 코드 보존과 회귀 테스트는 실제 계정 로그인 검증을 의미하지 않습니다.

원본 프로젝트는 [LangChain OpenWiki](https://github.com/langchain-ai/openwiki)이며 MIT 라이선스를 유지합니다. FabriX 변환과 usage 정규화는 같은 저장소의 `extensions/aipro-chat` 0.10.2 구현을 기반으로 합니다. 이 패키지는 공개 npm 레지스트리에 게시하지 않으며 로컬 TGZ로 배포합니다.
