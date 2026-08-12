from __future__ import annotations

import httpx

from llm_router.credentials.anthropic_oauth import AnthropicOAuth, TokenStore
from llm_router.credentials.base import Credential
from llm_router.credentials.env_key import EnvApiKey
from llm_router.credentials.openai_oauth import CodexTokenStore, OpenAICodexOAuth
from llm_router.errors import RouterError
from llm_router.models import Profile

__all__ = [
    "AnthropicOAuth",
    "CodexTokenStore",
    "Credential",
    "EnvApiKey",
    "OpenAICodexOAuth",
    "TokenStore",
    "build_credential",
]


def build_credential(profile: Profile, client: httpx.AsyncClient) -> Credential:
    if profile.auth == "oauth":
        if profile.provider == "anthropic":
            return AnthropicOAuth(TokenStore.default(), client)
        return OpenAICodexOAuth(CodexTokenStore.default(), client)
    if not profile.api_key_env:
        raise RouterError(
            f"profile '{profile.name}' has no api_key_env",
            type="configuration_error",
            code="missing_credential_config",
            status_code=500,
        )
    style = "x-api-key" if profile.provider == "anthropic" else "bearer"
    return EnvApiKey(profile.api_key_env, style=style)
