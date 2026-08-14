from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from llm_router.models import Profile

AI_PRO_BASE_URL = "https://aipro.sdsdev.co.kr/v1"


def is_aipro_base_url(value: str | None) -> bool:
    return bool(value and value.rstrip("/").lower() == AI_PRO_BASE_URL.lower())


def is_aipro_profile(profile: Profile) -> bool:
    if profile.provider == "aipro":
        return True
    return profile.provider == "openai_compatible" and is_aipro_base_url(profile.base_url)
