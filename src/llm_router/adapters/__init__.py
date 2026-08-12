from __future__ import annotations

import httpx

from llm_router.adapters.anthropic import AnthropicAdapter
from llm_router.adapters.base import Adapter
from llm_router.adapters.openai import OpenAIAdapter
from llm_router.credentials import build_credential
from llm_router.models import Profile

__all__ = ["Adapter", "AnthropicAdapter", "OpenAIAdapter", "build_adapter"]


def build_adapter(profile: Profile, client: httpx.AsyncClient) -> Adapter:
    credential = build_credential(profile, client)
    if profile.provider == "anthropic":
        return AnthropicAdapter(client, credential)
    return OpenAIAdapter(client, credential)
