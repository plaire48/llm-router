# Anthropic subscription OAuth findings

- 조사일: 2026-08-12
- 관찰 대상: 이 환경에 설치된 공식 Claude Code `2.1.228` macOS arm64 바이너리
- 현재 상태: 로그인/refresh 메커니즘 확인 완료, 실제 구독 계정 API 스모크 미완료

## 확인된 로그인 계약

Claude 구독 로그인 경로는 다음 값을 사용한다.

- authorize URL: `https://claude.com/cai/oauth/authorize`
- token URL: `https://platform.claude.com/v1/oauth/token`
- client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- PKCE: S256
- callback: `http://localhost:<available-port>/callback`; Claude Code는 가용 포트를 동적으로 선택한다.
- scopes: `user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`
- authorization-code 교환: JSON 본문에 `grant_type`, `code`, `redirect_uri`, `client_id`,
  `code_verifier`, `state`를 전송한다.
- refresh: JSON 본문에 `grant_type=refresh_token`, `refresh_token`, `client_id`, `scope`를
  전송한다. 응답의 `access_token`, 선택적 새 `refresh_token`, `expires_in`, `scope`를 사용한다.

기존 계획의 고정 callback URI 가정과 달리 현재 Claude Code는 동적 loopback 포트를 사용한다.
라우터는 기본 포트를 제공하되 로그인 구현에서 포트 충돌 시 가용 포트를 선택해야 한다.

## 확인된 Messages API 계약

- URL: `https://api.anthropic.com/v1/messages`
- OAuth header: `Authorization: Bearer <access token>`
- 필수 beta header: `anthropic-beta: oauth-2025-04-20`
- API version header: `anthropic-version: 2023-06-01`
- content type: `application/json`

Anthropic의 공개 API 문서는 Messages API가 `POST /v1/messages`이고 `anthropic-version` 및
`content-type` 헤더가 필수임을 확인한다. 다만 공개 문서의 OAuth 설명은 Workload Identity
Federation용 단기 토큰에 관한 것이며 Claude 구독 OAuth를 공식 API 계약으로 문서화하지 않는다.

## 아직 검증하지 않은 항목

이 작업에서는 사용자의 기존 Claude 자격증명을 읽거나 외부 요청에 재사용하지 않았다. 따라서
다음은 실제 구독 계정으로 별도 수동 검증이 필요하다.

1. 최소 Messages 요청의 HTTP 200과 실제 가용 모델 ID
2. `stream: true` SSE 이벤트
3. tools 요청과 `tool_use` 응답
4. refresh token의 실제 회전 및 만료 동작

이 네 항목이 통과하기 전까지 구독 OAuth 지원 상태는 실험적으로 취급한다. API key 경로는
공개 API 계약에 따라 독립적으로 지원한다.
