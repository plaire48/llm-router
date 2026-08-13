from __future__ import annotations

from llm_router.errors import RouterError
from llm_router.models import Profile

ANTHROPIC_OAUTH_DISABLED_MESSAGE = (
    "Claude subscription OAuth is disabled for policy compliance. "
    "Use an organization-approved API provider instead."
)


def is_policy_disabled(profile: Profile) -> bool:
    return profile.provider == "anthropic" and profile.auth == "oauth"


def anthropic_oauth_disabled_error() -> RouterError:
    return RouterError(
        ANTHROPIC_OAUTH_DISABLED_MESSAGE,
        type="policy_error",
        code="anthropic_oauth_policy_disabled",
        status_code=403,
    )
