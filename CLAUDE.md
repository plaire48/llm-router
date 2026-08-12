# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

LLM Router — 구독 계정의 OAuth 로그인(Claude, OpenAI)을 localhost 포트에 연결해, API key로 여는 서버처럼 LLM을 열어주는 로컬 게이트웨이.

- Claude·OpenAI: OAuth 로그인 기반으로 연다.
- 그 외 제공자: API key를 추가해서 열고 관리한다.
- OpenCrew 호환이 목표: OpenCrew(PyPI `opencrew`, Letta 기반 로컬 에이전트 런타임, Python 3.11+)는 Anthropic/OpenAI API key와 `provider/model` 표기로 LLM을 소비한다. 이 라우터가 발급한 로컬 key·엔드포인트를 OpenCrew에 그대로 꽂아 쓸 수 있어야 한다.
- API key는 .env로 관리하고, LLM은 프로필 형태로 관리할 수 있어야 한다.

현재 코드가 없는 초기 상태다. 아래 "미정" 섹션은 결정되는 즉시 채운다.

## 역할 분담 (MUST)

- Claude(Claude Code)는 계획·설계·명세·리뷰를 담당한다. 구현 코드를 직접 작성하지 않는다 (사용자가 명시적으로 요청한 경우만 예외).
- 구현(개발)은 Codex가 담당한다. 구현이 필요하면 Codex에 넘길 명세/프롬프트를 산출물로 만든다.

## 커뮤니케이션

- 대화와 설명은 한국어로 한다. 코드, 식별자, 커밋 메시지는 영어로 쓴다.

## 명령어 (미정)

스택이 정해지면 여기에 기록한다: 의존성 설치 / 로컬 실행 / 전체 테스트 / 단일 테스트 실행 / 린트·포맷.

## 아키텍처

승인된 설계 스펙: `docs/superpowers/specs/2026-08-12-llm-router-design.md` — 작업 전 반드시 읽는다.

- 스택: Python 3.11+ / FastAPI / httpx / Pydantic / typer.
- 형태: OpenAI 호환 표면(chat/completions·models·health) + 마스터 키 인증 + model명→프로필 라우팅 + provider 어댑터. Anthropic은 OAuth/API key 겸용·포맷 변환. OpenAI는 OAuth(구독)/API key 겸용 — 구독 OAuth가 여는 API 형태는 스파이크(스펙 §7B)가 확정하며 chat↔Responses 변환이 필요할 수 있음. OpenAI호환은 패스스루.
- 미지수는 두 OAuth 경로뿐. 구현 전에 §7A(Claude·리스크 낮음)·§7B(OpenAI·리스크 높음) 스파이크로 각각 실제 구독 계정 검증이 선행된다.
- 구현이 진행되면 "여러 파일을 읽어야 보이는 큰 그림"만 여기에 갱신한다. 파일 트리 나열은 하지 않는다.

## 이 파일의 유지 규칙

이 파일은 모든 세션의 컨텍스트에 로드된다. 짧을수록 좋다.

- 코드를 읽으면 알 수 있는 내용은 쓰지 않는다. 명령어, 결정사항, 제약, 함정만 기록한다.
- 일반적인 개발 조언("테스트를 작성하라" 류)은 쓰지 않는다.
- 스택 선택·컨벤션·아키텍처 결정이 내려지면 그 턴에서 바로 이 파일을 갱신한다.
- 절대 규칙은 MUST/NEVER로 쓰고, 선호 사항은 "선호:"로 구분한다.
