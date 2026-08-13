from __future__ import annotations

import asyncio
import base64
import json
import os
import stat
import tempfile
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from llm_router.errors import RouterError
from llm_router.openai_runtime import OpenAIAccountClient, openai_account_home

OPENAI_AUTH_CLAIM = "https://api.openai.com/auth"
CHATGPT_ACCOUNT_CLAIM = "https://api.openai.com/auth.chatgpt_account_id"
REFRESH_WINDOW_SECONDS = 300

_refresh_locks: dict[Path, asyncio.Lock] = {}


def _jwt_claims(token: str | None) -> dict[str, Any]:
    if not token or token.count(".") < 2:
        return {}
    encoded = token.split(".", 2)[1]
    encoded += "=" * (-len(encoded) % 4)
    try:
        value = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


class OpenAIAccountStore:
    """Read the local credential cache managed by the official OpenAI account runtime."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).expanduser()

    @classmethod
    def default(cls) -> OpenAIAccountStore:
        return cls(openai_account_home() / "auth.json")

    def load(self) -> dict[str, Any] | None:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise RouterError(
                f"Could not read OpenAI account credentials: {exc}",
                type="authentication_error",
                code="openai_oauth_store_error",
                status_code=500,
            ) from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RouterError(
                "OpenAI account credentials are invalid. Log in to OpenAI again.",
                type="authentication_error",
                code="openai_oauth_store_error",
                status_code=401,
            ) from exc
        return payload if isinstance(payload, dict) else None

    def save(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, temporary_name = tempfile.mkstemp(
            dir=self.path.parent,
            prefix=f".{self.path.name}.",
        )
        temporary = Path(temporary_name)
        try:
            os.fchmod(descriptor, stat.S_IRUSR | stat.S_IWUSR)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            temporary.unlink(missing_ok=True)
            raise

    def tokens(self) -> dict[str, Any] | None:
        payload = self.load()
        tokens = payload.get("tokens") if payload else None
        return tokens if isinstance(tokens, dict) else None

    @staticmethod
    def claims(tokens: dict[str, Any] | None) -> dict[str, Any]:
        if not tokens:
            return {}
        id_token = tokens.get("id_token")
        if isinstance(id_token, str):
            claims = _jwt_claims(id_token)
            if claims:
                return claims
        access_token = tokens.get("access_token")
        return _jwt_claims(access_token if isinstance(access_token, str) else None)

    @classmethod
    def account_id(cls, tokens: dict[str, Any] | None) -> str | None:
        if not tokens:
            return None
        direct = tokens.get("account_id")
        if isinstance(direct, str) and direct:
            return direct
        for token_key in ("id_token", "access_token"):
            token = tokens.get(token_key)
            claims = _jwt_claims(token if isinstance(token, str) else None)
            for key in (CHATGPT_ACCOUNT_CLAIM, "chatgpt_account_id"):
                value = claims.get(key)
                if isinstance(value, str) and value:
                    return value
            auth = claims.get(OPENAI_AUTH_CLAIM)
            if isinstance(auth, dict):
                value = auth.get("chatgpt_account_id")
                if isinstance(value, str) and value:
                    return value
        return None

    @classmethod
    def expires_at(cls, tokens: dict[str, Any] | None) -> float | None:
        value = cls.claims(tokens).get("exp")
        return float(value) if isinstance(value, (int, float)) else None


class OpenAIChatGPTOAuth:
    """Authenticate ChatGPT requests with the OpenAI-managed browser session."""

    def __init__(
        self,
        store: OpenAIAccountStore,
        *,
        refresh_runner: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.store = store
        self.refresh_runner = refresh_runner or self._refresh_with_account_service
        self._lock = _refresh_locks.setdefault(store.path.resolve(), asyncio.Lock())

    async def headers(self) -> dict[str, str]:
        tokens = self.store.tokens()
        if self._needs_refresh(tokens):
            async with self._lock:
                tokens = self.store.tokens()
                if self._needs_refresh(tokens):
                    await self.refresh_runner()
                    tokens = self.store.tokens()
                    if self._needs_refresh(tokens):
                        raise self._login_required()
        access_token = tokens.get("access_token") if tokens else None
        account_id = self.store.account_id(tokens)
        if not isinstance(access_token, str) or not access_token or not account_id:
            raise self._login_required()
        return {
            "authorization": f"Bearer {access_token}",
            "chatgpt-account-id": account_id,
            "content-type": "application/json",
            "accept": "text/event-stream",
            "originator": "llm-router",
            "user-agent": "llm-router/0.1.0",
        }

    async def opencode_auth(self) -> dict[str, Any]:
        """Return a refreshed OpenCode OAuth credential without exposing it to callers."""
        await self.headers()
        tokens = self.store.tokens()
        access = tokens.get("access_token") if tokens else None
        refresh = tokens.get("refresh_token") if tokens else None
        expires_at = self.store.expires_at(tokens)
        if not isinstance(access, str) or not isinstance(refresh, str):
            raise self._login_required()
        payload: dict[str, Any] = {
            "type": "oauth",
            "access": access,
            "refresh": refresh,
            "expires": int((expires_at or time.time() + 3600) * 1000),
        }
        account_id = self.store.account_id(tokens)
        if account_id:
            payload["accountId"] = account_id
        return payload

    def _needs_refresh(self, tokens: dict[str, Any] | None) -> bool:
        if not tokens or not isinstance(tokens.get("access_token"), str):
            return False
        expires_at = self.store.expires_at(tokens)
        return expires_at is not None and expires_at <= time.time() + REFRESH_WINDOW_SECONDS

    async def _refresh_with_account_service(self) -> None:
        await OpenAIAccountClient().account(refresh_token=True)

    @staticmethod
    def _login_required() -> RouterError:
        return RouterError(
            "OpenAI browser login is required. Connect OpenAI from the dashboard.",
            type="authentication_error",
            code="openai_oauth_required",
            status_code=401,
        )
