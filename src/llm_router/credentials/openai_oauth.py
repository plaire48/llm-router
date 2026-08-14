from __future__ import annotations

import base64
import json
import os
import stat
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from llm_router.errors import RouterError

OPENAI_AUTH_CLAIM = "https://api.openai.com/auth"
CHATGPT_ACCOUNT_CLAIM = "https://api.openai.com/auth.chatgpt_account_id"
OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token"
OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"


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
    """Read either a Codex or router-owned OpenCode credential cache."""

    def __init__(self, path: str | Path, *, opencode: bool = False) -> None:
        self.path = Path(path).expanduser()
        self.opencode = opencode

    @classmethod
    def default(cls) -> OpenAIAccountStore:
        return cls.from_opencode(
            Path.home() / ".llm-router" / "opencode" / "data" / "opencode" / "auth.json"
        )

    @classmethod
    def from_opencode(cls, path: str | Path) -> OpenAIAccountStore:
        return cls(path, opencode=True)

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
        if self.opencode:
            credential = payload.get("openai") if payload else None
            if not isinstance(credential, dict) or credential.get("type") != "oauth":
                return None
            tokens: dict[str, Any] = {}
            mappings = {
                "access": "access_token",
                "refresh": "refresh_token",
                "accountId": "account_id",
            }
            for source, target in mappings.items():
                value = credential.get(source)
                if isinstance(value, str) and value:
                    tokens[target] = value
            if "account_id" not in tokens:
                metadata = credential.get("metadata")
                if isinstance(metadata, dict):
                    account_id = metadata.get("accountID") or metadata.get("accountId")
                    if isinstance(account_id, str) and account_id:
                        tokens["account_id"] = account_id
            expires = credential.get("expires")
            if isinstance(expires, (int, float)):
                tokens["expires_at"] = float(expires) / 1000
            return tokens or None
        tokens = payload.get("tokens") if payload else None
        return tokens if isinstance(tokens, dict) else None

    def update_opencode_oauth(self, tokens: dict[str, Any]) -> None:
        """Persist refreshed OAuth values without replacing other OpenCode credentials."""
        if not self.opencode:
            raise RouterError(
                "OpenAI credentials are not stored in OpenCode format.",
                type="authentication_error",
                code="openai_oauth_store_error",
                status_code=500,
            )
        payload = self.load()
        credential = payload.get("openai") if payload else None
        if not isinstance(payload, dict) or not isinstance(credential, dict):
            raise RouterError(
                "OpenAI account credentials are missing. Log in to OpenAI again.",
                type="authentication_error",
                code="openai_oauth_store_error",
                status_code=401,
            )
        updated = dict(credential)
        mappings = {
            "access_token": "access",
            "refresh_token": "refresh",
            "account_id": "accountId",
        }
        for source, target in mappings.items():
            value = tokens.get(source)
            if isinstance(value, str) and value:
                updated[target] = value
        expires_at = tokens.get("expires_at")
        if isinstance(expires_at, (int, float)):
            updated["expires"] = int(float(expires_at) * 1000)
        new_payload = dict(payload)
        new_payload["openai"] = updated
        self.save(new_payload)

    def update_oauth_tokens(self, tokens: dict[str, Any]) -> None:
        """Persist refreshed OAuth fields without discarding provider metadata."""
        if self.opencode:
            self.update_opencode_oauth(tokens)
            return
        payload = self.load() or {}
        existing = payload.get("tokens")
        updated = dict(existing) if isinstance(existing, dict) else {}
        updated.update(
            {
                key: value
                for key, value in tokens.items()
                if value is not None
                and key in {"access_token", "refresh_token", "account_id", "expires_at"}
            }
        )
        new_payload = dict(payload)
        new_payload["tokens"] = updated
        self.save(new_payload)

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
        direct = tokens.get("expires_at") if tokens else None
        if isinstance(direct, (int, float)):
            return float(direct)
        value = cls.claims(tokens).get("exp")
        return float(value) if isinstance(value, (int, float)) else None


async def refresh_openai_tokens(
    store: OpenAIAccountStore,
    client: httpx.AsyncClient,
    tokens: dict[str, Any] | None = None,
    *,
    wall_clock: Callable[[], float] = time.time,
) -> dict[str, Any]:
    """Refresh and persist the browser OAuth session shared with OpenCode."""
    current = tokens or store.tokens()
    refresh_token = current.get("refresh_token") if current else None
    if not isinstance(refresh_token, str) or not refresh_token:
        raise _openai_login_required()
    try:
        response = await client.post(
            OPENAI_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": OPENAI_OAUTH_CLIENT_ID,
            },
            timeout=10.0,
        )
    except httpx.RequestError as exc:
        raise RouterError(
            f"OpenAI login refresh failed: {exc}",
            type="authentication_error",
            code="oauth_refresh_failed",
            status_code=401,
        ) from exc
    if response.status_code in {400, 401, 403}:
        raise _openai_login_required()
    try:
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPStatusError, ValueError) as exc:
        raise RouterError(
            "OpenAI login refresh failed. Log in again.",
            type="authentication_error",
            code="oauth_refresh_failed",
            status_code=401,
        ) from exc
    if not isinstance(payload, dict):
        raise _openai_login_required()
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise _openai_login_required()
    expires_in = payload.get("expires_in")
    expires_at = wall_clock() + float(expires_in) if isinstance(expires_in, (int, float)) else None
    refreshed = {
        "access_token": access_token,
        "refresh_token": payload.get("refresh_token") or refresh_token,
        "account_id": OpenAIAccountStore.account_id(current),
        "expires_at": expires_at,
    }
    normalized = {key: value for key, value in refreshed.items() if value is not None}
    store.update_oauth_tokens(normalized)
    return normalized


def _openai_login_required() -> RouterError:
    return RouterError(
        "OpenAI browser login is required.",
        type="authentication_error",
        code="oauth_required",
        status_code=401,
    )
