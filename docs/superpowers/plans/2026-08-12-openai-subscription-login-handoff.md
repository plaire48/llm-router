# Codex 인계 명세 — OpenAI 구독 로그인으로 추론 열기

- 목표: `llm-router`에서 **API key 없이 ChatGPT 구독 로그인만으로** OpenAI 추론을 쓴다 (Anthropic 경로와 동일한 사용자 경험).
- 상태: **선행 조사 완료, 구현 미착수.** 아래 §3의 미지수를 먼저 발견해야 코드를 쓸 수 있다.
- 근거 문서: `docs/superpowers/specs/openai-oauth-findings.md`

---

## 1. 확정된 사실 (재조사 불필요)

Codex CLI가 `auth_mode: "chatgpt"` / `OPENAI_API_KEY: null` 로 동작한다 — **구독 로그인만으로 추론이 되는 경로는 실재한다.**

| 항목 | 값 |
|---|---|
| issuer | `https://auth.openai.com` |
| client_id | `app_EMoamEEZ73f0CkXaXp7hrann` |
| 토큰 저장 위치 | `~/.codex/auth.json` |
| 토큰 구조 | `tokens.{id_token, access_token, refresh_token, account_id}`, `last_refresh` |
| access_token `aud` | `https://api.openai.com/v1` |
| **부여 스코프 (`scp`)** | **`openid`, `profile`, `email`, `offline_access`** |
| 유용한 클레임 | `https://api.openai.com/auth` → `chatgpt_account_id`, `chatgpt_plan_type`, `chatgpt_user_id`, `organizations[]` |

## 2. 확정된 차단 (다시 시도하지 말 것)

구독 access_token으로 **공개 플랫폼 API는 열리지 않는다.** 실제 호출로 확인했다:

| 요청 | 상태 | 사유 |
|---|---|---|
| `GET https://api.openai.com/v1/models` | 403 | `Missing scopes: api.model.read` |
| `POST https://api.openai.com/v1/chat/completions` | 401 | `Missing scopes: model.request` |
| `POST https://api.openai.com/v1/responses` | 401 | `Missing scopes: api.responses.write` |

`chatgpt-account-id` 헤더를 붙여도 동일하다. 인증은 통과하고 **인가에서 거부**된다.

→ **따라서 `api.openai.com/v1`을 대상으로 구현하면 반드시 실패한다.** Codex가 실제로 호출하는 다른 백엔드를 대상으로 삼아야 한다.

## 3. 발견해야 할 것 (구현 전 선행)

Codex는 ChatGPT 데스크톱 앱(`/Applications/ChatGPT.app`, Electron)에 포함돼 있다. 아래를 확정해야 한다.

1. **베이스 URL과 경로** — Codex가 추론에 쓰는 엔드포인트. (`api.openai.com/v1`이 아님은 §2에서 확정)
2. **요청 스키마** — Responses API 형태인가, chat/completions 형태인가, 아니면 자체 포맷인가.
3. **필수 헤더** — `authorization: Bearer <access_token>` 외에 `chatgpt-account-id`, `originator`, 클라이언트 버전 등 무엇이 필요한가.
4. **스트리밍 포맷** — SSE인가, 이벤트 타입은 무엇인가.
5. **가용 모델 id** — 구독 플랜에서 실제로 부를 수 있는 모델.
6. **refresh 흐름** — `~/.codex/auth.json`의 `refresh_token`으로 갱신하는 엔드포인트와 파라미터.

**발견 방법(권장 순):** ChatGPT.app의 Electron 번들(`app.asar`) 내 문자열 검색 → 실행 중 네트워크 관찰 → Codex 오픈소스 저장소(있다면) 확인.

## 4. 구현 (발견 완료 후)

기존 구조에 맞춰 **가산적으로** 붙인다. 새 개념을 만들지 않는다.

- `src/llm_router/oauth/openai_constants.py` — §1 + §3의 확정값을 고정.
- `src/llm_router/oauth/openai_flow.py` — PKCE 로그인. Anthropic의 `flow.py`와 동형.
- `src/llm_router/credentials/openai_oauth.py` — `AnthropicOAuth`와 동일한 `async headers()` 계약. 저장 파일 `~/.llm-router/openai_credentials.json` (0600).
  - **선택지:** 기존 `~/.codex/auth.json`을 읽어 재사용할지, 자체 로그인 흐름을 구현할지. 재사용이 빠르지만 Codex 설치에 종속된다.
- `src/llm_router/adapters/openai.py` — `auth: oauth` 분기. §3-2 결과가 chat/completions 호환이면 헤더 교체 패스스루, 자체 포맷이면 변환기 추가.
- `src/llm_router/credentials/__init__.py` — `build_credential`에서 `provider == "openai" and auth == "oauth"` → 새 자격증명 반환 (현재 501 차단 해제).
- `src/llm_router/cli.py` — `llm-router oauth login openai`.

프로필 예시(목표 사용 형태):

```yaml
profiles:
  - name: gpt-oauth
    provider: openai
    auth: oauth          # API key 없음
    model: <§3-5에서 확정한 모델 id>
```

## 5. 검증

```bash
python3 scripts/probe_openai_subscription_scopes.py
```

현재는 세 엔드포인트 모두 4xx가 나온다(= §2 재현). 새 백엔드를 찾으면 이 스크립트에 프로브를 추가해 2xx를 확인한다.

구현 후에는 Anthropic §7A와 같은 항목을 확인한다: 비스트리밍 200 / 스트리밍 SSE / 도구 호출 / refresh 자동 갱신.

## 6. 구현자가 알아야 할 리스크

- **비공개·미문서 API다.** 공개 계약이 아니므로 예고 없이 바뀌거나 막힐 수 있고, 그때 이 경로 전체가 한 번에 깨진다.
- **클라이언트 식별에 의존한다.** Codex의 client_id·헤더를 그대로 쓰는 형태가 되며, 이는 공식 클라이언트를 가장하는 것에 가깝다.
- **약관 리스크.** 구독 인증을 공식 클라이언트 밖에서 재사용하는 것은 제공자 약관과 충돌할 수 있다. 개인 계정·로컬 사용 전제로 사용자가 인지하고 선택했다.
- **대안은 이미 동작한다.** `provider: openai, auth: api_key` 경로는 지금도 문제없이 쓸 수 있다. 위 리스크를 감수할 가치가 있는지는 판단의 문제다.

## 7. 참고: Anthropic과의 차이

Anthropic 구독 토큰은 **`user:inference`라는 추론 스코프를 실제로 발급받고, 공개 Messages API를 그대로 호출**한다. 그래서 Claude 경로는 공개 API 위에 서 있다.

OpenAI 구독 토큰은 신원 확인 스코프만 받고 공개 API가 닫혀 있어, 비공개 백엔드를 대상으로 해야 한다. **두 경로의 안정성이 같지 않다**는 점을 설계·운영에 반영해야 한다.
