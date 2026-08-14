from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx

from llm_router.aipro import is_aipro_profile
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, ChatMessage, Profile, ToolDef
from llm_router.opencode_runtime import OpenCodeRuntime
from llm_router.opencode_tool_bridge import BridgeCall, BridgeContext, OpenCodeToolBridge

TOOL_COMPLETION_TIMEOUT_SECONDS = 600.0


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
    content = _text(message.content)
    if message.tool_calls:
        calls = ", ".join(
            f"{call.function.name}({call.function.arguments})" for call in message.tool_calls
        )
        content = f"{content}\nTool calls: {calls}" if content else f"Tool calls: {calls}"
    if message.role == "tool" and message.tool_call_id:
        return f"{label} ({message.tool_call_id}): {content}"
    return f"{label}: {content}"


def _model_reference(profile: Profile) -> tuple[str, str]:
    if not is_aipro_profile(profile):
        return "openai", profile.model
    return OpenCodeRuntime.provider_id(profile), profile.model


def _selected_tools(request: ChatCompletionRequest) -> list[ToolDef]:
    tools = request.tools or []
    if request.tool_choice == "none":
        return []
    choice = request.tool_choice
    if not isinstance(choice, dict):
        return tools
    function = choice.get("function")
    name = function.get("name") if isinstance(function, dict) else None
    if not isinstance(name, str):
        return tools
    selected = [tool for tool in tools if tool.function.get("name") == name]
    if not selected:
        raise RouterError(
            f"tool_choice references an unknown function: {name}",
            type="invalid_request_error",
            code="invalid_tool_choice",
            status_code=422,
        )
    return selected


def _has_trailing_tool_results(request: ChatCompletionRequest) -> bool:
    return bool(request.messages and request.messages[-1].role == "tool")


def to_opencode_prompt(request: ChatCompletionRequest, profile: Profile) -> dict[str, Any]:
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
    if _selected_tools(request):
        tool_instruction = (
            "Only use the caller-provided functions when a function is needed. "
            "Do not access files, run shell commands, or use any other tools."
        )
        if request.tool_choice == "required" or isinstance(request.tool_choice, dict):
            tool_instruction += " You must call one of the available caller-provided functions."
        system_parts = [tool_instruction]
    else:
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
    provider_id, model_id = _model_reference(profile)
    return {
        "model": {"providerID": provider_id, "modelID": model_id},
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


def _assistant_message(messages: list[Any]) -> dict[str, Any] | None:
    candidates = [
        message
        for message in messages
        if isinstance(message, dict)
        and isinstance(message.get("info"), dict)
        and message["info"].get("role") == "assistant"
    ]
    if not candidates:
        return None

    def order(message: dict[str, Any]) -> tuple[int, str]:
        info = message["info"]
        timestamp = info.get("time")
        created = timestamp.get("created", 0) if isinstance(timestamp, dict) else 0
        return (created if isinstance(created, int) else 0, str(info.get("id", "")))

    return max(candidates, key=order)


class OpenCodeAdapter:
    """Execute OAuth and AI Pro inference through a router-owned OpenCode server."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        runtime: OpenCodeRuntime,
        tool_bridge: OpenCodeToolBridge | None = None,
    ) -> None:
        self.client = client
        self.runtime = runtime
        bridge = tool_bridge or getattr(runtime, "tool_bridge", None)
        if bridge is None:
            bridge = OpenCodeToolBridge(getattr(runtime, "directory", "."))
            try:
                runtime.tool_bridge = bridge
            except AttributeError:
                pass
        self.tool_bridge = bridge
        self.observed_usage: dict[str, int] | None = None

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict[str, Any]:
        await self.runtime.ensure_profile(self.client, profile)
        if _has_trailing_tool_results(request):
            return await self._resume_tool_completion(request, profile)
        body = to_opencode_prompt(request, profile)
        tools = _selected_tools(request)
        if tools:
            return await self._start_tool_completion(body, tools, profile)
        return await self._plain_completion(body, profile)

    async def _plain_completion(
        self,
        body: dict[str, Any],
        profile: Profile,
    ) -> dict[str, Any]:
        body["tools"] = await self._disabled_tools()
        session_id: str | None = None
        try:
            session_id = await self._create_session()
            result = await self._json_request(
                "POST",
                f"/session/{session_id}/message",
                json=body,
            )
            return self._final_response(result, profile)
        finally:
            if session_id is not None:
                await self._delete_session(session_id)

    async def _start_tool_completion(
        self,
        body: dict[str, Any],
        tools: list[ToolDef],
        profile: Profile,
    ) -> dict[str, Any]:
        session_id = await self._create_session()
        context: BridgeContext | None = None
        keep_session = False
        try:
            context = await self.tool_bridge.create(
                tools,
                session_id=session_id,
                profile_name=profile.name,
            )
            await self._register_mcp(context)
            permissions = await self._disabled_tools()
            permissions.update({tool_id: True for tool_id in context.opencode_tool_ids})
            body["tools"] = permissions
            await self._prompt_async(session_id, body)
            result, calls = await self._wait_for_tool_or_answer(context)
            if calls:
                keep_session = True
                return self._tool_response(result, calls, profile)
            return self._final_response(result, profile)
        finally:
            if not keep_session:
                if context is not None:
                    await self._cleanup_context(context)
                else:
                    await self._delete_session(session_id)

    async def _resume_tool_completion(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> dict[str, Any]:
        context, messages = await self.tool_bridge.context_for_results(
            request.messages,
            profile_name=profile.name,
        )
        if context.expired(self.tool_bridge.tool_timeout):
            await self._cleanup_context(context)
            raise RouterError(
                "The OpenCode tool session expired before its results were returned.",
                type="invalid_request_error",
                code="opencode_tool_session_expired",
                status_code=409,
            )
        keep_session = False
        try:
            await self.tool_bridge.submit_results(context, messages)
            result, calls = await self._wait_for_tool_or_answer(context)
            if calls:
                keep_session = True
                return self._tool_response(result, calls, profile)
            return self._final_response(result, profile)
        finally:
            if not keep_session:
                await self._cleanup_context(context)

    async def _wait_for_tool_or_answer(
        self,
        context: BridgeContext,
    ) -> tuple[dict[str, Any], list[BridgeCall]]:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + TOOL_COMPLETION_TIMEOUT_SECONDS
        latest: dict[str, Any] = {"info": {}, "parts": []}
        while loop.time() < deadline:
            calls = await self.tool_bridge.new_calls(context)
            payload = await self._json_request("GET", f"/session/{context.session_id}/message")
            data = payload.get("data")
            assistant = _assistant_message(data if isinstance(data, list) else [])
            if assistant is not None:
                latest = assistant
                self._raise_message_error(latest)
            if calls:
                return latest, calls
            info = latest.get("info")
            finish = info.get("finish") if isinstance(info, dict) else None
            if isinstance(finish, str) and finish not in {"tool-calls", "unknown"}:
                return latest, []
            await asyncio.sleep(0.05)
        raise RouterError(
            "OpenCode timed out while waiting for a model answer or tool call.",
            type="upstream_error",
            code="opencode_tool_timeout",
            status_code=504,
        )

    async def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]:
        response = await self.complete(request, profile)
        completion_id = response["id"]
        created = response["created"]
        message = response["choices"][0]["message"]

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
        if message.get("content"):
            yield chunk({"content": message["content"]})
        if message.get("tool_calls"):
            yield chunk(
                {
                    "tool_calls": [
                        {"index": index, **tool_call}
                        for index, tool_call in enumerate(message["tool_calls"])
                    ]
                }
            )
        yield chunk({}, response["choices"][0]["finish_reason"])
        yield f"data: {json.dumps({**response, 'object': 'chat.completion.chunk', 'choices': []})}\n\n"
        yield "data: [DONE]\n\n"

    async def _create_session(self) -> str:
        created = await self._json_request(
            "POST",
            "/session",
            json={"title": "LLM Router request"},
        )
        candidate = created.get("id")
        if not isinstance(candidate, str) or not candidate:
            raise self._protocol_error("session id is missing")
        return candidate

    async def _register_mcp(self, context: BridgeContext) -> None:
        payload = await self._json_request(
            "POST",
            "/mcp",
            json={"name": context.mcp_name, "config": self.tool_bridge.mcp_config(context)},
        )
        status = payload.get(context.mcp_name)
        if not isinstance(status, dict) or status.get("status") != "connected":
            detail = status.get("error") if isinstance(status, dict) else None
            raise RouterError(
                "OpenCode could not start the caller-tool MCP bridge."
                + (f" {detail}" if isinstance(detail, str) else ""),
                type="upstream_error",
                code="opencode_mcp_bridge_failed",
                status_code=502,
            )

    async def _prompt_async(self, session_id: str, body: dict[str, Any]) -> None:
        response = await self.client.post(
            f"{self.runtime.base_url}/session/{session_id}/prompt_async",
            params={"directory": str(self.runtime.directory)},
            json=body,
        )
        response.raise_for_status()

    async def _cleanup_context(self, context: BridgeContext) -> None:
        try:
            await self.client.post(
                f"{self.runtime.base_url}/session/{context.session_id}/abort",
                params={"directory": str(self.runtime.directory)},
            )
        except httpx.HTTPError:
            pass
        try:
            await self.client.post(
                f"{self.runtime.base_url}/mcp/{context.mcp_name}/disconnect",
                params={"directory": str(self.runtime.directory)},
            )
        except httpx.HTTPError:
            pass
        await self._delete_session(context.session_id)
        await self.tool_bridge.discard(context)

    async def _delete_session(self, session_id: str) -> None:
        try:
            await self.client.delete(
                f"{self.runtime.base_url}/session/{session_id}",
                params={"directory": str(self.runtime.directory)},
            )
        except httpx.HTTPError:
            pass

    def _final_response(self, result: dict[str, Any], profile: Profile) -> dict[str, Any]:
        self._raise_message_error(result)
        info = result.get("info")
        parts = result.get("parts")
        if not isinstance(info, dict) or not isinstance(parts, list):
            raise self._protocol_error("assistant message is invalid")
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

    def _tool_response(
        self,
        result: dict[str, Any],
        calls: list[BridgeCall],
        profile: Profile,
    ) -> dict[str, Any]:
        info = result.get("info")
        parts = result.get("parts")
        if not isinstance(info, dict):
            info = {}
        if not isinstance(parts, list):
            parts = []
        content = "".join(
            str(part.get("text", ""))
            for part in parts
            if isinstance(part, dict) and part.get("type") == "text" and not part.get("ignored")
        )
        self.observed_usage = _usage(info)
        completion_id = info.get("id")
        if not isinstance(completion_id, str):
            completion_id = f"chatcmpl-{uuid.uuid4().hex}"
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": profile.name,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": content or None,
                        "tool_calls": [
                            {
                                "id": call.id,
                                "type": "function",
                                "function": {
                                    "name": call.name,
                                    "arguments": json.dumps(
                                        call.arguments,
                                        ensure_ascii=False,
                                        separators=(",", ":"),
                                    ),
                                },
                            }
                            for call in calls
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "usage": self.observed_usage,
        }

    @staticmethod
    def _raise_message_error(result: dict[str, Any]) -> None:
        info = result.get("info")
        if not isinstance(info, dict) or not isinstance(info.get("error"), dict):
            return
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
