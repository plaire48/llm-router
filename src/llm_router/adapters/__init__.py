from __future__ import annotations

from collections.abc import Callable

import httpx

from llm_router.adapters.anthropic import AnthropicAdapter
from llm_router.adapters.base import Adapter
from llm_router.adapters.claude_code import ClaudeCodeAdapter, ClaudeOAuthAdapter
from llm_router.adapters.fabrix import FabrixAdapter
from llm_router.adapters.openai import OpenAIAdapter
from llm_router.adapters.opencode import OpenCodeAdapter
from llm_router.aipro import is_aipro_profile
from llm_router.credentials import OpenAIAccountStore, build_credential
from llm_router.models import Profile
from llm_router.opencode_runtime import OpenCodeRuntime
from llm_router.provider_policy import anthropic_oauth_disabled_error, is_policy_disabled

__all__ = [
    "Adapter",
    "AnthropicAdapter",
    "ClaudeCodeAdapter",
    "ClaudeOAuthAdapter",
    "FabrixAdapter",
    "OpenAIAdapter",
    "OpenCodeAdapter",
    "build_adapter",
]


def build_adapter(
    profile: Profile,
    client: httpx.AsyncClient,
    *,
    openai_store: OpenAIAccountStore | None = None,
    opencode_runtime: OpenCodeRuntime | None = None,
    file_resolver: Callable[[str], tuple[bytes, str, str] | None] | None = None,
) -> Adapter:
    if is_policy_disabled(profile):
        raise anthropic_oauth_disabled_error()
    if profile.provider == "fabrix":
        return FabrixAdapter(client)
    if (profile.provider == "openai" and profile.auth == "oauth") or is_aipro_profile(profile):
        return OpenCodeAdapter(
            client,
            opencode_runtime or OpenCodeRuntime(),
            file_resolver=file_resolver,
        )
    credential = build_credential(profile, client, openai_store=openai_store)
    if profile.provider == "anthropic":
        return AnthropicAdapter(client, credential)
    return OpenAIAdapter(client, credential)
