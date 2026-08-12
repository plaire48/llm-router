from __future__ import annotations

import json
import os
import time
from collections.abc import AsyncIterator, Mapping
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import httpx

from llm_router.credentials.env_key import load_provider_env
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, ChatMessage, Profile

FABRIX_MESSAGE_PATH = "/openapi/chat/v1/messages"
FABRIX_PASS_FILTER_CODES = {"", "FR-200", "FR-201"}


def _message_url(endpoint: str) -> str:
    parts = urlsplit(endpoint)
    path = parts.path.rstrip("/")
    if not path.endswith(FABRIX_MESSAGE_PATH):
        path += FABRIX_MESSAGE_PATH
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def _field(payload: Mapping[str, Any], camel: str, snake: str, default: Any = None) -> Any:
    if camel in payload:
        return payload[camel]
    return payload.get(snake, default)


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, Mapping):
            value = item.get("text") or item.get("content")
            if isinstance(value, str):
                parts.append(value)
    return "\n".join(parts)


def _tool_calls(message: ChatMessage) -> str:
    if not message.tool_calls:
        return ""
    return "\n".join(
        f"{call.function.name}({call.function.arguments})" for call in message.tool_calls
    )


def _conversation(request: ChatCompletionRequest) -> tuple[str, str]:
    system_parts: list[str] = []
    messages: list[tuple[str, str]] = []
    for message in request.messages:
        content = _text(message.content)
        calls = _tool_calls(message)
        if calls:
            content = f"{content}\n{calls}".strip()
        if message.role in {"system", "developer"}:
            if content:
                system_parts.append(content)
        elif content:
            messages.append((message.role, content))
    if len(messages) == 1 and messages[0][0] == "user":
        prompt = messages[0][1]
    else:
        prompt = "\n\n".join(f"[{role.upper()}]\n{content}" for role, content in messages)
    return prompt, "\n\n".join(system_parts)


def _filter_details(payload: Mapping[str, Any]) -> tuple[str, str]:
    reason = _field(payload, "filterBlockReason", "filter_block_reason", {})
    if not isinstance(reason, Mapping):
        return "", ""
    code = str(_field(reason, "resultCode", "result_code", "") or "")
    message = str(reason.get("en") or reason.get("ko") or reason.get("message") or "")
    return code, message


def _validate_fabrix_payload(payload: Mapping[str, Any], *, require_content: bool) -> str:
    content = _field(payload, "content", "content", "")
    text = content if isinstance(content, str) else ""
    code, message = _filter_details(payload)
    if code not in FABRIX_PASS_FILTER_CODES and (not require_content or not text):
        detail = f"FabriX filter blocked the request ({code})."
        if message:
            detail += f" {message}"
        raise RouterError(
            detail,
            type="upstream_error",
            code="fabrix_filter_blocked",
            status_code=400,
        )
    status = str(_field(payload, "status", "status", "") or "")
    if status and status != "SUCCESS":
        raise RouterError(
            f"FabriX returned status '{status}'.",
            type="upstream_error",
            code="invalid_upstream_response",
            status_code=502,
        )
    if require_content and not text:
        raise RouterError(
            "FabriX response did not contain content.",
            type="upstream_error",
            code="invalid_upstream_response",
            status_code=502,
        )
    return text


class FabrixAdapter:
    """Translate the FabriX messages protocol to OpenAI Chat Completions."""

    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.observed_usage: dict | None = None

    def _headers(self, profile: Profile) -> dict[str, str]:
        load_provider_env()
        client_key = os.environ.get(profile.client_key_env or "", "").strip()
        api_token = os.environ.get(profile.api_key_env or "", "").strip()
        if not client_key or not api_token:
            raise RouterError(
                "FabriX Client Key and API Token are required.",
                type="authentication_error",
                code="missing_credential",
                status_code=401,
            )
        token = api_token if api_token.lower().startswith("bearer ") else f"Bearer {api_token}"
        return {
            "content-type": "application/json",
            "x-fabrix-client": client_key,
            "x-openapi-token": token,
        }

    def _body(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
        *,
        stream: bool,
    ) -> dict[str, Any]:
        prompt, system = _conversation(request)
        body: dict[str, Any] = {
            "modelIds": [profile.model],
            "contents": [prompt],
            "isStream": stream,
        }
        llm_config = dict(profile.params)
        if request.max_tokens is not None:
            llm_config["max_new_tokens"] = request.max_tokens
        if request.temperature is not None:
            llm_config["temperature"] = request.temperature
        if request.top_p is not None:
            llm_config["top_p"] = request.top_p
        if llm_config:
            body["llmConfig"] = llm_config
        if system:
            body["systemPrompt"] = system
        return body

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict:
        response = await self.client.post(
            _message_url(profile.base_url or ""),
            headers=self._headers(profile),
            json=self._body(request, profile, stream=False),
        )
        response.raise_for_status()
        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise RouterError(
                "FabriX returned invalid JSON.",
                type="upstream_error",
                code="invalid_upstream_response",
                status_code=502,
            ) from exc
        if not isinstance(payload, Mapping):
            raise RouterError(
                "FabriX returned a non-object response.",
                type="upstream_error",
                code="invalid_upstream_response",
                status_code=502,
            )
        content = _validate_fabrix_payload(payload, require_content=True)
        finish_reason = _field(payload, "finishReason", "finish_reason", "stop") or "stop"
        return {
            "id": f"chatcmpl-fabrix-{uuid4().hex}",
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
        }

    async def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]:
        completion_id = f"chatcmpl-fabrix-{uuid4().hex}"
        created = int(time.time())
        saw_finish = False
        async with self.client.stream(
            "POST",
            _message_url(profile.base_url or ""),
            headers=self._headers(profile),
            json=self._body(request, profile, stream=True),
        ) as response:
            if response.status_code >= 400:
                await response.aread()
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line.removeprefix("data:").strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise RouterError(
                        "FabriX returned invalid SSE data.",
                        type="upstream_error",
                        code="invalid_upstream_response",
                        status_code=502,
                    ) from exc
                if not isinstance(payload, Mapping):
                    continue
                _validate_fabrix_payload(payload, require_content=False)
                event_status = str(_field(payload, "eventStatus", "event_status", "") or "")
                if event_status != "CHUNK":
                    continue
                content = _field(payload, "content", "content", "")
                finish_reason = _field(payload, "finishReason", "finish_reason")
                if not isinstance(content, str):
                    content = ""
                if not content and finish_reason is None:
                    continue
                saw_finish = saw_finish or finish_reason is not None
                chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": profile.name,
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": content},
                            "finish_reason": finish_reason,
                        }
                    ],
                }
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
        if not saw_finish:
            final = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": profile.name,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(final, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
