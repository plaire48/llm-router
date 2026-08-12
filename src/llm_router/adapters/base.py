from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol

from llm_router.models import ChatCompletionRequest, Profile


class Adapter(Protocol):
    observed_usage: dict | None

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict: ...

    def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]: ...
