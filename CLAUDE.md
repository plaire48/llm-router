# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

LLM Router — 구독 계정의 OAuth 로그인(Claude, OpenAI)과 사내 LLM을 하나의 localhost OpenAI 호환 Endpoint로 여는 로컬 게이트웨이.

- Claude·OpenAI: OAuth 로그인 기반으로 연다.
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
- Claude 구독 로그인과 추론은 공식 Claude Code CLI가 소유한다. 로그인은 `claude auth login`, 상태는 `claude auth status --json`, OAuth 프로필 추론은 안전 모드의 비대화식 CLI 출력을 OpenAI Chat Completions로 변환한다.
- Anthropic 구독 OAuth는 실제 계정으로 Messages·스트리밍·도구 호출을 검증하기 전까지 MUST 실험적으로 표시한다.
- OpenAI 구독 로그인은 공식 Codex CLI의 브라우저 OAuth 저장소를 사용한다. 추론은 ChatGPT Codex Responses 스트림을 Chat Completions로 변환하며, 토큰 refresh 계약은 공식 openai/codex 구현을 따른다.
- OAuth 토큰은 `~/.llm-router/credentials.json`에 0600으로 원자 저장하고, 만료 5분 전 동시 요청당 단일 refresh를 수행한다.
- 사용량 대시보드: `usage/` 모듈이 모든 호출을 SQLite(`~/.llm-router/usage.db`)에 기록하고 `/dashboard`에서 웹으로 본다. 본문은 `LLM_ROUTER_LOG_BODIES=true`일 때만 저장한다. 데스크톱 앱이 아니라 라우터가 직접 서빙하는 웹 UI다.
- UI는 `연결 / LLM 서빙 / 대시보드` 메뉴를 갖는 흰색 데스크톱 콘솔이다. 프로필은 UI에서 추가·편집·삭제하며, 단일 Gateway가 요청의 `model` 값으로 프로필을 선택한다. 계정 한도는 읽기 전용이다.
- Agent Factory SDK는 수정하지 않는다. 기존 OpenAI 호환 HTTP LLM 프로필이 `http://127.0.0.1:8787/v1/chat/completions`와 라우터 프로필 이름을 사용하도록 llm-router 쪽에서 계약을 맞춘다.
- Claude 계정 사용량은 현재 브라우저 OAuth 계정의 `GET /api/oauth/usage`만 읽고 5분 캐시한다. Admin key나 조직 구성원 API를 사용하지 않는다.
- OpenAI 계정 사용량은 공식 Codex app-server의 `account/rateLimits/read`와 `account/usage/read`를 사용한다. 두 공급자 모두 연결된 개인 한 명의 한도/활동만 표시한다.
- 로깅 실패는 추론 요청을 MUST 깨뜨리지 않는다. 사용량 기록 경로의 예외는 전부 삼킨다.
- 구현이 진행되면 "여러 파일을 읽어야 보이는 큰 그림"만 여기에 갱신한다. 파일 트리 나열은 하지 않는다.

## 이 파일의 유지 규칙

이 파일은 모든 세션의 컨텍스트에 로드된다. 짧을수록 좋다.

- 코드를 읽으면 알 수 있는 내용은 쓰지 않는다. 명령어, 결정사항, 제약, 함정만 기록한다.
- 일반적인 개발 조언("테스트를 작성하라" 류)은 쓰지 않는다.
- 스택 선택·컨벤션·아키텍처 결정이 내려지면 그 턴에서 바로 이 파일을 갱신한다.
- 절대 규칙은 MUST/NEVER로 쓰고, 선호 사항은 "선호:"로 구분한다.
