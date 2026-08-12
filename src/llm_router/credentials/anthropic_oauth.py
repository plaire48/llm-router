from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

from llm_router.errors import RouterError
from llm_router.oauth import constants


def _oauth_required(message: str = "not logged in") -> RouterError:
    return RouterError(
        f"{message}. Run: llm-router oauth login anthropic",
        type="authentication_error",
        code="oauth_required",
        status_code=401,
    )


class TokenStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    @classmethod
    def default(cls) -> TokenStore:
        return cls(Path.home() / ".llm-router" / "credentials.json")

    def load(self) -> dict | None:
        if not self.path.exists():
            return None
        try:
            value: Any = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise _oauth_required("credential store is invalid") from exc
        if not isinstance(value, dict):
            raise _oauth_required("credential store is invalid")
        return value

    def save(self, tokens: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        file_descriptor, temporary_name = tempfile.mkstemp(
            dir=self.path.parent,
            prefix=f".{self.path.name}.",
        )
        temporary_path = Path(temporary_name)
        try:
            os.fchmod(file_descriptor, 0o600)
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
                json.dump(tokens, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self.path)
            os.chmod(self.path, 0o600)
        except Exception:
            try:
                os.close(file_descriptor)
            except OSError:
                pass
            temporary_path.unlink(missing_ok=True)
            raise

    def delete(self) -> None:
        self.path.unlink(missing_ok=True)

    def is_expired(self, tokens: dict, skew: int = 300) -> bool:
        try:
            expires_at = float(tokens.get("expires_at", 0))
        except (TypeError, ValueError):
            return True
        return time.time() >= expires_at - skew


class AnthropicOAuth:
    def __init__(self, store: TokenStore, client: httpx.AsyncClient) -> None:
        self.store = store
        self.client = client
        self._refresh_lock = asyncio.Lock()

    async def headers(self) -> dict[str, str]:
        tokens = self.store.load()
        if not tokens:
            raise _oauth_required()
        if self.store.is_expired(tokens):
            async with self._refresh_lock:
                tokens = self.store.load()
                if not tokens:
                    raise _oauth_required()
                if self.store.is_expired(tokens):
                    tokens = await self._refresh(tokens)
        access_token = tokens.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise _oauth_required("credential store has no access token")
        return constants.auth_headers(access_token)

    async def _refresh(self, tokens: dict) -> dict:
        refresh_token = tokens.get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token:
            raise _oauth_required("credential store has no refresh token")
        body = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": constants.CLIENT_ID,
            "scope": " ".join(constants.SCOPES),
        }
        try:
            response = await self.client.post(constants.TOKEN_URL, json=body)
        except httpx.RequestError as exc:
            raise _oauth_required("token refresh failed") from exc
        if response.status_code != 200:
            raise _oauth_required(f"token refresh failed ({response.status_code})")
        try:
            data = response.json()
            access_token = data["access_token"]
            expires_in = int(data.get("expires_in", 3600))
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise _oauth_required("token refresh returned an invalid response") from exc
        if not isinstance(access_token, str) or not access_token:
            raise _oauth_required("token refresh returned no access token")
        new_tokens = {
            "access_token": access_token,
            "refresh_token": data.get("refresh_token") or refresh_token,
            "expires_at": time.time() + expires_in,
        }
        if data.get("scope") is not None:
            new_tokens["scope"] = data["scope"]
        self.store.save(new_tokens)
        return new_tokens
