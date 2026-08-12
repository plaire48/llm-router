from __future__ import annotations

from pathlib import Path
from typing import Annotated, Any

import yaml
from pydantic import StringConstraints, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from llm_router.errors import RouterError
from llm_router.models import Profile


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LLM_ROUTER_", env_file=".env", extra="ignore")

    master_key: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    host: str = "127.0.0.1"
    port: int = 8787
    usage_db: Path = Path.home() / ".llm-router" / "usage.db"
    log_bodies: bool = False

    @field_validator("usage_db", mode="before")
    @classmethod
    def _expand_usage_db(cls, value: str | Path) -> Path:
        return Path(value).expanduser()


class ProfileRegistry:
    def __init__(self, profiles: list[Profile]) -> None:
        self._by_name: dict[str, Profile] = {}
        self._alias: dict[str, Profile] = {}

        for profile in profiles:
            if profile.name in self._by_name or profile.name in self._alias:
                raise RouterError(f"duplicate profile name/alias: {profile.name}")
            self._by_name[profile.name] = profile

        for profile in profiles:
            for alias in profile.aliases:
                if alias in self._by_name or alias in self._alias:
                    raise RouterError(f"duplicate profile name/alias: {alias}")
                self._alias[alias] = profile

    def resolve(self, model: str) -> Profile:
        profile = self._by_name.get(model) or self._alias.get(model)
        if profile is None:
            raise RouterError(
                f"model '{model}' not found. Available: {', '.join(self.names())}",
                type="invalid_request_error",
                code="model_not_found",
                status_code=404,
            )
        return profile

    def names(self) -> list[str]:
        return sorted(self._by_name)


def load_profiles(path: str | Path) -> ProfileRegistry:
    profile_path = Path(path)
    try:
        raw: Any = yaml.safe_load(profile_path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as exc:
        raise RouterError(f"invalid profiles.yaml: {exc}") from exc

    if not isinstance(raw, dict):
        raise RouterError("invalid profiles.yaml: expected a mapping at the document root")
    items = raw.get("profiles", [])
    if not isinstance(items, list):
        raise RouterError("invalid profiles.yaml: 'profiles' must be a list")
    if not items:
        raise RouterError("no profiles defined in profiles.yaml")

    try:
        profiles = [Profile.model_validate(item) for item in items]
    except Exception as exc:
        raise RouterError(f"invalid profiles.yaml: {exc}") from exc
    return ProfileRegistry(profiles)
