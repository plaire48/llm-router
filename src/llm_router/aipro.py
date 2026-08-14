from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from llm_router.models import Profile

AI_PRO_ORIGIN = "https://aipro.sdsdev.co.kr"
AI_PRO_BASE_URL = f"{AI_PRO_ORIGIN}/v1"
AI_PRO_BROWSER_BASE_URL = f"{AI_PRO_ORIGIN}/api/v1"
AI_PRO_LOGIN_URL = f"{AI_PRO_ORIGIN}/auth/login"


def is_aipro_base_url(value: str | None) -> bool:
    return bool(
        value
        and value.rstrip("/").lower() in {AI_PRO_BASE_URL.lower(), AI_PRO_BROWSER_BASE_URL.lower()}
    )


def is_aipro_profile(profile: Profile) -> bool:
    if profile.provider == "aipro":
        return True
    return profile.provider == "openai_compatible" and is_aipro_base_url(profile.base_url)
