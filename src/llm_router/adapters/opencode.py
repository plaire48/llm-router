from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import time
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any
from urllib.parse import unquote, urlsplit

import httpx

from llm_router.aipro import is_aipro_profile
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, ChatMessage, Profile, ToolDef
from llm_router.opencode_runtime import OpenCodeRuntime
from llm_router.opencode_tool_bridge import BridgeCall, BridgeContext, OpenCodeToolBridge

TOOL_COMPLETION_TIMEOUT_SECONDS = 600.0
FileResolver = Callable[[str], tuple[bytes, str, str] | None]

_AUDIO_MIME_TYPES = {
    "aac": "audio/aac",
    "flac": "audio/flac",
    "m4a": "audio/mp4",
    "mp3": "audio/mpeg",
    "mp4": "audio/mp4",
    "mpeg": "audio/mpeg",
    "mpga": "audio/mpeg",
    "ogg": "audio/ogg",
    "wav": "audio/wav",
    "webm": "audio/webm",
}


def _invalid_request(message: str, code: str = "invalid_request") -> RouterError:
    return RouterError(
        message,
        type="invalid_request_error",
        code=code,
        status_code=422,
    )


def _data_url_mime(url: str) -> str | None:
    if not url.startswith("data:"):
        return None
    header = url[5:].split(",", 1)[0]
    mime = header.split(";", 1)[0].strip()
    return mime or None


def _url_mime(url: str, fallback: str) -> str:
    embedded = _data_url_mime(url)
    if embedded:
        return embedded
    guessed, _ = mimetypes.guess_type(unquote(urlsplit(url).path))
    return guessed or fallback


def _url_value(value: Any) -> tuple[str | None, str | None]:
    if isinstance(value, str):
        return value, None
    if not isinstance(value, dict):
        return None, None
    url = value.get("url")
    filename = value.get("filename")
    return (
        url if isinstance(url, str) else None,
        filename if isinstance(filename, str) else None,
    )


def _file_part(
    *,
    url: str,
    mime: str,
    filename: str | None = None,
) -> dict[str, Any]:
    part: dict[str, Any] = {"type": "file", "mime": mime, "url": url}
    if filename:
        part["filename"] = filename
    return part


def _content_parts(
    content: Any,
    *,
    file_resolver: FileResolver | None = None,
) -> list[dict[str, Any]]:
    if content is None:
        return []
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if not isinstance(content, list):
        raise _invalid_request("message content must be text or a list of content parts")

    result: list[dict[str, Any]] = []
    for block in content:
        if not isinstance(block, dict):
            raise _invalid_request("message content parts must be objects")
        block_type = block.get("type")
        if block_type in {"text", "input_text", "output_text"}:
            text = block.get("text")
            if not isinstance(text, str):
                raise _invalid_request(f"{block_type} content requires text")
            result.append({"type": "text", "text": text})
            continue
        if block_type in {"image_url", "input_image", "video_url", "audio_url"}:
            field = "image_url" if block_type == "input_image" else str(block_type)
            url, filename = _url_value(block.get(field))
            if not url:
                raise _invalid_request(f"{block_type} content requires a URL")
            major = {
                "image_url": "image",
                "input_image": "image",
                "video_url": "video",
                "audio_url": "audio",
            }[str(block_type)]
            result.append(
                _file_part(
                    url=url,
                    mime=_url_mime(url, f"{major}/*"),
                    filename=filename,
                )
            )
            continue
        if block_type == "input_audio":
            audio = block.get("input_audio")
            if not isinstance(audio, dict) or not isinstance(audio.get("data"), str):
                raise _invalid_request("input_audio content requires base64 data")
            audio_format = str(audio.get("format", "wav")).lower()
            mime = _AUDIO_MIME_TYPES.get(audio_format, f"audio/{audio_format}")
            result.append(
                _file_part(
                    url=f"data:{mime};base64,{audio['data']}",
                    mime=mime,
                    filename=f"audio.{audio_format}",
                )
            )
            continue
        if block_type == "file":
            file = block.get("file")
            if not isinstance(file, dict):
                raise _invalid_request("file content requires a file object")
            file_data = file.get("file_data")
            filename = file.get("filename")
            if isinstance(file_data, str):
                result.append(
                    _file_part(
                        url=file_data,
                        mime=_url_mime(file_data, str(file.get("format") or "application/*")),
                        filename=filename if isinstance(filename, str) else None,
                    )
                )
                continue
            file_id = file.get("file_id")
            resolved = (
                file_resolver(file_id)
                if isinstance(file_id, str) and file_resolver is not None
                else None
            )
            if resolved is None:
                raise _invalid_request(
                    "file content references an unknown upload; upload it to /v1/files first",
                    "file_not_found",
                )
            data, stored_mime, stored_name = resolved
            mime = str(file.get("format") or stored_mime or "application/octet-stream")
            encoded = base64.b64encode(data).decode("ascii")
            result.append(
                _file_part(
                    url=f"data:{mime};base64,{encoded}",
                    mime=mime,
                    filename=(filename if isinstance(filename, str) else stored_name),
                )
            )
            continue
        raise _invalid_request(
            f"OpenCode does not support message content type {block_type!r}.",
            "unsupported_content_type",
        )
    return result


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
    choice = request.tool_choice
    if isinstance(choice, str) and choice not in {"auto", "none", "required"}:
        raise _invalid_request(
            f"unsupported tool_choice: {choice!r}",
            "invalid_tool_choice",
        )
    if choice == "required" and not tools:
        raise _invalid_request(
            "tool_choice='required' requires at least one function tool",
            "invalid_tool_choice",
        )
    if request.tool_choice == "none":
        return []
    if not isinstance(choice, dict):
        return tools
    function = choice.get("function")
    name = function.get("name") if isinstance(function, dict) else None
    if not isinstance(name, str):
        raise _invalid_request(
            "named tool_choice requires function.name",
            "invalid_tool_choice",
        )
    selected = [tool for tool in tools if tool.function.get("name") == name]
    if not selected:
        raise _invalid_request(
            f"tool_choice references an unknown function: {name}",
            "invalid_tool_choice",
        )
    return selected


def _requires_tool_call(request: ChatCompletionRequest) -> bool:
    return request.tool_choice == "required" or isinstance(request.tool_choice, dict)


def _opencode_format(request: ChatCompletionRequest) -> dict[str, Any] | None:
    response_format = request.response_format
    if response_format is None:
        return None
    format_type = response_format.get("type")
    if format_type == "text":
        return {"type": "text"}
    if format_type == "json_object":
        return {
            "type": "json_schema",
            "schema": {"type": "object", "additionalProperties": True},
        }
    if format_type != "json_schema":
        raise _invalid_request(
            f"unsupported response_format type: {format_type!r}",
            "invalid_response_format",
        )
    json_schema = response_format.get("json_schema")
    schema = json_schema.get("schema") if isinstance(json_schema, dict) else None
    if not isinstance(schema, dict):
        raise _invalid_request(
            "response_format json_schema requires json_schema.schema",
            "invalid_response_format",
        )
    return {"type": "json_schema", "schema": schema}


def _validate_generation_options(request: ChatCompletionRequest) -> None:
    unsupported: list[str] = []
    for name in ("temperature", "top_p", "max_tokens", "max_completion_tokens", "stop"):
        if getattr(request, name) is not None:
            unsupported.append(name)
    extras = request.model_extra or {}
    for name in ("frequency_penalty", "presence_penalty", "seed", "logit_bias", "logprobs"):
        if extras.get(name) is not None:
            unsupported.append(name)
    if unsupported:
        raise _invalid_request(
            "The OpenCode message API does not support these per-request generation options: "
            + ", ".join(unsupported),
            "unsupported_parameter",
        )


def _has_trailing_tool_results(request: ChatCompletionRequest) -> bool:
    return bool(request.messages and request.messages[-1].role == "tool")


def to_opencode_prompt(
    request: ChatCompletionRequest,
    profile: Profile,
    *,
    file_resolver: FileResolver | None = None,
) -> dict[str, Any]:
    if not request.messages:
        raise _invalid_request(
            "messages must contain at least one message",
        )
    _validate_generation_options(request)

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
        if _requires_tool_call(request):
            tool_instruction += " You must call one of the available caller-provided functions."
        if request.parallel_tool_calls is False:
            tool_instruction += " Call at most one function in this model step."
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

    prompt_parts = _content_parts(current.content, file_resolver=file_resolver)
    if current.role != "user":
        media = [part for part in prompt_parts if part["type"] == "file"]
        prompt_parts = [{"type": "text", "text": _history_line(current)}, *media]
    history_media = [
        part
        for message in history
        for part in _content_parts(message.content, file_resolver=file_resolver)
        if part["type"] == "file"
    ]
    if history_media:
        system_parts.append(
            "Media files from earlier conversation turns are attached to this request in "
            "chronological order."
        )
        prompt_parts.extend(history_media)
    if not prompt_parts:
        prompt_parts = [{"type": "text", "text": _history_line(current)}]
    provider_id, model_id = _model_reference(profile)
    body: dict[str, Any] = {
        "model": {"providerID": provider_id, "modelID": model_id},
        "system": "\n\n".join(system_parts),
        "parts": prompt_parts,
    }
    output_format = _opencode_format(request)
    if output_format is not None:
        body["format"] = output_format
    variant = (request.model_extra or {}).get("reasoning_effort") or profile.params.get(
        "reasoning_effort"
    )
    if isinstance(variant, str) and variant:
        body["variant"] = variant
    return body


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
        file_resolver: FileResolver | None = None,
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
        self.file_resolver = file_resolver
        self.observed_usage: dict[str, int] | None = None

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict[str, Any]:
        await self.runtime.ensure_profile(self.client, profile)
        if _has_trailing_tool_results(request):
            return await self._resume_tool_completion(request, profile)
        body = to_opencode_prompt(request, profile, file_resolver=self.file_resolver)
        tools = _selected_tools(request)
        if tools:
            return await self._start_tool_completion(body, tools, request, profile)
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
        except asyncio.CancelledError:
            if session_id is not None:
                await self._abort_session(session_id)
            raise
        finally:
            if session_id is not None:
                await self._delete_session(session_id)

    async def _start_tool_completion(
        self,
        body: dict[str, Any],
        tools: list[ToolDef],
        request: ChatCompletionRequest,
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
                if request.parallel_tool_calls is False and len(calls) > 1:
                    raise RouterError(
                        "OpenCode returned parallel tool calls while parallel_tool_calls=false.",
                        type="upstream_error",
                        code="parallel_tool_calls_not_allowed",
                        status_code=502,
                    )
                keep_session = True
                return self._tool_response(result, calls, profile)
            if _requires_tool_call(request):
                raise RouterError(
                    "OpenCode returned a final answer although tool_choice requires a function call.",
                    type="upstream_error",
                    code="required_tool_call_missing",
                    status_code=502,
                )
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
            error_name = self._message_error_name(latest)
            if error_name in {"MessageOutputLengthError", "ContentFilterError"} or (
                isinstance(finish, str) and finish not in {"tool-calls", "unknown"}
            ):
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
        await self._abort_session(context.session_id)
        try:
            await self.client.post(
                f"{self.runtime.base_url}/mcp/{context.mcp_name}/disconnect",
                params={"directory": str(self.runtime.directory)},
            )
        except httpx.HTTPError:
            pass
        await self._delete_session(context.session_id)
        await self.tool_bridge.discard(context)

    async def _abort_session(self, session_id: str) -> None:
        try:
            await self.client.post(
                f"{self.runtime.base_url}/session/{session_id}/abort",
                params={"directory": str(self.runtime.directory)},
            )
        except httpx.HTTPError:
            pass

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
        content = self._message_content(info, parts)
        self.observed_usage = _usage(info)
        completion_id = info.get("id")
        if not isinstance(completion_id, str):
            completion_id = f"chatcmpl-{uuid.uuid4().hex}"
        finish_reason = self._finish_reason(info)
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
    def _message_error_name(result: dict[str, Any]) -> str | None:
        info = result.get("info")
        if not isinstance(info, dict):
            return None
        error = info.get("error")
        return (
            error.get("name")
            if isinstance(error, dict) and isinstance(error.get("name"), str)
            else None
        )

    @classmethod
    def _raise_message_error(cls, result: dict[str, Any]) -> None:
        info = result.get("info")
        if not isinstance(info, dict) or not isinstance(info.get("error"), dict):
            return
        error = info["error"]
        name = error.get("name")
        if name in {"MessageOutputLengthError", "ContentFilterError"}:
            return
        data = error.get("data")
        message = error.get("message")
        if not isinstance(message, str) and isinstance(data, dict):
            message = data.get("message")
        status_code = 502
        error_type = "upstream_error"
        code = "opencode_response_failed"
        if name == "ProviderAuthError":
            status_code = 401
            error_type = "authentication_error"
            code = "provider_authentication_failed"
        elif name == "ContextOverflowError":
            status_code = 400
            error_type = "invalid_request_error"
            code = "context_length_exceeded"
        elif name == "StructuredOutputError":
            code = "structured_output_failed"
        elif name == "MessageAbortedError":
            status_code = 408
            code = "request_aborted"
        elif name == "APIError" and isinstance(data, dict):
            upstream_status = data.get("statusCode")
            if isinstance(upstream_status, int) and 400 <= upstream_status <= 599:
                status_code = upstream_status
            if status_code in {401, 403}:
                error_type = "authentication_error"
            elif status_code == 429:
                error_type = "rate_limit_error"
            code = "upstream_api_error"
        raise RouterError(
            message if isinstance(message, str) else "OpenCode model request failed.",
            type=error_type,
            code=code,
            status_code=status_code,
        )

    @staticmethod
    def _message_content(info: dict[str, Any], parts: list[Any]) -> str:
        if "structured" in info and info.get("structured") is not None:
            return json.dumps(
                info["structured"],
                ensure_ascii=False,
                separators=(",", ":"),
            )
        return "".join(
            str(part.get("text", ""))
            for part in parts
            if isinstance(part, dict) and part.get("type") == "text" and not part.get("ignored")
        )

    @staticmethod
    def _finish_reason(info: dict[str, Any]) -> str:
        error = info.get("error")
        error_name = error.get("name") if isinstance(error, dict) else None
        if info.get("finish") == "length" or error_name == "MessageOutputLengthError":
            return "length"
        if error_name == "ContentFilterError":
            return "content_filter"
        return "stop"

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
