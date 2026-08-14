from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, ChatMessage, Profile
from llm_router.opencode_runtime import OpenCodeRuntime


def _text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return str(content)
    return "".join(
        str(part.get("text", ""))
        for part in content
        if isinstance(part, dict) and part.get("type") in {"text", "input_text", "output_text"}
    )


def _history_line(message: ChatMessage) -> str:
    label = {
        "assistant": "Assistant",
        "developer": "Developer",
        "system": "System",
        "tool": "Tool",
        "user": "User",
    }.get(message.role, message.role.title())
    return f"{label}: {_text(message.content)}"


def to_opencode_prompt(request: ChatCompletionRequest, profile: Profile) -> dict[str, Any]:
    if request.tools or any(
        message.tool_calls or message.role == "tool" for message in request.messages
    ):
        raise RouterError(
            "OpenCode 내부 실행은 호출자 정의 tool_calls를 아직 지원하지 않습니다.",
            type="invalid_request_error",
            code="opencode_tools_unsupported",
            status_code=400,
        )
    if not request.messages:
        raise RouterError(
            "messages must contain at least one message",
            type="invalid_request_error",
            code="invalid_request",
            status_code=422,
        )

    system_messages = [
        _text(message.content)
        for message in request.messages
        if message.role in {"system", "developer"} and _text(message.content)
    ]
    conversation = [
        message for message in request.messages if message.role not in {"system", "developer"}
    ]
    current = conversation[-1] if conversation else request.messages[-1]
    history = conversation[:-1]
    system_parts = [
        (
            "You are serving a stateless OpenAI-compatible chat request. "
            "Answer the final message directly and do not access files, run commands, or use tools."
        )
    ]
    system_parts.extend(system_messages)
    if history:
        system_parts.append("Conversation history:\n" + "\n".join(map(_history_line, history)))

    prompt = _text(current.content)
    if current.role != "user":
        prompt = _history_line(current)
    return {
        "model": {"providerID": "openai", "modelID": profile.model},
        "system": "\n\n".join(system_parts),
        "parts": [{"type": "text", "text": prompt}],
    }


def _usage(info: dict[str, Any]) -> dict[str, int]:
    tokens = info.get("tokens")
    if not isinstance(tokens, dict):
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    prompt = tokens.get("input") if isinstance(tokens.get("input"), int) else 0
    output = tokens.get("output") if isinstance(tokens.get("output"), int) else 0
    reasoning = tokens.get("reasoning") if isinstance(tokens.get("reasoning"), int) else 0
    completion = output + reasoning
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
    }


class OpenCodeAdapter:
    """Execute OpenAI browser-account inference through an internal OpenCode session."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        runtime: OpenCodeRuntime,
    ) -> None:
        self.client = client
        self.runtime = runtime
        self.observed_usage: dict[str, int] | None = None

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict[str, Any]:
        body = to_opencode_prompt(request, profile)
        await self.runtime.ensure_started(self.client)
        body["tools"] = await self._disabled_tools()

        session_id: str | None = None
        try:
            created = await self._json_request(
                "POST",
                "/session",
                json={"title": "LLM Router request"},
            )
            candidate = created.get("id")
            if not isinstance(candidate, str) or not candidate:
                raise self._protocol_error("session id is missing")
            session_id = candidate
            result = await self._json_request(
                "POST",
                f"/session/{session_id}/message",
                json=body,
            )
        finally:
            if session_id is not None:
                try:
                    await self.client.delete(
                        f"{self.runtime.base_url}/session/{session_id}",
                        params={"directory": str(self.runtime.directory)},
                    )
                except httpx.HTTPError:
                    pass

        info = result.get("info")
        parts = result.get("parts")
        if not isinstance(info, dict) or not isinstance(parts, list):
            raise self._protocol_error("assistant message is invalid")
        if isinstance(info.get("error"), dict):
            error = info["error"]
            data = error.get("data")
            message = error.get("message")
            if not isinstance(message, str) and isinstance(data, dict):
                message = data.get("message")
            raise RouterError(
                message if isinstance(message, str) else "OpenCode model request failed.",
                type="upstream_error",
                code="opencode_response_failed",
                status_code=502,
            )
        content = "".join(
            str(part.get("text", ""))
            for part in parts
            if isinstance(part, dict) and part.get("type") == "text" and not part.get("ignored")
        )
        self.observed_usage = _usage(info)
        completion_id = info.get("id")
        if not isinstance(completion_id, str):
            completion_id = f"chatcmpl-{uuid.uuid4().hex}"
        finish = info.get("finish")
        finish_reason = "length" if finish == "length" else "stop"
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": profile.name,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": finish_reason,
                }
            ],
            "usage": self.observed_usage,
        }

    async def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]:
        response = await self.complete(request, profile)
        completion_id = response["id"]
        created = response["created"]
        content = response["choices"][0]["message"]["content"]

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
        if content:
            yield chunk({"content": content})
        yield chunk({}, response["choices"][0]["finish_reason"])
        yield f"data: {json.dumps({**response, 'object': 'chat.completion.chunk', 'choices': []})}\n\n"
        yield "data: [DONE]\n\n"

    async def _disabled_tools(self) -> dict[str, bool]:
        try:
            payload = await self._json_request("GET", "/experimental/tool/ids")
        except (RouterError, httpx.HTTPError):
            return {}
        tool_ids = payload.get("data") if isinstance(payload.get("data"), list) else payload
        if isinstance(tool_ids, list):
            return {str(tool_id): False for tool_id in tool_ids}
        return {}

    async def _json_request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = await self.client.request(
            method,
            f"{self.runtime.base_url}{path}",
            params={"directory": str(self.runtime.directory)},
            json=json,
        )
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as exc:
            raise self._protocol_error("response is not JSON") from exc
        if isinstance(payload, dict):
            return payload
        if isinstance(payload, list):
            return {"data": payload}
        raise self._protocol_error("response has an unsupported shape")

    @staticmethod
    def _protocol_error(detail: str) -> RouterError:
        return RouterError(
            f"OpenCode returned an invalid response: {detail}",
            type="upstream_error",
            code="invalid_opencode_response",
            status_code=502,
        )
