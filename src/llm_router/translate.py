from __future__ import annotations

import json
import time
import uuid
from typing import Any

from llm_router.errors import RouterError
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


def _openai_tools_to_anthropic(tools: list) -> list[dict]:
    output: list[dict] = []
    for tool in tools:
        function = tool.function if hasattr(tool, "function") else tool.get("function", {})
        output.append(
            {
                "name": function["name"],
                "description": function.get("description", ""),
                "input_schema": function.get("parameters", {"type": "object", "properties": {}}),
            }
        )
    return output


def _map_tool_choice(choice: str | dict | None) -> dict | None:
    if choice == "auto":
        return {"type": "auto"}
    if choice == "required":
        return {"type": "any"}
    if isinstance(choice, dict) and choice.get("type") == "function":
        return {"type": "tool", "name": choice["function"]["name"]}
    return None


def _parse_tool_arguments(arguments: str, tool_name: str) -> dict:
    try:
        value = json.loads(arguments or "{}")
    except json.JSONDecodeError as exc:
        raise RouterError(f"invalid JSON arguments for tool '{tool_name}': {exc.msg}") from exc
    if not isinstance(value, dict):
        raise RouterError(f"tool arguments for '{tool_name}' must be a JSON object")
    return value


def _content_as_blocks(content: str | list[dict]) -> list[dict]:
    if isinstance(content, list):
        return content
    return [{"type": "text", "text": content}]


def _append_message(messages: list[dict], role: str, content: str | list[dict]) -> None:
    if messages and messages[-1]["role"] == role:
        previous = _content_as_blocks(messages[-1]["content"])
        messages[-1]["content"] = previous + _content_as_blocks(content)
        return
    messages.append({"role": role, "content": content})


def to_anthropic_request(request: ChatCompletionRequest, profile: Profile) -> dict:
    system_chunks: list[str] = []
    messages: list[dict] = []
    for message in request.messages:
        if message.role in ("system", "developer"):
            system_chunks.append(_content_to_text(message.content))
            continue
        if message.role == "assistant" and message.tool_calls:
            blocks: list[dict] = []
            text = _content_to_text(message.content)
            if text:
                blocks.append({"type": "text", "text": text})
            for tool_call in message.tool_calls:
                blocks.append(
                    {
                        "type": "tool_use",
                        "id": tool_call.id,
                        "name": tool_call.function.name,
                        "input": _parse_tool_arguments(
                            tool_call.function.arguments, tool_call.function.name
                        ),
                    }
                )
            _append_message(messages, "assistant", blocks)
            continue
        if message.role == "tool":
            _append_message(
                messages,
                "user",
                [
                    {
                        "type": "tool_result",
                        "tool_use_id": message.tool_call_id,
                        "content": _content_to_text(message.content),
                    }
                ],
            )
            continue
        _append_message(messages, message.role, _content_to_text(message.content))

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
        body["stop_sequences"] = [request.stop] if isinstance(request.stop, str) else request.stop
    if request.stream:
        body["stream"] = True
    if request.tools and request.tool_choice != "none":
        body["tools"] = _openai_tools_to_anthropic(request.tools)
        tool_choice = _map_tool_choice(request.tool_choice)
        if tool_choice is not None:
            body["tool_choice"] = tool_choice

    for key, value in profile.params.items():
        if key != "max_tokens":
            body.setdefault(key, value)
    return body


def from_anthropic_response(data: dict, profile: Profile) -> dict:
    text_parts: list[str] = []
    tool_calls: list[dict] = []
    for block in data.get("content", []):
        if block.get("type") == "text":
            text_parts.append(block.get("text", ""))
        elif block.get("type") == "tool_use":
            tool_calls.append(
                {
                    "id": block.get("id"),
                    "type": "function",
                    "function": {
                        "name": block.get("name"),
                        "arguments": json.dumps(block.get("input", {})),
                    },
                }
            )
    message: dict = {"role": "assistant", "content": "".join(text_parts) or None}
    if tool_calls:
        message["tool_calls"] = tool_calls

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
                "message": message,
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
        self._prompt_tokens: int | None = None
        self._completion_tokens: int | None = None

    @property
    def usage(self) -> dict[str, int] | None:
        if self._prompt_tokens is None and self._completion_tokens is None:
            return None
        prompt = self._prompt_tokens or 0
        completion = self._completion_tokens or 0
        return {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
        }

    def _absorb_usage(self, usage: dict | None) -> None:
        if not isinstance(usage, dict):
            return
        if isinstance(usage.get("input_tokens"), int):
            self._prompt_tokens = usage["input_tokens"]
        if isinstance(usage.get("output_tokens"), int):
            self._completion_tokens = usage["output_tokens"]

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
        if event_type == "message_start":
            self._absorb_usage((data.get("message") or {}).get("usage"))
            return []
        if event_type == "content_block_delta":
            delta = data.get("delta", {})
            if delta.get("type") == "text_delta":
                return [self._chunk({"content": delta.get("text", "")})]
            return self._feed_tool_delta(data)
        if event_type == "content_block_start":
            return self._feed_tool_start(data)
        if event_type == "message_delta":
            self._absorb_usage(data.get("usage"))
            stop_reason = (data.get("delta") or {}).get("stop_reason")
            if stop_reason is not None:
                return [self._chunk({}, finish_reason=map_finish_reason(stop_reason))]
        return []

    def _feed_tool_start(self, data: dict) -> list[dict]:
        block = data.get("content_block", {})
        if block.get("type") != "tool_use":
            return []
        anthropic_index = data.get("index", 0)
        slot = self._next_tool_slot
        self._tool_index[anthropic_index] = slot
        self._next_tool_slot += 1
        return [
            self._chunk(
                {
                    "tool_calls": [
                        {
                            "index": slot,
                            "id": block.get("id"),
                            "type": "function",
                            "function": {
                                "name": block.get("name"),
                                "arguments": "",
                            },
                        }
                    ]
                }
            )
        ]

    def _feed_tool_delta(self, data: dict) -> list[dict]:
        delta = data.get("delta", {})
        if delta.get("type") != "input_json_delta":
            return []
        slot = self._tool_index.get(data.get("index", 0), 0)
        return [
            self._chunk(
                {
                    "tool_calls": [
                        {
                            "index": slot,
                            "function": {"arguments": delta.get("partial_json", "")},
                        }
                    ]
                }
            )
        ]
