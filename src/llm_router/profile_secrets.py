from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


class ProfileSecretStore:
    """Keep profile credentials out of profiles.yaml and API responses."""

    def __init__(self, path: Path) -> None:
        self.path = path

    @classmethod
    def default(cls) -> ProfileSecretStore:
        return cls(Path.home() / ".llm-router" / "profile-secrets.json")

    @staticmethod
    def env_name(profile_name: str, secret: str = "api_key") -> str:
        if secret == "api_key":
            digest = hashlib.sha256(profile_name.encode()).hexdigest()[:16].upper()
            return f"LLM_ROUTER_PROFILE_{digest}_API_KEY"
        digest = hashlib.sha256(f"{profile_name}:{secret}".encode()).hexdigest()[:16].upper()
        return f"LLM_ROUTER_PROFILE_{digest}_{secret.upper()}"

    @staticmethod
    def _storage_key(profile_name: str, secret: str) -> str:
        return profile_name if secret == "api_key" else f"{profile_name}::{secret}"

    def load(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        try:
            payload: Any = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        if not isinstance(payload, dict):
            return {}
        return {
            key: value
            for key, value in payload.items()
            if isinstance(key, str) and isinstance(value, str)
        }

    def has(self, profile_name: str, secret: str = "api_key") -> bool:
        return bool(self.load().get(self._storage_key(profile_name, secret)))

    def set(self, profile_name: str, value: str, secret: str = "api_key") -> str:
        key = value.strip()
        if not key:
            raise ValueError(f"{secret} cannot be blank")
        secrets = self.load()
        secrets[self._storage_key(profile_name, secret)] = key
        self._save(secrets)
        env_name = self.env_name(profile_name, secret)
        os.environ[env_name] = key
        return env_name

    def delete(self, profile_name: str) -> None:
        secrets = self.load()
        secret_names = ["api_key", "client_key"]
        for secret in secret_names:
            secrets.pop(self._storage_key(profile_name, secret), None)
        self._save(secrets)
        for secret in secret_names:
            os.environ.pop(self.env_name(profile_name, secret), None)

    def hydrate(self) -> None:
        for storage_key, value in self.load().items():
            profile_name, separator, secret = storage_key.partition("::")
            os.environ[self.env_name(profile_name, secret if separator else "api_key")] = value

    def _save(self, payload: dict[str, str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, name = tempfile.mkstemp(dir=self.path.parent, prefix=f".{self.path.name}.")
        temporary = Path(name)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            os.chmod(self.path, 0o600)
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            temporary.unlink(missing_ok=True)
            raise
