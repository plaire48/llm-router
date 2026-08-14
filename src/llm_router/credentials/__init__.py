from __future__ import annotations

import httpx

from llm_router.credentials.anthropic_oauth import AnthropicOAuth, TokenStore
from llm_router.credentials.base import Credential, NoAuthCredential
from llm_router.credentials.env_key import EnvApiKey
from llm_router.credentials.openai_oauth import OpenAIAccountStore
from llm_router.errors import RouterError
from llm_router.models import Profile
from llm_router.provider_policy import anthropic_oauth_disabled_error, is_policy_disabled

__all__ = [
    "AnthropicOAuth",
    "Credential",
    "EnvApiKey",
    "NoAuthCredential",
    "OpenAIAccountStore",
    "TokenStore",
    "build_credential",
]


def build_credential(
    profile: Profile,
    client: httpx.AsyncClient,
    *,
    openai_store: OpenAIAccountStore | None = None,
) -> Credential:
    if is_policy_disabled(profile):
        raise anthropic_oauth_disabled_error()
    if profile.auth == "oauth":
        raise RouterError(
            "OAuth credentials are managed by the provider runtime.",
            type="configuration_error",
            code="oauth_runtime_required",
            status_code=500,
        )
    if profile.auth == "none":
        return NoAuthCredential()
    if not profile.api_key_env:
        raise RouterError(
            f"profile '{profile.name}' has no api_key_env",
            type="configuration_error",
            code="missing_credential_config",
            status_code=500,
        )
    style = "x-api-key" if profile.provider == "anthropic" else "bearer"
    return EnvApiKey(profile.api_key_env, style=style)
