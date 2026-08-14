from __future__ import annotations

import asyncio
import ssl
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from typing import Any

import httpx

from llm_router.credentials.openai_oauth import (
    OPENAI_OAUTH_CLIENT_ID as _OPENAI_OAUTH_CLIENT_ID,
)
from llm_router.credentials.openai_oauth import OPENAI_TOKEN_URL as _OPENAI_TOKEN_URL
from llm_router.credentials.openai_oauth import OpenAIAccountStore, refresh_openai_tokens
from llm_router.errors import RouterError
from llm_router.http_client import resolve_environment_path

OPENAI_ACCOUNT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
OPENAI_TOKEN_URL = _OPENAI_TOKEN_URL
OPENAI_OAUTH_CLIENT_ID = _OPENAI_OAUTH_CLIENT_ID
OPENCODE_ACCOUNT_USER_AGENT = "opencode/1.18.18"
CACHE_TTL_SECONDS = 300.0
TOKEN_REFRESH_MARGIN_SECONDS = 60.0
ClientGetter = Callable[[], Awaitable[httpx.AsyncClient]]


@dataclass(frozen=True, slots=True)
class OpenAIAccountReport:
    rate_limits: dict[str, Any]
    stale: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "object": "openai_account_usage",
            "status": "ok",
            "source": "openai_chatgpt_usage_api",
            "configured": True,
            "stale": self.stale,
            "rate_limits": self.rate_limits,
            "token_usage": {"summary": {}, "daily_usage_buckets": []},
        }


class OpenAIAccountSource:
    """Read account credits from the ChatGPT account authenticated by OpenCode."""

    def __init__(
        self,
        *,
        store: OpenAIAccountStore,
        client: httpx.AsyncClient | None,
        client_getter: ClientGetter | None = None,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self.store = store
        self.client = client
        self.client_getter = client_getter
        self.clock = clock
        self.wall_clock = wall_clock
        self._lock = asyncio.Lock()
        self._cached: OpenAIAccountReport | None = None
        self._expires_at = 0.0

    async def report(self) -> OpenAIAccountReport:
        current = self.clock()
        if self._cached is not None and current < self._expires_at:
            return self._cached
        async with self._lock:
            current = self.clock()
            if self._cached is not None and current < self._expires_at:
                return self._cached
            try:
                report = await self._fetch()
            except RouterError:
                if self._cached is not None:
                    return replace(self._cached, stale=True)
                raise
            self._cached = report
            self._expires_at = current + CACHE_TTL_SECONDS
            return report

    async def _fetch(self) -> OpenAIAccountReport:
        client = await self._get_client()
        tokens = self._require_tokens()
        refreshed = False
        expires_at = OpenAIAccountStore.expires_at(tokens)
        if (
            expires_at is not None
            and expires_at <= self.wall_clock() + TOKEN_REFRESH_MARGIN_SECONDS
        ):
            tokens = await self._refresh(client, tokens)
            refreshed = True

        response = await self._request(client, tokens)
        if response.status_code == 401 and not refreshed and tokens.get("refresh_token"):
            tokens = await self._refresh(client, tokens)
            response = await self._request(client, tokens)
        if response.status_code in {500, 502, 503, 504}:
            await asyncio.sleep(0.2)
            response = await self._request(client, tokens)

        if response.status_code in {401, 403}:
            raise RouterError(
                "OpenAI login session cannot read account credits. Log in again.",
                type="authentication_error",
                code="oauth_required",
                status_code=401,
            )
        if response.status_code == 429:
            raise RouterError(
                "OpenAI account credits are temporarily rate limited.",
                type="upstream_error",
                code="openai_account_rate_limited",
                status_code=429,
            )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RouterError(
                "OpenAI account credits request failed.",
                type="upstream_error",
                code="openai_account_upstream_error",
                status_code=response.status_code,
            ) from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise self._invalid_response("response is not valid JSON") from exc
        return OpenAIAccountReport(rate_limits=self._normalize(payload))

    async def _request(
        self,
        client: httpx.AsyncClient,
        tokens: dict[str, Any],
    ) -> httpx.Response:
        access_token = tokens.get("access_token")
        account_id = OpenAIAccountStore.account_id(tokens)
        if not isinstance(access_token, str) or not access_token or not account_id:
            raise self._login_required()
        try:
            return await client.get(
                OPENAI_ACCOUNT_USAGE_URL,
                headers={
                    "Accept": "application/json",
                    "Authorization": f"Bearer {access_token}",
                    "ChatGPT-Account-Id": account_id,
                    # Keep account reads attached to the same OpenCode OAuth client
                    # identity that acquired and owns this browser-login session.
                    "User-Agent": OPENCODE_ACCOUNT_USER_AGENT,
                    "originator": "opencode",
                },
                timeout=15.0,
            )
        except httpx.RequestError as exc:
            if self._is_certificate_error(exc):
                configured_ca = resolve_environment_path("NODE_EXTRA_CA_CERTS")
                ca_detail = (
                    f" NODE_EXTRA_CA_CERTS is {configured_ca}."
                    if configured_ca
                    else " NODE_EXTRA_CA_CERTS is not configured."
                )
                raise RouterError(
                    "OpenAI account credits TLS certificate verification failed. "
                    + ca_detail
                    + " The certificate must trust the SDS root and any required intermediate "
                    "CA certificates. PEM bundles and binary DER .crt certificates are supported. "
                    "Restart llm-router after changing it.",
                    type="upstream_error",
                    code="tls_certificate_verify_failed",
                    status_code=502,
                ) from exc
            raise RouterError(
                f"OpenAI account credits connection failed: {exc}",
                type="upstream_error",
                code="openai_account_connection_error",
                status_code=502,
            ) from exc

    @staticmethod
    def _is_certificate_error(exc: BaseException) -> bool:
        current: BaseException | None = exc
        visited: set[int] = set()
        while current is not None and id(current) not in visited:
            if isinstance(current, ssl.SSLCertVerificationError):
                return True
            visited.add(id(current))
            current = current.__cause__ or current.__context__
        return "certificate verify failed" in str(exc).lower()

    async def _refresh(
        self,
        client: httpx.AsyncClient,
        tokens: dict[str, Any],
    ) -> dict[str, Any]:
        return await refresh_openai_tokens(
            self.store,
            client,
            tokens,
            wall_clock=self.wall_clock,
        )

    def _require_tokens(self) -> dict[str, Any]:
        tokens = self.store.tokens()
        if not tokens:
            raise self._login_required()
        return tokens

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None and self.client_getter is not None:
            self.client = await self.client_getter()
        if self.client is None:
            raise RouterError(
                "OpenAI account credits HTTP client is unavailable.",
                type="server_error",
                code="openai_account_client_unavailable",
                status_code=500,
            )
        return self.client

    @classmethod
    def _normalize(cls, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise cls._invalid_response("response is not an object")
        rate_limit = payload.get("rate_limit") or {}
        credits = payload.get("credits")
        spend_control = payload.get("spend_control")
        if not isinstance(rate_limit, dict):
            raise cls._invalid_response("rate_limit is invalid")
        if credits is not None and not isinstance(credits, dict):
            raise cls._invalid_response("credits is invalid")
        if spend_control is not None and not isinstance(spend_control, dict):
            raise cls._invalid_response("spend_control is invalid")

        normalized: dict[str, Any] = {
            "primary": cls._normalize_window(rate_limit.get("primary_window")),
            "secondary": cls._normalize_window(rate_limit.get("secondary_window")),
            "credits": cls._normalize_credits(credits),
            "individualLimit": cls._normalize_individual_limit(
                spend_control.get("individual_limit") if spend_control else None
            ),
            "spendControlReached": spend_control.get("reached") if spend_control else None,
            "planType": payload.get("plan_type"),
            "rateLimitReachedType": payload.get("rate_limit_reached_type"),
        }
        return normalized

    @classmethod
    def _normalize_window(cls, value: Any) -> dict[str, Any] | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise cls._invalid_response("rate limit window is invalid")
        return {
            "usedPercent": value.get("used_percent"),
            "windowDurationMins": cls._seconds_to_minutes(value.get("limit_window_seconds")),
            "resetsAt": value.get("reset_at"),
        }

    @classmethod
    def _normalize_credits(cls, value: Any) -> dict[str, Any] | None:
        if value is None:
            return None
        has_credits = value.get("has_credits")
        unlimited = value.get("unlimited")
        if has_credits is not None and not isinstance(has_credits, bool):
            raise cls._invalid_response("credits.has_credits is invalid")
        if unlimited is not None and not isinstance(unlimited, bool):
            raise cls._invalid_response("credits.unlimited is invalid")
        balance = value.get("balance")
        if balance is not None and not isinstance(balance, (str, int, float)):
            raise cls._invalid_response("credits balance is invalid")
        return {
            "hasCredits": has_credits if has_credits is not None else balance is not None,
            "unlimited": unlimited is True,
            "balance": balance,
        }

    @classmethod
    def _normalize_individual_limit(cls, value: Any) -> dict[str, Any] | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise cls._invalid_response("individual credit limit is invalid")
        return {
            "limit": value.get("limit"),
            "used": value.get("used"),
            "remainingPercent": value.get("remaining_percent"),
            "resetsAt": value.get("reset_at"),
        }

    @staticmethod
    def _seconds_to_minutes(value: Any) -> float | None:
        return float(value) / 60 if isinstance(value, (int, float)) else None

    @staticmethod
    def _login_required() -> RouterError:
        return RouterError(
            "OpenAI browser login is required to read account credits.",
            type="authentication_error",
            code="oauth_required",
            status_code=401,
        )

    @staticmethod
    def _invalid_response(detail: str) -> RouterError:
        return RouterError(
            f"OpenAI account credits returned an invalid response: {detail}",
            type="upstream_error",
            code="invalid_openai_account_response",
            status_code=502,
        )
