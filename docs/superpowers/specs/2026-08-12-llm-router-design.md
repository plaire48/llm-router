# llm-router 설계 문서

- 날짜: 2026-08-12
- 상태: 사용자 설계 승인 완료 (구현 계획 작성 전)
- 역할 분담: Claude = 계획·설계·리뷰 / Codex = 구현

## 1. 목표

localhost에서 도는 로컬 LLM 게이트웨이. 구독 계정(Claude Pro/Max)의 OAuth 인증과 일반 API key 제공자를 하나의 **OpenAI 호환 API**로 열어준다. API key만 받는 도구(대표 타깃: OpenCrew — PyPI `opencrew`, Letta 기반 로컬 에이전트 런타임)가 로컬 엔드포인트 + 로컬 마스터 키만으로 모든 LLM을 쓸 수 있게 한다.

성공 기준:

1. OpenCrew에 `base_url=http://localhost:<port>/v1`, `api_key=<마스터 키>`, `model=<프로필명>`을 설정하면 Claude 구독 모델로 에이전트가 정상 동작한다(도구 호출 포함).
2. OpenAI SDK 표준 클라이언트가 코드 수정 없이 이 서버를 쓸 수 있다.
3. 프로필 추가만으로 새 제공자/모델이 열린다.

## 2. 확정된 결정

| 결정 | 선택 | 근거 |
|---|---|---|
| 접근 모델 | 하이브리드 | Claude만 구독 OAuth(견고), OpenAI·기타는 API key. OpenAI 구독 OAuth는 비공식·ToS 회색지대라 MVP 제외, 추후 실험 모듈 |
| API 표면 | OpenAI 호환만 | 사실상 표준. OpenCrew/Letta가 base_url로 바로 연결. 단일 표면으로 변환기 1벌 유지 |
| 서버 인증/프로필 | 마스터 키 1개 + model명→프로필 매핑 | MVP에 충분. 프로필별 발급 키는 추후 |
| 구축 전략 | 직접 구축 (LiteLLM 미사용) | 유일한 난구간인 Claude OAuth는 어차피 커스텀. Anthropic↔OpenAI 변환기 1벌이면 나머지는 패스스루. 무거운 의존성 0 |
| 도구 호출 | MVP 포함 | OpenCrew/Letta 에이전트가 도구 호출에 의존. 미포함 시 핵심 타깃이 동작 안 함 |
| 스택 | Python 3.11+, FastAPI, httpx, Pydantic, typer | OpenCrew 생태계와 정렬, 비동기 스트리밍 프록시에 적합 |

## 3. 아키텍처

```
클라이언트 (OpenCrew, OpenAI SDK, curl)
    │  OpenAI 호환 요청 + Authorization: Bearer <마스터 키>
    ▼
FastAPI 서버 (localhost:<port>)
    ├─ 인증 미들웨어: 마스터 키 검증
    ├─ 라우터: model명 → 프로필 해석
    └─ 어댑터 (프로필의 provider가 선택)
         ├─ AnthropicAdapter ──→ api.anthropic.com  (auth: oauth | api_key, 포맷 변환)
         ├─ OpenAIAdapter ─────→ api.openai.com     (auth: api_key, 패스스루)
         └─ OpenAIAdapter ─────→ 임의 base_url      (openai_compatible, 패스스루)
              ▲
         자격증명 제공자 (EnvApiKey | AnthropicOAuth[저장·자동 refresh])
```

핵심 인터페이스는 **어댑터** 하나다: OpenAI 형식 요청을 받아 OpenAI 형식 응답(또는 SSE 스트림)을 돌려준다. 제공자별 차이(포맷, 인증)는 전부 어댑터 내부에 격리된다.

## 4. 구성 요소

### 4.1 HTTP 계층
- `POST /v1/chat/completions` — 스트리밍/비스트리밍. MVP의 유일한 추론 엔드포인트.
- `GET /v1/models` — 프로필 name 목록을 OpenAI 모델 목록 형식으로 반환.
- `GET /health` — 인증 없이 동작 확인.
- 인증: `Authorization: Bearer <LLM_ROUTER_MASTER_KEY>` 불일치 시 401 (OpenAI 에러 포맷).
- 바인딩 기본값 `127.0.0.1` (로컬 전용이 기본, 외부 노출은 명시적 옵트인).

### 4.2 설정 로더
- `.env` — 비밀만: `LLM_ROUTER_MASTER_KEY`, `LLM_ROUTER_PORT`(기본 8787), 제공자 API key들.
- `profiles.yaml` — 프로필 정의. Pydantic으로 기동 시 검증, 실패 시 어떤 필드가 왜 틀렸는지 출력 후 종료.
- 프로필 필드: `name`(클라이언트가 쓰는 model명), `provider`(anthropic | openai | openai_compatible), `auth`(oauth | api_key), `model`(업스트림 모델 id), `api_key_env`(auth=api_key일 때 읽을 env 변수명), `base_url`(openai_compatible 전용), `params`(기본 파라미터, 요청 값이 우선), `aliases`(추가 매핑 이름).
- 검증 규칙: name/alias 전역 유일, provider별 필수 필드(예: openai_compatible은 base_url 필수, anthropic+oauth는 api_key_env 금지) 강제.

### 4.3 라우터
요청 `model` → 프로필 (정확한 name → alias 순). 미존재 시 404 + 가용 모델 목록 포함 에러.

### 4.4 어댑터
공통 시그니처(개념): `complete(request: OpenAIChatRequest, profile: Profile) -> OpenAIChatResponse | AsyncIterator[SSEChunk]`

- **AnthropicAdapter** — 변환기 본체:
  - 요청: messages(system 분리, 멀티턴 병합 규칙), `tools`→Anthropic tools, `tool_calls`/`tool` 롤→`tool_use`/`tool_result` 블록, max_tokens(요청 → 프로필 params → 최종 기본 4096 순), temperature 등 파라미터 매핑.
  - 응답: content 블록→choices, `tool_use`→`tool_calls`, stop_reason→finish_reason, usage 매핑.
  - 스트리밍: Anthropic SSE 이벤트(content_block_delta, tool_use 델타 등)→OpenAI chunk 델타(도구 호출 인자 스트리밍 포함).
  - 인증: 자격증명 제공자에서 받은 헤더 부착. OAuth일 때 Claude Code와 동일한 헤더 형태 사용(스파이크에서 확정 — §7).
- **OpenAIAdapter** — api.openai.com 또는 임의 base_url로 패스스루. model 필드만 프로필의 업스트림 id로 치환, Authorization만 교체. 요청/응답 본문 변환 없음.

### 4.5 자격증명 제공자
- `EnvApiKey` — `api_key_env`에 지정된 환경변수에서 읽음.
- `AnthropicOAuth` — `~/.llm-router/credentials.json`(권한 0600)에 access/refresh 토큰 저장. 만료 5분 전부터 자동 refresh(동시 요청 시 단일 refresh 보장). refresh 실패 시 "재로그인 필요" 에러.

### 4.6 OAuth 모듈 + CLI (typer)
- `llm-router oauth login anthropic` — 브라우저를 열어 Anthropic 구독 OAuth 수행(PKCE), 토큰 저장. **로그인 절차 자체는 사용자가 브라우저에서 직접 수행**한다.
- `llm-router serve` — 서버 기동. 기동 시 각 프로필의 자격증명 존재 여부 점검·경고.
- `llm-router profiles list` — 프로필/별칭/인증상태 표.
- 기존 Claude Code 자격증명 감지·임포트는 MVP 제외(§9 참고).

## 5. 데이터 흐름 (요청 1건)

1. 클라이언트가 OpenAI 형식으로 `POST /v1/chat/completions` (`model: "claude-sonnet"`).
2. 마스터 키 검증 → 실패 시 401.
3. `claude-sonnet` → 프로필 해석 → 실패 시 404.
4. 프로필의 provider로 어댑터, auth로 자격증명 제공자 선택. OAuth면 필요 시 refresh.
5. 어댑터가 요청 번역, httpx로 업스트림 호출 (`stream` 여부 그대로 전파).
6. 응답/SSE를 OpenAI 형식으로 번역해 반환. usage 포함.

## 6. 에러 처리

- 모든 에러 응답은 OpenAI 에러 포맷 `{"error": {"message", "type", "code"}}`.
- 401 마스터 키 불일치 / 404 미존재 모델(가용 목록 포함) / 502 업스트림 연결 실패 / 업스트림 4xx·5xx는 상태코드 보존, 메시지에 제공자 원문 포함.
- 자격증명 문제는 실행 가능한 안내: "Run: llm-router oauth login anthropic".
- 스트리밍 도중 에러: OpenAI 관례에 따라 에러 페이로드 청크 전송 후 스트림 종료.
- 업스트림 429/오버로드: 그대로 전달 (MVP에서는 재시도·큐잉 없음).

## 7. 리스크와 스파이크 (구현 순서 최우선)

**스파이크: Claude 구독 OAuth 경로 검증** — 이 프로젝트의 유일한 미지수.

- 산출물: (a) OAuth 로그인으로 토큰 획득 성공, (b) 그 토큰으로 Anthropic Messages API 호출 성공(정확한 헤더 세트 문서화), (c) 스트리밍 + 도구 호출 응답 확인.
- 실패 시 대비: 토큰은 얻어도 API 호출이 거부되면 → Anthropic API key 경로를 1차 지원으로 승격하고 OAuth는 보류(설계는 어댑터/자격증명 분리 덕에 그대로 유효).
- ToS 유의: 구독 OAuth 토큰을 외부 도구에 재사용하는 것은 제공자 약관과 충돌할 수 있다. 개인 계정·로컬 사용 전제로 사용자가 리스크를 인지하고 선택했다. OpenAI 구독 OAuth는 같은 이유 + 비공식성 때문에 MVP에서 제외됐다.

## 8. 테스트 전략

- **단위**: Anthropic 변환기(요청/응답/스트리밍 청크/도구 호출/에러 — 픽스처 기반), 프로필 검증·해석, 마스터 키 인증, OAuth refresh(토큰 엔드포인트 목킹, 만료/실패 경로).
- **통합**: respx로 업스트림 목킹, FastAPI TestClient로 엔드포인트 전 구간(스트리밍 포함).
- **계약**: 실제 OpenAI Python SDK로 로컬 서버 호출(도구 호출 시나리오 포함) — "표준 클라이언트가 그냥 된다" 보장.
- **수동 스모크**: 스파이크 결과물로 실제 구독 계정 1회 검증 (자동화 불가 영역).

## 9. MVP 범위

**포함**: chat/completions(스트리밍·도구 호출 포함) · models · health · 마스터 키 인증 · profiles.yaml+.env · AnthropicAdapter(oauth/api_key) · OpenAIAdapter(openai/openai_compatible) · AnthropicOAuth(로그인·저장·refresh) · CLI(serve, oauth login, profiles list).

**제외(추후)**: OpenAI 구독 OAuth(실험 모듈로 분리 설계) · 프로필별 발급 키 · litellm 어댑터 · embeddings 등 추가 엔드포인트 · 사용량 로깅/대시보드 · 재시도·폴백 라우팅 · Claude Code 자격증명 임포트.

## 10. 저장소 구조 (개요)

```
llm_router/
├── src/llm_router/
│   ├── server.py          # FastAPI 앱, 엔드포인트, 인증 의존성
│   ├── config.py          # .env + profiles.yaml 로드·검증 (Pydantic)
│   ├── routing.py         # model명 → 프로필
│   ├── adapters/          # base.py, anthropic.py(+변환기), openai.py
│   ├── credentials/       # env_key.py, anthropic_oauth.py(저장·refresh)
│   └── cli.py             # typer 엔트리포인트
├── tests/                 # 단위/통합/계약 + fixtures/
├── profiles.example.yaml
├── .env.example
└── docs/superpowers/specs/
```
