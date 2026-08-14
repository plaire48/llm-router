# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

LLM Router — OpenAI 브라우저 로그인과 사내 LLM을 하나의 localhost OpenAI 호환 Endpoint로 여는 로컬 게이트웨이. Claude 구독 OAuth는 정책상 비활성이다.

- OpenAI: wheel에 포함된 OpenCode로 ChatGPT 브라우저 로그인과 추론을 실행한다.
- 그 외 제공자: API key를 추가해서 열고 관리한다.
- OpenCrew 호환이 목표: OpenCrew(PyPI `opencrew`, Letta 기반 로컬 에이전트 런타임, Python 3.11+)는 Anthropic/OpenAI API key와 `provider/model` 표기로 LLM을 소비한다. 이 라우터가 발급한 로컬 key·엔드포인트를 OpenCrew에 그대로 꽂아 쓸 수 있어야 한다.
- API key는 .env로 관리하고, LLM은 프로필 형태로 관리할 수 있어야 한다.

## 역할 분담 (MUST)

- Claude(Claude Code)는 계획·설계·명세·리뷰를 담당한다. 구현 코드를 직접 작성하지 않는다 (사용자가 명시적으로 요청한 경우만 예외).
- 구현(개발)은 Codex가 담당한다. 구현이 필요하면 Codex에 넘길 명세/프롬프트를 산출물로 만든다.

## 커뮤니케이션

- 대화와 설명은 한국어로 한다. 코드, 식별자, 커밋 메시지는 영어로 쓴다.

## 명령어

- 설치: `python3 -m pip install -e '.[dev]'`
- 로컬 실행: `llm-router serve --profiles profiles.yaml`
- 전체 테스트: `python3 -m pytest`
- 단일 테스트: `python3 -m pytest tests/test_server.py -v`
- 린트: `ruff check src tests`
- 포맷 확인: `ruff format --check src tests`

## 아키텍처

승인된 설계 스펙: `docs/superpowers/specs/2026-08-12-llm-router-design.md` — 작업 전 반드시 읽는다.

- 스택: Python 3.11+ / FastAPI / httpx / Pydantic / typer.
- 형태: OpenAI 호환 표면(chat/completions·models·health) + 마스터 키 인증 + model명→프로필 라우팅 + provider 어댑터. Anthropic은 OAuth/API key 겸용·포맷 변환. OpenAI는 OAuth(구독)/API key 겸용 — 구독 OAuth가 여는 API 형태는 스파이크(스펙 §7B)가 확정하며 chat↔Responses 변환이 필요할 수 있음. OpenAI호환은 패스스루.
- Anthropic 구독 OAuth는 정책 준수를 위해 MUST 비활성화한다. 로그인·OAuth 프로필 생성·모델 노출·추론을 거부하며, 기존 토큰은 자동 삭제하지 않되 NEVER 사용한다. 정식 API-key 어댑터의 내부 계약 테스트와 과거 사용량 데이터는 유지한다.
- OpenAI 브라우저 로그인은 내부 OpenCode의 `/provider/openai/oauth/authorize|callback` API를 사용한다. localhost callback·토큰 교환·저장·refresh와 추론을 모두 OpenCode에 맡기며 별도 Codex 계정 런타임을 시작하지 않는다.
- OpenAI OAuth 토큰은 `~/.llm-router/opencode/data/opencode/auth.json`의 격리된 OpenCode 저장소에만 둔다. Codex CLI/IDE 세션을 공유하거나 수정하지 않는다.
- 사용량 대시보드: `usage/` 모듈이 모든 호출을 SQLite(`~/.llm-router/usage.db`)에 기록하고 `/dashboard`에서 웹으로 본다. 본문은 `LLM_ROUTER_LOG_BODIES=true`일 때만 저장한다. 데스크톱 앱이 아니라 라우터가 직접 서빙하는 웹 UI다.
- UI는 `연결 / LLM 서빙 / 대시보드` 메뉴를 갖는 흰색 데스크톱 콘솔이다. 프로필은 UI에서 추가·편집·삭제하며, 단일 Gateway가 요청의 `model` 값으로 프로필을 선택한다. 계정 한도는 읽기 전용이다.
- Agent Factory SDK는 수정하지 않는다. 기존 OpenAI 호환 HTTP LLM 프로필이 `http://127.0.0.1:8787/v1/chat/completions`와 라우터 프로필 이름을 사용하도록 llm-router 쪽에서 계약을 맞춘다.
- OpenAI OAuth 로그인·추론 경로는 `client -> llm-router -> OpenCode headless server -> OpenAI`다. 라우터가 격리된 앱 디렉터리에서 OpenCode를 지연 시작하고, 요청마다 임시 session/message를 사용해 Chat Completions로 변환한다. 프로젝트 config·외부 plugin·도구 권한·공유는 비활성화한다. OpenAI 요청의 `User-Agent`와 `originator`는 OpenCode 공식 내장 플러그인이 생성하며 라우터가 덮어쓰지 않는다. 부모 환경의 OpenAI endpoint/key 및 Bun/OpenCode 플러그인 override는 내부 런타임에 전달하지 않는다. OpenCode session API가 호출자 정의 tools를 투명하게 전달하지 못하므로 tools 요청은 명시적으로 거부하고, streaming은 완료 응답을 SSE로 버퍼링한다.
- AI Pro는 API key 프로필로 연결하되 직접 Python HTTP 어댑터로 호출하지 않는다. 격리된 번들 OpenCode에 `@ai-sdk/openai-compatible` custom provider를 구성하고 Endpoint·모델·API key 환경변수 참조만 넘긴다. `User-Agent`를 수동 설정하거나 위장하지 않으며 OpenCode가 자연스럽게 생성한 요청을 사용한다.
- 배포 wheel은 플랫폼별 공식 OpenCode 바이너리를 SHA-256 검증 후 포함하고 런타임에서 PATH보다 우선한다. macOS/Linux/Windows와 arm64/x64 wheel을 대상 플랫폼별로 빌드하며 x64는 baseline 바이너리를 사용한다. 절대 경로 `LLM_ROUTER_OPENCODE_BINARY`는 명시적 override다.
- Claude 계정 사용량은 현재 브라우저 OAuth 계정의 `GET /api/oauth/usage`만 읽고 5분 캐시한다. Admin key나 조직 구성원 API를 사용하지 않는다.
- OpenCode가 계정 한도 API를 공개하지 않는 동안 OpenAI 개인 계정 한도 카드는 미구성으로 표시하며, 이를 위해 별도 Codex 런타임으로 우회하지 않는다. 라우터를 통과한 토큰 사용량 집계는 유지한다.
- 로깅 실패는 추론 요청을 MUST 깨뜨리지 않는다. 사용량 기록 경로의 예외는 전부 삼킨다.
- Python HTTPS 요청은 기본 공개 CA에 `NODE_EXTRA_CA_CERTS`를 추가해 사내 TLS 검사 환경을 지원하며, 인증서 검증을 NEVER 비활성화한다.
- 구현이 진행되면 "여러 파일을 읽어야 보이는 큰 그림"만 여기에 갱신한다. 파일 트리 나열은 하지 않는다.

## 이 파일의 유지 규칙

이 파일은 모든 세션의 컨텍스트에 로드된다. 짧을수록 좋다.

- 코드를 읽으면 알 수 있는 내용은 쓰지 않는다. 명령어, 결정사항, 제약, 함정만 기록한다.
- 일반적인 개발 조언("테스트를 작성하라" 류)은 쓰지 않는다.
- 스택 선택·컨벤션·아키텍처 결정이 내려지면 그 턴에서 바로 이 파일을 갱신한다.
- 절대 규칙은 MUST/NEVER로 쓰고, 선호 사항은 "선호:"로 구분한다.
