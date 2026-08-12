# 사용량 대시보드 설계 문서

- 날짜: 2026-08-12
- 상태: 사용자 설계 승인 완료
- 선행: `2026-08-12-llm-router-design.md`(라우터 본체). 이 문서는 그 위에 얹는 기능이다.

## 1. 목표

라우터가 중계한 모든 호출의 **토큰 사용량과 이력**을 기록하고, 라우터가 직접 서빙하는 웹 대시보드에서 본다.

이 기능의 고유 가치는 위치에 있다. 라우터는 모든 제공자의 중간에 있으므로 **Claude·OpenAI·로컬 모델 사용량을 한 화면에서 가로질러 볼 수 있다.** 개별 제공자 대시보드는 이걸 못 한다.

성공 기준:

1. 추론 요청이 끝나면 토큰 수·지연시간·성공여부가 자동 기록된다(스트리밍 포함).
2. `http://localhost:<port>/dashboard`에서 프로필별·일자별 사용량과 최근 호출 목록을 본다.
3. **로깅 실패가 추론 요청을 절대 깨뜨리지 않는다.**

## 2. 확정된 결정

| 결정 | 선택 | 근거 |
|---|---|---|
| 배포 형태 | 라우터가 서빙하는 웹 UI | 데스크톱 앱 패키징·서명·자동업데이트 비용 0. 나중에 감쌀 수 있으므로 지금 결정을 미뤄도 손해가 없다 |
| 저장소 | SQLite (`~/.llm-router/usage.db`) | 집계 쿼리 필요, 표준 라이브러리라 의존성 추가 없음 |
| 기록 범위 | 메타데이터 기본 + 본문은 `.env` 플래그로 옵트인 | 프라이버시 안전이 기본, 에이전트 디버깅이 필요할 때만 본문 저장 |
| 첫 범위 | 사용량 집계 + 호출 이력 | 확실히 동작하는 것만. 비용 추정·구독 잔여량은 제외(§7) |
| 프론트엔드 | 외부 의존성 0, 단일 HTML | 오프라인 동작, CDN 불가 제약과 정합 |
| 인증 | 집계 API는 마스터 키 요구 | 실수로 `0.0.0.0` 바인딩해도 이력이 새지 않음 |

## 3. 아키텍처

```
POST /v1/chat/completions
    │
    ├─ recorder.start()  →  CallRecord(시작시각, 프로필, 제공자, 모델, stream)
    │
    ├─ adapter.complete() 또는 adapter.stream()
    │      └─ 어댑터가 관측한 usage를 self.observed_usage에 담음
    │
    └─ recorder.finish(record, adapter, response|error)  →  UsageStore.record()
                                                                  │
GET /dashboard ──────────────────────────────────────────────┐    ▼
GET /v1/usage/summary   ─── UsageStore.summary() ────────────┤  SQLite
GET /v1/usage/calls     ─── UsageStore.calls()   ────────────┤  calls 테이블
GET /v1/usage/calls/{id}─── UsageStore.call()    ────────────┘
```

기존 어댑터·변환기의 **출력 계약은 바뀌지 않는다.** 클라이언트가 보는 응답과 SSE 청크는 그대로다. 추가되는 것은 관측값을 밖으로 노출하는 통로뿐이다.

## 4. 구성 요소

### 4.1 `usage/store.py` — 저장소
- `CallRecord` 데이터클래스: 한 호출의 기록 단위.
- `UsageStore(path)`: 기동 시 스키마 생성, WAL 모드. 단일 커넥션 + `asyncio.Lock`으로 동시 요청 직렬화(로컬 단일 사용자 기준 INSERT는 마이크로초 단위라 충분).
- 메서드: `record()`, `summary(days)`, `calls(limit, offset, profile)`, `call(id)`, `close()`.

### 4.2 `usage/recorder.py` — 요청당 기록 조립
- `UsageRecorder(store, log_bodies)`. `store=None`이면 **완전한 no-op**(테스트·비활성화용).
- `start(profile, request) -> CallRecord`, `async finish(record, adapter, response=None, error=None)`.
- **모든 저장 호출은 예외를 삼킨다.** 로깅이 죽어도 추론은 정상 반환된다.

### 4.3 토큰 수집 (가장 까다로운 지점)
- **비스트리밍**: 응답 dict의 `usage`를 그대로 읽는다.
- **스트리밍(Anthropic)**: Anthropic은 입력 토큰을 `message_start`에, 출력 토큰을 `message_delta`에 나눠 보낸다. 현재 `StreamTranslator.feed()`는 `message_start`를 무시한다 → **번역기가 usage를 누적하고 `.usage` 프로퍼티로 노출**한다. 내보내는 청크는 변하지 않는다.
- **스트리밍(OpenAI 패스스루)**: 업스트림 청크에 `usage`가 있을 때만(클라이언트가 `stream_options.include_usage`를 보낸 경우) 잡힌다. 없으면 `null`로 정직하게 기록한다.
- 어댑터는 요청당 새로 생성되므로(`build_adapter`가 핸들러 안에서 호출) 인스턴스에 `observed_usage`를 담아도 안전하다.

### 4.4 `usage/routes.py` — API
FastAPI `APIRouter`로 분리해 `server.py`가 include한다.

| 엔드포인트 | 반환 |
|---|---|
| `GET /v1/usage/summary?days=N` | 일자×프로필 집계: 호출수, 입력·출력·합계 토큰, 에러수 |
| `GET /v1/usage/calls?limit&offset&profile` | 최근 호출 목록(본문 제외) |
| `GET /v1/usage/calls/{id}` | 단일 호출 상세(본문 로깅이 켜져 있었다면 본문 포함) |
| `GET /dashboard` | HTML 페이지 (인증 없음 — 정적 마크업일 뿐) |

집계 API 3종은 `/v1/*`과 동일한 마스터 키 의존성을 쓴다. `store`가 없으면 503 + 실행 가능한 안내.

### 4.5 `usage/dashboard.html` — 프론트엔드
단일 HTML, 인라인 CSS/JS, 외부 요청 0. 마스터 키를 한 번 입력받아 `sessionStorage`에 두고 API를 호출한다. 차트는 손으로 그린 인라인 SVG 막대(일자별 토큰). `prefers-color-scheme` 대응.

## 5. 데이터 스키마

```sql
CREATE TABLE calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at REAL NOT NULL,      -- unix timestamp
    duration_ms INTEGER,
    profile TEXT NOT NULL,         -- 클라이언트가 요청한 프로필 name
    provider TEXT NOT NULL,
    upstream_model TEXT NOT NULL,  -- 실제 호출된 업스트림 모델 id
    stream INTEGER NOT NULL,
    status INTEGER,
    ok INTEGER NOT NULL,
    error_code TEXT,
    error_message TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    request_body TEXT,             -- LLM_ROUTER_LOG_BODIES=true일 때만
    response_body TEXT
);
CREATE INDEX idx_calls_started_at ON calls(started_at DESC);
CREATE INDEX idx_calls_profile ON calls(profile);
```

## 6. 설정 추가

```
LLM_ROUTER_USAGE_DB=~/.llm-router/usage.db   # 기본값
LLM_ROUTER_LOG_BODIES=false                  # 기본값
```

## 7. 범위에서 제외 (근거 포함)

- **비용 추정** — 모델별 단가표를 계속 갱신해야 하고 틀리면 오히려 해롭다. 토큰 수는 기록하므로 나중에 얹기 쉽다.
- **구독 잔여량** — 구독(Pro/Max) 잔여 할당량을 알려주는 공식 API가 없다. `anthropic-ratelimit-*` 헤더가 구독 OAuth 경로에도 오는지는 미검증이다. 이건 구현이 아니라 **발견 작업**이므로 별도 스파이크로 다룬다.
- **로그 자동 삭제·보존기간** — 로컬 SQLite는 한동안 무한히 커져도 문제없다. 필요해지면 그때.

## 8. 알려진 한계

- 클라이언트가 스트리밍 도중 연결을 끊으면(`GeneratorExit`) 해당 호출 기록이 남지 않을 수 있다. 로컬 도구 기준 허용한다.
- OpenAI 패스스루 스트리밍은 클라이언트가 usage를 요청하지 않으면 토큰 수가 `null`이다. 대시보드는 이를 "미상"으로 표시한다.

## 9. 테스트 전략

- **단위**: 스키마 생성·INSERT·집계 쿼리, `StreamTranslator`의 usage 누적, 어댑터의 `observed_usage`, 레코더의 예외 삼킴(저장소가 던져도 요청 성공).
- **통합**: 실제 요청 1건 후 DB에 행이 생기는지(비스트리밍·스트리밍 각각), 에러 요청이 `ok=0`으로 기록되는지, 본문 플래그 on/off에 따라 본문 컬럼이 채워지는지.
- **API**: 인증 없는 접근 401, 집계·목록·상세 응답 모양.
