from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

from llm_router.credentials.base import Credential
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, ChatMessage, Profile

CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"


def _text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content)
    return "".join(
        part.get("text", "")
        for part in content
        if isinstance(part, dict) and part.get("type") in {"text", "input_text", "output_text"}
    )


def _message_content(message: ChatMessage) -> list[dict[str, Any]]:
    output_type = "output_text" if message.role == "assistant" else "input_text"
    if isinstance(message.content, str) or message.content is None:
        return [{"type": output_type, "text": _text(message.content)}]
    output: list[dict[str, Any]] = []
    for part in message.content:
        if not isinstance(part, dict):
            continue
        if part.get("type") in {"text", "input_text", "output_text"}:
            output.append({"type": output_type, "text": str(part.get("text", ""))})
        elif message.role == "user" and part.get("type") == "image_url":
            image = part.get("image_url")
            url = image.get("url") if isinstance(image, dict) else image
            if isinstance(url, str) and url:
                output.append({"type": "input_image", "image_url": url})
    return output or [{"type": output_type, "text": ""}]


def _tools(request: ChatCompletionRequest) -> list[dict[str, Any]] | None:
    if not request.tools or request.tool_choice == "none":
        return None
    output: list[dict[str, Any]] = []
    for tool in request.tools:
        function = tool.function
        output.append(
            {
                "type": "function",
                "name": function["name"],
                "description": function.get("description", ""),
                "parameters": function.get(
                    "parameters",
                    {"type": "object", "properties": {}},
                ),
                **({"strict": function["strict"]} if "strict" in function else {}),
            }
        )
    return output


def _tool_choice(choice: str | dict | None) -> str:
    return choice if isinstance(choice, str) and choice in {"none", "auto", "required"} else "auto"


def to_codex_response_request(request: ChatCompletionRequest, profile: Profile) -> dict[str, Any]:
    instructions: list[str] = []
    items: list[dict[str, Any]] = []
    for message in request.messages:
        if message.role in {"system", "developer"}:
            value = _text(message.content)
            if value:
                instructions.append(value)
            continue
        if message.role == "tool":
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": message.tool_call_id,
                    "output": _text(message.content),
                }
            )
            continue
        content = _message_content(message)
        if any(part.get("text") for part in content) or any(
            part.get("type") == "input_image" for part in content
        ):
            items.append(
                {
                    "type": "message",
                    "role": "assistant" if message.role == "assistant" else "user",
                    "content": content,
                }
            )
        if message.role == "assistant" and message.tool_calls:
            for call in message.tool_calls:
                items.append(
                    {
                        "type": "function_call",
                        "call_id": call.id,
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    }
                )

    body: dict[str, Any] = {
        "model": profile.model,
        "input": items,
        "store": False,
        "stream": True,
        "parallel_tool_calls": True,
        "tool_choice": _tool_choice(request.tool_choice),
    }
    if instructions:
        body["instructions"] = "\n\n".join(instructions)
    tools = _tools(request)
    if tools:
        body["tools"] = tools
    effort = profile.params.get("reasoning_effort")
    if isinstance(effort, str):
        body["reasoning"] = {"effort": effort}
    service_tier = profile.params.get("service_tier")
    if isinstance(service_tier, str):
        body["service_tier"] = service_tier
    return body


def _usage(response: dict[str, Any]) -> dict[str, int] | None:
    upstream = response.get("usage")
    if not isinstance(upstream, dict):
        return None
    prompt = upstream.get("input_tokens")
    completion = upstream.get("output_tokens")
    prompt = prompt if isinstance(prompt, int) else 0
    completion = completion if isinstance(completion, int) else 0
    total = upstream.get("total_tokens")
    total = total if isinstance(total, int) else prompt + completion
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
    }


class OpenAICodexAdapter:
    """Translate Chat Completions to the Responses stream used by ChatGPT Codex."""

    def __init__(self, client: httpx.AsyncClient, credential: Credential) -> None:
        self.client = client
        self.credential = credential
        self.observed_usage: dict[str, int] | None = None

    async def _events(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[dict[str, Any]]:
        headers = await self.credential.headers()
        body = to_codex_response_request(request, profile)
        async with self.client.stream(
            "POST",
            CODEX_RESPONSES_URL,
            json=body,
            headers=headers,
        ) as response:
            if response.status_code >= 400:
                await response.aread()
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line.removeprefix("data:").lstrip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise RouterError(
                        "OpenAI Codex returned invalid SSE data",
                        type="upstream_error",
                        code="invalid_upstream_response",
                        status_code=502,
                    ) from exc
                if not isinstance(event, dict):
                    raise RouterError(
                        "OpenAI Codex returned non-object SSE data",
                        type="upstream_error",
                        code="invalid_upstream_response",
                        status_code=502,
                    )
                if event.get("type") in {"error", "response.failed"}:
                    error = event.get("error")
                    if not isinstance(error, dict):
                        response_data = event.get("response")
                        error = (
                            response_data.get("error") if isinstance(response_data, dict) else None
                        )
                    message = error.get("message") if isinstance(error, dict) else None
                    raise RouterError(
                        message or "OpenAI Codex response failed",
                        type="upstream_error",
                        code="codex_response_failed",
                        status_code=502,
                    )
                yield event

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict:
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"
        text_parts: list[str] = []
        tool_calls: dict[str, dict[str, Any]] = {}
        item_to_call: dict[str, str] = {}
        response_data: dict[str, Any] = {}
        async for event in self._events(request, profile):
            event_type = event.get("type")
            if event_type == "response.created":
                response_data = event.get("response") or response_data
                response_id = response_data.get("id") if isinstance(response_data, dict) else None
                if isinstance(response_id, str):
                    completion_id = response_id
            elif event_type == "response.output_text.delta":
                delta = event.get("delta")
                if isinstance(delta, str):
                    text_parts.append(delta)
            elif event_type in {"response.output_item.added", "response.output_item.done"}:
                item = event.get("item")
                self._absorb_tool(tool_calls, item)
                if isinstance(item, dict) and item.get("type") == "function_call":
                    item_id = item.get("id")
                    if isinstance(item_id, str):
                        item_to_call[item_id] = self._call_id(item)
            elif event_type == "response.function_call_arguments.delta":
                raw_id = event.get("call_id") or event.get("item_id")
                call_id = item_to_call.get(raw_id, raw_id) if isinstance(raw_id, str) else None
                delta = event.get("delta")
                if isinstance(call_id, str) and isinstance(delta, str):
                    tool_calls.setdefault(call_id, self._empty_tool(call_id))["arguments"] += delta
            elif event_type == "response.function_call_arguments.done":
                raw_id = event.get("call_id") or event.get("item_id")
                call_id = item_to_call.get(raw_id, raw_id) if isinstance(raw_id, str) else None
                arguments = event.get("arguments")
                if isinstance(call_id, str) and isinstance(arguments, str):
                    tool_calls.setdefault(call_id, self._empty_tool(call_id))["arguments"] = (
                        arguments
                    )
            elif event_type == "response.completed":
                completed = event.get("response")
                if isinstance(completed, dict):
                    response_data = completed

        self.observed_usage = _usage(response_data)
        message: dict[str, Any] = {
            "role": "assistant",
            "content": "".join(text_parts) or None,
        }
        if tool_calls:
            message["tool_calls"] = [self._public_tool(item) for item in tool_calls.values()]
        finish_reason = "tool_calls" if tool_calls else self._finish_reason(response_data)
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": profile.name,
            "choices": [{"index": 0, "message": message, "finish_reason": finish_reason}],
            "usage": self.observed_usage
            or {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    async def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]:
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"
        created = int(time.time())
        tool_slots: dict[str, int] = {}
        tool_arguments: dict[str, str] = {}
        item_to_call: dict[str, str] = {}
        response_data: dict[str, Any] = {}

        def chunk(delta: dict[str, Any], finish_reason: str | None = None) -> str:
            payload = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": profile.name,
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
            }
            return f"data: {json.dumps(payload)}\n\n"

        yield chunk({"role": "assistant"})
        async for event in self._events(request, profile):
            event_type = event.get("type")
            if event_type == "response.created":
                created_response = event.get("response")
                if isinstance(created_response, dict):
                    response_data = created_response
                    response_id = created_response.get("id")
                    if isinstance(response_id, str):
                        completion_id = response_id
            elif event_type == "response.output_text.delta":
                delta = event.get("delta")
                if isinstance(delta, str):
                    yield chunk({"content": delta})
            elif event_type == "response.output_item.added":
                item = event.get("item")
                if isinstance(item, dict) and item.get("type") == "function_call":
                    call_id = self._call_id(item)
                    item_id = item.get("id")
                    if isinstance(item_id, str):
                        item_to_call[item_id] = call_id
                    slot = tool_slots.setdefault(call_id, len(tool_slots))
                    arguments = item.get("arguments")
                    tool_arguments[call_id] = arguments if isinstance(arguments, str) else ""
                    yield chunk(
                        {
                            "tool_calls": [
                                {
                                    "index": slot,
                                    "id": call_id,
                                    "type": "function",
                                    "function": {
                                        "name": item.get("name", ""),
                                        "arguments": "",
                                    },
                                }
                            ]
                        }
                    )
            elif event_type == "response.function_call_arguments.delta":
                raw_id = event.get("call_id") or event.get("item_id")
                call_id = item_to_call.get(raw_id, raw_id) if isinstance(raw_id, str) else None
                delta = event.get("delta")
                if isinstance(call_id, str) and isinstance(delta, str):
                    slot = tool_slots.setdefault(call_id, len(tool_slots))
                    tool_arguments[call_id] = tool_arguments.get(call_id, "") + delta
                    yield chunk({"tool_calls": [{"index": slot, "function": {"arguments": delta}}]})
            elif event_type == "response.output_item.done":
                item = event.get("item")
                if isinstance(item, dict) and item.get("type") == "function_call":
                    call_id = self._call_id(item)
                    full = item.get("arguments")
                    known = tool_arguments.get(call_id, "")
                    if isinstance(full, str) and full and not known:
                        slot = tool_slots.setdefault(call_id, len(tool_slots))
                        tool_arguments[call_id] = full
                        yield chunk(
                            {"tool_calls": [{"index": slot, "function": {"arguments": full}}]}
                        )
            elif event_type == "response.completed":
                completed = event.get("response")
                if isinstance(completed, dict):
                    response_data = completed

        self.observed_usage = _usage(response_data)
        yield chunk({}, "tool_calls" if tool_slots else self._finish_reason(response_data))
        if self.observed_usage is not None:
            usage_chunk = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": profile.name,
                "choices": [],
                "usage": self.observed_usage,
            }
            yield f"data: {json.dumps(usage_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    @staticmethod
    def _call_id(item: dict[str, Any]) -> str:
        value = item.get("call_id") or item.get("id")
        return value if isinstance(value, str) and value else f"call_{uuid.uuid4().hex}"

    @classmethod
    def _absorb_tool(
        cls,
        output: dict[str, dict[str, Any]],
        item: Any,
    ) -> None:
        if not isinstance(item, dict) or item.get("type") != "function_call":
            return
        call_id = cls._call_id(item)
        tool = output.setdefault(call_id, cls._empty_tool(call_id))
        if isinstance(item.get("name"), str):
            tool["name"] = item["name"]
        if isinstance(item.get("arguments"), str) and item["arguments"]:
            tool["arguments"] = item["arguments"]

    @staticmethod
    def _empty_tool(call_id: str) -> dict[str, Any]:
        return {"id": call_id, "name": "", "arguments": ""}

    @staticmethod
    def _public_tool(tool: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": tool["id"],
            "type": "function",
            "function": {"name": tool["name"], "arguments": tool["arguments"]},
        }

    @staticmethod
    def _finish_reason(response: dict[str, Any]) -> str:
        if response.get("status") == "incomplete":
            details = response.get("incomplete_details")
            if isinstance(details, dict) and details.get("reason") == "max_output_tokens":
                return "length"
        return "stop"
