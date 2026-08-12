from __future__ import annotations

import asyncio
import base64
import json
import os
import stat
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

from llm_router.errors import RouterError

OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token"
OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
CHATGPT_ACCOUNT_CLAIM = "https://api.openai.com/auth.chatgpt_account_id"
REFRESH_WINDOW_SECONDS = 300

_refresh_locks: dict[Path, asyncio.Lock] = {}


def _codex_home() -> Path:
    configured = os.environ.get("CODEX_HOME", "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".codex"


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


class CodexTokenStore:
    """Read and safely update the credential file managed by the official Codex login."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).expanduser()

    @classmethod
    def default(cls) -> CodexTokenStore:
        return cls(_codex_home() / "auth.json")

    def load(self) -> dict[str, Any] | None:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise RouterError(
                f"Could not read Codex credentials: {exc}",
                type="authentication_error",
                code="openai_oauth_store_error",
                status_code=500,
            ) from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RouterError(
                "Codex credential store is invalid. Log in to OpenAI again.",
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
        claims = cls.claims(tokens)
        for key in (CHATGPT_ACCOUNT_CLAIM, "chatgpt_account_id"):
            value = claims.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    @classmethod
    def expires_at(cls, tokens: dict[str, Any] | None) -> float | None:
        value = cls.claims(tokens).get("exp")
        return float(value) if isinstance(value, (int, float)) else None


class OpenAICodexOAuth:
    """Authenticate requests to the ChatGPT Codex backend using Codex browser login."""

    def __init__(self, store: CodexTokenStore, client: httpx.AsyncClient) -> None:
        self.store = store
        self.client = client
        self._lock = _refresh_locks.setdefault(store.path.resolve(), asyncio.Lock())

    async def headers(self) -> dict[str, str]:
        tokens = self.store.tokens()
        if self._needs_refresh(tokens):
            async with self._lock:
                tokens = self.store.tokens()
                if self._needs_refresh(tokens):
                    tokens = await self._refresh(tokens)
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

    def _needs_refresh(self, tokens: dict[str, Any] | None) -> bool:
        if not tokens or not isinstance(tokens.get("access_token"), str):
            return False
        expires_at = self.store.expires_at(tokens)
        return expires_at is not None and expires_at <= time.time() + REFRESH_WINDOW_SECONDS

    async def _refresh(self, tokens: dict[str, Any] | None) -> dict[str, Any]:
        refresh_token = tokens.get("refresh_token") if tokens else None
        if not isinstance(refresh_token, str) or not refresh_token:
            raise self._login_required()
        try:
            response = await self.client.post(
                OPENAI_TOKEN_URL,
                json={
                    "client_id": OPENAI_OAUTH_CLIENT_ID,
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                },
                headers={"content-type": "application/json"},
            )
        except httpx.RequestError as exc:
            raise RouterError(
                f"OpenAI login refresh failed: {exc}",
                type="authentication_error",
                code="openai_oauth_refresh_failed",
                status_code=502,
            ) from exc
        if response.status_code >= 400:
            raise self._login_required()
        try:
            refreshed = response.json()
        except ValueError as exc:
            raise self._login_required() from exc
        if not isinstance(refreshed, dict):
            raise self._login_required()

        payload = self.store.load() or {}
        saved_tokens = payload.get("tokens")
        saved_tokens = dict(saved_tokens) if isinstance(saved_tokens, dict) else {}
        for key in ("id_token", "access_token", "refresh_token"):
            value = refreshed.get(key)
            if isinstance(value, str) and value:
                saved_tokens[key] = value
        if not isinstance(saved_tokens.get("access_token"), str):
            raise self._login_required()
        payload["tokens"] = saved_tokens
        payload["last_refresh"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.store.save(payload)
        return saved_tokens

    @staticmethod
    def _login_required() -> RouterError:
        return RouterError(
            "OpenAI browser login is required. Connect OpenAI from the dashboard.",
            type="authentication_error",
            code="openai_oauth_required",
            status_code=401,
        )
