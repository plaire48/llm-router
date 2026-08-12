from __future__ import annotations

import httpx

from llm_router.adapters.anthropic import AnthropicAdapter
from llm_router.adapters.base import Adapter
from llm_router.adapters.claude_code import ClaudeCodeAdapter, ClaudeOAuthAdapter
from llm_router.adapters.fabrix import FabrixAdapter
from llm_router.adapters.openai import OpenAIAdapter
from llm_router.adapters.openai_codex import OpenAICodexAdapter
from llm_router.credentials import build_credential
from llm_router.models import Profile

__all__ = [
    "Adapter",
    "AnthropicAdapter",
    "ClaudeCodeAdapter",
    "ClaudeOAuthAdapter",
    "FabrixAdapter",
    "OpenAIAdapter",
    "OpenAICodexAdapter",
    "build_adapter",
]


def build_adapter(profile: Profile, client: httpx.AsyncClient) -> Adapter:
    if profile.provider == "anthropic" and profile.auth == "oauth":
        return ClaudeOAuthAdapter(client)
    if profile.provider == "fabrix":
        return FabrixAdapter(client)
    credential = build_credential(profile, client)
    if profile.provider == "anthropic":
        return AnthropicAdapter(client, credential)
    if profile.provider == "openai" and profile.auth == "oauth":
        return OpenAICodexAdapter(client, credential)
    return OpenAIAdapter(client, credential)
