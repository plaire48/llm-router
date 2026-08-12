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
