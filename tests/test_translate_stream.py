from llm_router.models import Profile
from llm_router.translate import StreamTranslator

PROFILE = Profile(
    name="claude-sonnet",
    provider="anthropic",
    auth="oauth",
    model="claude-sonnet-4-5",
)


def test_stream_text_sequence():
    translator = StreamTranslator(PROFILE, completion_id="chatcmpl-x")
    first = translator.start()
    assert first["choices"][0]["delta"] == {"role": "assistant"}
    assert first["object"] == "chat.completion.chunk"
    assert first["id"] == "chatcmpl-x"

    assert (
        translator.feed(
            "content_block_start",
            {"index": 0, "content_block": {"type": "text", "text": ""}},
        )
        == []
    )
    first_delta = translator.feed(
        "content_block_delta",
        {"index": 0, "delta": {"type": "text_delta", "text": "he"}},
    )
    second_delta = translator.feed(
        "content_block_delta",
        {"index": 0, "delta": {"type": "text_delta", "text": "llo"}},
    )
    assert first_delta[0]["choices"][0]["delta"] == {"content": "he"}
    assert second_delta[0]["choices"][0]["delta"] == {"content": "llo"}

    finish = translator.feed("message_delta", {"delta": {"stop_reason": "end_turn"}})
    assert finish[0]["choices"][0]["finish_reason"] == "stop"
    assert finish[0]["choices"][0]["delta"] == {}


def test_stream_ignores_unrelated_events():
    translator = StreamTranslator(PROFILE)
    assert translator.feed("message_start", {"message": {"id": "msg_1"}}) == []
    assert translator.feed("content_block_stop", {"index": 0}) == []
