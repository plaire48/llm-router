# Fix: 스트리밍 중 업스트림 에러가 엔드포인트를 크래시시킴

> **For Codex:** 이 문서 하나만 읽고 수정 가능하도록 작성됐다. 단일 태스크, TDD 순서(실패 테스트 → 수정 → 통과 → 커밋).

**심각도:** 중대 (스트리밍이 기본 사용 모드이고, 토큰 만료·레이트 리밋·과부하가 전부 이 경로로 들어온다)

## 증상

스트리밍 요청(`"stream": true`) 중 업스트림이 4xx/5xx를 반환하면 `httpx.ResponseNotRead`가 발생하며 엔드포인트 전체가 크래시한다. 클라이언트는 에러 페이로드조차 받지 못하고 스트림이 끊긴다. 비스트리밍 경로는 정상 동작한다.

재현 결과(2026-08-12 확인):

| 경로 | 실제 동작 |
|---|---|
| 비스트리밍 + 업스트림 429 | 정상 — HTTP 429 + OpenAI 에러 포맷 |
| 스트리밍 + 업스트림 429 | `ResponseNotRead` 크래시 |

## 원인

1. `adapters/anthropic.py`의 `stream()`이 `client.stream()` 컨텍스트 안에서 `response.raise_for_status()`를 호출한다. 이 시점에 응답 본문은 아직 읽히지 않았다.
2. `HTTPStatusError`가 `server.py`의 `_upstream_status_error()`로 전달되고, 거기서 `exc.response.text`에 접근한다.
3. httpx는 읽지 않은 스트리밍 응답의 `.text` 접근에 `ResponseNotRead`를 던진다.
4. 이 예외는 `generate()`의 `except httpx.HTTPStatusError` **핸들러 내부**에서 발생하므로, 바로 아래 `except Exception` 절이 잡지 못하고 제너레이터 밖으로 전파된다.

`adapters/openai.py`의 `stream()`도 동일한 패턴이므로 같은 버그를 가진다.

## 수정

### 1. `src/llm_router/adapters/anthropic.py` — 근본 수정

`stream()` 내부, `async with self.client.stream(...) as response:` 바로 다음 줄의 `response.raise_for_status()`를 아래로 교체한다.

```python
            if response.status_code >= 400:
                await response.aread()
            response.raise_for_status()
```

### 2. `src/llm_router/adapters/openai.py` — 동일 수정

`stream()` 내부의 `response.raise_for_status()`를 위와 같은 3줄로 교체한다.

### 3. `src/llm_router/server.py` — 방어적 보강

`_upstream_status_error()`가 어떤 경로로 들어와도 죽지 않도록 한다.

```python
def _upstream_status_error(exc: httpx.HTTPStatusError) -> RouterError:
    try:
        detail = exc.response.text
    except httpx.ResponseNotRead:
        detail = f"HTTP {exc.response.status_code}"
    return RouterError(
        f"upstream error: {detail}",
        type="upstream_error",
        code="upstream_error",
        status_code=exc.response.status_code,
    )
```

## 회귀 테스트

기존 관례(`SETTINGS`, `REGISTRY`, `AUTH`, `_client()`)를 그대로 쓴다.

- [ ] **Step 1: 실패 테스트 추가** — `tests/test_server.py` 끝에 추가

```python
@respx.mock
def test_streaming_upstream_error_emits_sse_error_instead_of_crashing(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(429, json={"error": {"message": "rate limited"}})
    )
    with _client() as client:
        with client.stream(
            "POST",
            "/v1/chat/completions",
            headers=AUTH,
            json={
                "model": "c",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        ) as response:
            body = b"".join(response.iter_bytes()).decode()

    assert body.rstrip().endswith("data: [DONE]")
    first_payload = json.loads(body.split("data: ", 1)[1].split("\n\n", 1)[0])
    assert first_payload["error"]["type"] == "upstream_error"
    assert "rate limited" in first_payload["error"]["message"]
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_server.py::test_streaming_upstream_error_emits_sse_error_instead_of_crashing -v`
Expected: FAIL — `httpx.ResponseNotRead: Attempted to access streaming response content, without having called read().`

- [ ] **Step 3: 위 수정 1·2·3 적용**

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest -q && ruff check src tests && ruff format --check src tests`
Expected: 전체 PASS (기존 61개 + 신규 1개 = 62개).

- [ ] **Step 5: 커밋**

```bash
git add src/llm_router/adapters/anthropic.py src/llm_router/adapters/openai.py \
        src/llm_router/server.py tests/test_server.py
git commit -m "fix: read upstream body before raising on streaming errors"
```

## 참고: 왜 기존 테스트가 이걸 못 잡았나

`test_upstream_status_is_preserved_in_openai_error`(비스트리밍 에러)와 `test_streaming_completion_is_sse`(스트리밍 정상)는 있지만 **"스트리밍 × 에러"** 조합이 없었다. 위 회귀 테스트가 그 칸을 채운다.
