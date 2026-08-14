from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from llm_router.errors import RouterError
from llm_router.models import Profile


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LLM_ROUTER_", env_file=".env", extra="ignore")

    master_key: str | None = None
    host: str = "127.0.0.1"
    port: int = 8787
    usage_db: Path = Path.home() / ".llm-router" / "usage.db"
    log_bodies: bool = False
    opencode_url: str = "http://127.0.0.1:0"
    opencode_binary: str = "opencode"
    opencode_directory: Path = Path.home() / ".llm-router" / "opencode"
    opencode_auto_start: bool = True
    opencode_startup_timeout: float = Field(default=120.0, gt=0, le=600)

    @field_validator("master_key", mode="before")
    @classmethod
    def _normalize_master_key(cls, value: object) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("usage_db", mode="before")
    @classmethod
    def _expand_usage_db(cls, value: str | Path) -> Path:
        return Path(value).expanduser()

    @field_validator("opencode_directory", mode="before")
    @classmethod
    def _expand_opencode_directory(cls, value: str | Path) -> Path:
        return Path(value).expanduser()

    @field_validator("opencode_url", mode="before")
    @classmethod
    def _normalize_opencode_url(cls, value: object) -> str:
        normalized = str(value).strip().rstrip("/")
        if not normalized.startswith(("http://", "https://")):
            raise ValueError("opencode_url must be an HTTP(S) URL")
        return normalized


def is_loopback_host(host: str) -> bool:
    normalized = host.strip().lower().removeprefix("[").removesuffix("]")
    return normalized in {"127.0.0.1", "localhost", "::1"}


class ProfileRegistry:
    def __init__(self, profiles: list[Profile]) -> None:
        self._by_name, self._alias = self._indexes(profiles)

    @staticmethod
    def _indexes(profiles: list[Profile]) -> tuple[dict[str, Profile], dict[str, Profile]]:
        by_name: dict[str, Profile] = {}
        aliases: dict[str, Profile] = {}

        for profile in profiles:
            if profile.name in by_name or profile.name in aliases:
                raise RouterError(f"duplicate profile name/alias: {profile.name}")
            by_name[profile.name] = profile

        for profile in profiles:
            for alias in profile.aliases:
                if alias in by_name or alias in aliases:
                    raise RouterError(f"duplicate profile name/alias: {alias}")
                aliases[alias] = profile
        ports: set[int] = set()
        for profile in profiles:
            if profile.port is None:
                continue
            if profile.port in ports:
                raise RouterError(f"duplicate profile port: {profile.port}")
            ports.add(profile.port)
        return by_name, aliases

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

    def profiles(self) -> list[Profile]:
        return [self._by_name[name] for name in self.names()]

    def replace(self, profiles: list[Profile]) -> None:
        by_name, aliases = self._indexes(profiles)
        self._by_name = by_name
        self._alias = aliases

    def upsert(self, profile: Profile, *, previous_name: str | None = None) -> None:
        profiles = [
            item for item in self.profiles() if item.name != (previous_name or profile.name)
        ]
        profiles.append(profile)
        self.replace(profiles)

    def delete(self, name: str) -> Profile:
        profile = self._by_name.get(name)
        if profile is None:
            raise RouterError(
                f"profile '{name}' not found",
                type="invalid_request_error",
                code="profile_not_found",
                status_code=404,
            )
        self.replace([item for item in self.profiles() if item.name != name])
        return profile


class ProfileFile:
    def __init__(self, path: str | Path | None) -> None:
        self.path = Path(path) if path is not None else None

    def save(self, registry: ProfileRegistry) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "profiles": [
                profile.model_dump(mode="json", exclude_none=True)
                for profile in registry.profiles()
            ]
        }
        temporary = self.path.with_name(f".{self.path.name}.tmp")
        temporary.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
        temporary.replace(self.path)


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
    try:
        profiles = [Profile.model_validate(item) for item in items]
    except Exception as exc:
        raise RouterError(f"invalid profiles.yaml: {exc}") from exc
    return ProfileRegistry(profiles)
