from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from llm_router.credentials.base import Credential
from llm_router.models import ChatCompletionRequest, Profile

DEFAULT_BASE_URL = "https://api.openai.com/v1"


class OpenAIAdapter:
    def __init__(self, client: httpx.AsyncClient, credential: Credential) -> None:
        self.client = client
        self.credential = credential

    def _url(self, profile: Profile) -> str:
        base_url = (profile.base_url or DEFAULT_BASE_URL).rstrip("/")
        return f"{base_url}/chat/completions"

    def _body(self, request: ChatCompletionRequest, profile: Profile) -> dict:
        body = request.model_dump(exclude_none=True, mode="json")
        body["model"] = profile.model
        return body

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict:
        headers = await self.credential.headers()
        body = self._body(request, profile)
        body["stream"] = False
        response = await self.client.post(self._url(profile), json=body, headers=headers)
        response.raise_for_status()
        data = response.json()
        data["model"] = profile.name
        return data

    async def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]:
        headers = await self.credential.headers()
        body = self._body(request, profile)
        body["stream"] = True
        saw_done = False
        async with self.client.stream(
            "POST",
            self._url(profile),
            json=body,
            headers=headers,
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                if line == "data: [DONE]":
                    saw_done = True
                    yield "data: [DONE]\n\n"
                    continue
                if line.startswith("data:"):
                    raw_data = line.removeprefix("data:").lstrip()
                    try:
                        chunk = json.loads(raw_data)
                    except json.JSONDecodeError:
                        yield f"{line}\n\n"
                        continue
                    chunk["model"] = profile.name
                    yield f"data: {json.dumps(chunk)}\n\n"
                    continue
                yield f"{line}\n\n"
        if not saw_done:
            yield "data: [DONE]\n\n"
