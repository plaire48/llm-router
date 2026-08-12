# OpenAI 구독 OAuth 스파이크 결과 (스펙 §7B)

- 날짜: 2026-08-12
- 상태: **결론 도출 — 구독 OAuth로 OpenAI 플랫폼 API 호출 불가**
- 방법: 로컬 Codex CLI 설치(`~/.codex/auth.json`)의 실제 토큰으로 직접 호출 검증

## 요약

**ChatGPT 구독 OAuth 토큰으로는 OpenAI 플랫폼 API(`api.openai.com/v1`)를 호출할 수 없다.** 토큰이 신원 확인 스코프만 가지고 있고, 추론에 필요한 API 스코프가 부여되지 않는다. 따라서 이 라우터에서 **OpenAI는 API key 경로만 지원한다.**

## 확인된 OAuth 계약

Codex CLI가 `auth_mode: "chatgpt"`, `OPENAI_API_KEY: null` 상태로 동작하므로 구독 로그인 자체는 실재한다.

| 항목 | 값 |
|---|---|
| issuer (`iss`) | `https://auth.openai.com` |
| client_id | `app_EMoamEEZ73f0CkXaXp7hrann` |
| access_token audience (`aud`) | `https://api.openai.com/v1` |
| **granted scopes (`scp`)** | **`openid`, `profile`, `email`, `offline_access`** |
| 저장 형태 | `~/.codex/auth.json` — `tokens.{id_token, access_token, refresh_token, account_id}` + `last_refresh` |
| 부가 클레임 | `https://api.openai.com/auth` 안에 `chatgpt_account_id`, `chatgpt_plan_type`(예: `pro`), `chatgpt_user_id`, `organizations[]` |

`aud`가 `https://api.openai.com/v1`이라 API를 부를 수 있을 것처럼 보이지만, **실제 부여된 스코프는 OIDC 신원 확인용 4개뿐**이다. 이것이 핵심이다.

## 검증 결과 (실제 호출)

유효한(미만료) 구독 access_token으로 `Authorization: Bearer`를 붙여 호출. `chatgpt-account-id` 헤더 유무 모두 시도.

| 요청 | 상태 | 응답 |
|---|---|---|
| `GET /v1/models` | **403** | `Missing scopes: api.model.read` |
| `GET /v1/models` (+ account-id 헤더) | **403** | 동일 |
| `POST /v1/responses` | **401** | `Missing scopes: api.responses.write` |
| `POST /v1/chat/completions` | **401** | `Missing scopes: model.request` |

세 엔드포인트 모두 인증은 통과했으나(토큰 자체는 유효) **인가에서 거부**됐다. 토큰이 잘못된 게 아니라 권한이 없는 것이다.

## 해석

이 결과는 제품 구조와 일치한다. **ChatGPT 구독과 OpenAI 플랫폼 API는 별도로 과금되는 별개 제품**이다. 구독료를 냈다고 플랫폼 API 크레딧이 생기지 않으므로, 구독 토큰에 API 스코프를 부여할 이유가 없다.

Codex CLI가 이 토큰으로 동작한다는 것은, Codex가 `api.openai.com/v1`이 아니라 **ChatGPT 전용 백엔드**를 호출한다는 뜻이다. 그 백엔드는 문서화되지 않은 비공개 API이며, 이 프로젝트는 그것을 대상으로 삼지 않는다.

## 확인하지 않은 것 (정직한 한계)

- 세 개 엔드포인트만 시도했다. 플랫폼 API의 다른 경로는 시도하지 않았다.
- authorize 시점에 **다른 스코프를 요청하면** 결과가 달라질 가능성은 배제하지 못했다. 다만 스코프 부여는 OAuth 클라이언트의 허용 범위와 계정 자격에 달려 있고, 위 제품 구조상 구독 계정에 API 스코프가 부여될 가능성은 낮다고 본다.
- **검증에 쓴 계정은 ChatGPT Pro(`chatgpt_plan_type: "pro"`, `organizations: 0개`)다. Enterprise 계정은 확인하지 못했다.** 토큰에 `organizations[]` 클레임이 있으므로 조직 소속 계정에서 결과가 다를 여지는 남아 있다. 다만 ChatGPT Enterprise와 OpenAI API 플랫폼은 별도 계약 제품이므로 같은 결과일 가능성이 높다고 본다.
  → 사내 Enterprise 계정에서 `scripts/probe_openai_subscription_scopes.py`를 실행하면 2분 안에 확정된다. 하나라도 2xx가 나오면 이 결론을 뒤집고 구현 가능하다.
- ChatGPT 비공개 백엔드는 **의도적으로 조사하지 않았다.**

## 결정

1. **OpenAI 구독 OAuth 지원을 중단한다.** 현재의 501 차단 상태를 영구 결정으로 승격하고, 에러 메시지를 "스파이크 미완료"에서 "구독 OAuth는 OpenAI 플랫폼 API를 열지 않음 — API key를 사용하라"로 바꾼다.
2. **OpenAI는 API key 경로로 지원한다.** 이미 동작하며(`provider: openai`, `auth: api_key`), OpenAI 호환 서버(`openai_compatible`)도 그대로 쓸 수 있다.
3. 스펙 §7B와 CLAUDE.md를 이 결론으로 갱신한다.

## 이 프로젝트에 주는 의미

원래 목표는 "Claude·OpenAI 둘 다 구독 OAuth로 연다"였다. 그중 **OpenAI 절반은 기술적으로 불가능하다는 것이 확정**됐다. Claude 쪽은 여전히 유효하며(§7A 체크리스트로 검증 대기), 라우터의 나머지 가치 — 하나의 OpenAI 호환 표면, 프로필 관리, 사용량 대시보드 — 는 영향받지 않는다.
