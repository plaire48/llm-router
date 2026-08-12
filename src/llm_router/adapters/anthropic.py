from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from llm_router.credentials.base import Credential
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.oauth import constants
from llm_router.translate import (
    StreamTranslator,
    from_anthropic_response,
    to_anthropic_request,
)


class AnthropicAdapter:
    def __init__(self, client: httpx.AsyncClient, credential: Credential) -> None:
        self.client = client
        self.credential = credential

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict:
        headers = await self.credential.headers()
        body = to_anthropic_request(request, profile)
        body["stream"] = False
        response = await self.client.post(constants.ANTHROPIC_API_URL, json=body, headers=headers)
        response.raise_for_status()
        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            raise RouterError(
                "Anthropic returned invalid JSON",
                type="upstream_error",
                code="invalid_upstream_response",
                status_code=502,
            ) from exc
        return from_anthropic_response(data, profile)

    async def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]:
        headers = await self.credential.headers()
        body = to_anthropic_request(request, profile)
        body["stream"] = True
        translator = StreamTranslator(profile)
        yield f"data: {json.dumps(translator.start())}\n\n"
        async with self.client.stream(
            "POST",
            constants.ANTHROPIC_API_URL,
            json=body,
            headers=headers,
        ) as response:
            response.raise_for_status()
            event_type: str | None = None
            async for line in response.aiter_lines():
                if line.startswith("event:"):
                    event_type = line.removeprefix("event:").strip()
                    continue
                if not line.startswith("data:") or event_type is None:
                    continue
                try:
                    data = json.loads(line.removeprefix("data:").lstrip())
                except json.JSONDecodeError as exc:
                    raise RouterError(
                        "Anthropic returned invalid SSE data",
                        type="upstream_error",
                        code="invalid_upstream_response",
                        status_code=502,
                    ) from exc
                for chunk in translator.feed(event_type, data):
                    yield f"data: {json.dumps(chunk)}\n\n"
        yield "data: [DONE]\n\n"
