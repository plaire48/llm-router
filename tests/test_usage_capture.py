import httpx
import respx

from llm_router.adapters import build_adapter
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.oauth import constants
from llm_router.translate import StreamTranslator

PROFILE = Profile(
    name="c",
    provider="anthropic",
    auth="api_key",
    api_key_env="ANTHROPIC_API_KEY",
    model="claude-sonnet-4-5",
)
OAI = Profile(
    name="g",
    provider="openai",
    auth="api_key",
    api_key_env="OPENAI_API_KEY",
    model="gpt-4o",
)


def test_translator_starts_with_no_usage():
    assert StreamTranslator(PROFILE).usage is None


def test_translator_accumulates_usage_without_emitting_chunks():
    translator = StreamTranslator(PROFILE)
    emitted = translator.feed(
        "message_start",
        {"message": {"usage": {"input_tokens": 11, "output_tokens": 0}}},
    )
    assert emitted == []
    translator.feed(
        "message_delta",
        {"delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 7}},
    )
    assert translator.usage == {
        "prompt_tokens": 11,
        "completion_tokens": 7,
        "total_tokens": 18,
    }


@respx.mock
async def test_anthropic_adapter_exposes_usage_non_stream(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "msg",
                "model": "claude-sonnet-4-5",
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": "hi"}],
                "usage": {"input_tokens": 3, "output_tokens": 4},
            },
        )
    )
    request = ChatCompletionRequest.model_validate(
        {"model": "c", "messages": [{"role": "user", "content": "hi"}]}
    )
    async with httpx.AsyncClient() as client:
        adapter = build_adapter(PROFILE, client)
        assert adapter.observed_usage is None
        await adapter.complete(request, PROFILE)
    assert adapter.observed_usage["total_tokens"] == 7


@respx.mock
async def test_anthropic_adapter_exposes_usage_from_stream(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    sse = (
        "event: message_start\n"
        'data: {"message":{"usage":{"input_tokens":5,"output_tokens":0}}}\n\n'
        "event: content_block_delta\n"
        'data: {"index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n'
        "event: message_delta\n"
        'data: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n'
    )
    respx.post(constants.ANTHROPIC_API_URL).mock(
        return_value=httpx.Response(200, text=sse, headers={"content-type": "text/event-stream"})
    )
    request = ChatCompletionRequest.model_validate(
        {
            "model": "c",
            "stream": True,
            "messages": [{"role": "user", "content": "hi"}],
        }
    )
    async with httpx.AsyncClient() as client:
        adapter = build_adapter(PROFILE, client)
        chunks = [line async for line in adapter.stream(request, PROFILE)]
    assert chunks[-1] == "data: [DONE]\n\n"
    assert adapter.observed_usage == {
        "prompt_tokens": 5,
        "completion_tokens": 9,
        "total_tokens": 14,
    }


@respx.mock
async def test_openai_adapter_usage_is_none_when_upstream_omits_it(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-oai")
    respx.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={"id": "x", "object": "chat.completion", "choices": []},
        )
    )
    request = ChatCompletionRequest.model_validate(
        {"model": "g", "messages": [{"role": "user", "content": "hi"}]}
    )
    async with httpx.AsyncClient() as client:
        adapter = build_adapter(OAI, client)
        await adapter.complete(request, OAI)
    assert adapter.observed_usage is None
