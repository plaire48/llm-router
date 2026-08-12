from __future__ import annotations

import time
import uuid
from typing import Any

from llm_router.models import ChatCompletionRequest, Profile

_FINISH_REASONS = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "tool_use": "tool_calls",
}


def map_finish_reason(stop_reason: str | None) -> str | None:
    if stop_reason is None:
        return None
    return _FINISH_REASONS.get(stop_reason, "stop")


def _resolve_max_tokens(request: ChatCompletionRequest, profile: Profile) -> int:
    if request.max_tokens is not None:
        return request.max_tokens
    profile_default = profile.params.get("max_tokens")
    if profile_default is not None:
        return int(profile_default)
    return 4096


def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content)
    return "".join(
        part.get("text", "")
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )


def to_anthropic_request(request: ChatCompletionRequest, profile: Profile) -> dict:
    system_chunks: list[str] = []
    messages: list[dict] = []
    for message in request.messages:
        if message.role == "system":
            system_chunks.append(_content_to_text(message.content))
            continue
        messages.append({"role": message.role, "content": _content_to_text(message.content)})

    body: dict = {
        "model": profile.model,
        "messages": messages,
        "max_tokens": _resolve_max_tokens(request, profile),
    }
    system = "\n".join(chunk for chunk in system_chunks if chunk)
    if system:
        body["system"] = system
    if request.temperature is not None:
        body["temperature"] = request.temperature
    if request.top_p is not None:
        body["top_p"] = request.top_p
    if request.stop is not None:
        body["stop_sequences"] = (
            [request.stop] if isinstance(request.stop, str) else request.stop
        )
    if request.stream:
        body["stream"] = True

    for key, value in profile.params.items():
        if key != "max_tokens":
            body.setdefault(key, value)
    return body


def from_anthropic_response(data: dict, profile: Profile) -> dict:
    text_parts = [
        block.get("text", "")
        for block in data.get("content", [])
        if block.get("type") == "text"
    ]
    usage = data.get("usage", {}) or {}
    prompt_tokens = usage.get("input_tokens", 0)
    completion_tokens = usage.get("output_tokens", 0)
    return {
        "id": data.get("id", f"chatcmpl-{uuid.uuid4().hex}"),
        "object": "chat.completion",
        "created": int(time.time()),
        "model": profile.name,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "".join(text_parts)},
                "finish_reason": map_finish_reason(data.get("stop_reason")),
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


class StreamTranslator:
    def __init__(self, profile: Profile, completion_id: str | None = None) -> None:
        self.profile = profile
        self.id = completion_id or f"chatcmpl-{uuid.uuid4().hex}"
        self.created = int(time.time())
        self._tool_index: dict[int, int] = {}
        self._next_tool_slot = 0

    def _chunk(self, delta: dict, finish_reason: str | None = None) -> dict:
        return {
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.profile.name,
            "choices": [
                {
                    "index": 0,
                    "delta": delta,
                    "finish_reason": finish_reason,
                }
            ],
        }

    def start(self) -> dict:
        return self._chunk({"role": "assistant"})

    def feed(self, event_type: str, data: dict) -> list[dict]:
        if event_type == "content_block_delta":
            delta = data.get("delta", {})
            if delta.get("type") == "text_delta":
                return [self._chunk({"content": delta.get("text", "")})]
            return self._feed_tool_delta(data)
        if event_type == "content_block_start":
            return self._feed_tool_start(data)
        if event_type == "message_delta":
            stop_reason = (data.get("delta") or {}).get("stop_reason")
            if stop_reason is not None:
                return [self._chunk({}, finish_reason=map_finish_reason(stop_reason))]
        return []

    def _feed_tool_start(self, data: dict) -> list[dict]:
        return []

    def _feed_tool_delta(self, data: dict) -> list[dict]:
        return []
