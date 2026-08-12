from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from typing import Any

import httpx

from llm_router.credentials.anthropic_oauth import AnthropicOAuth, TokenStore
from llm_router.errors import RouterError

CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
CACHE_TTL_SECONDS = 300.0
ClientGetter = Callable[[], Awaitable[httpx.AsyncClient]]

_WINDOWS = (
    "five_hour",
    "seven_day",
    "seven_day_oauth_apps",
    "seven_day_opus",
    "seven_day_sonnet",
    "cinder_cove",
)


@dataclass(frozen=True, slots=True)
class ClaudeAccountReport:
    rate_limits: dict[str, Any]
    stale: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "object": "claude_account_usage",
            "status": "ok",
            "source": "claude_oauth_usage",
            "configured": True,
            "stale": self.stale,
            "rate_limits": self.rate_limits,
        }


class ClaudeAccountSource:
    """Read usage for the one Claude account stored by the browser OAuth flow."""

    def __init__(
        self,
        *,
        store: TokenStore,
        client: httpx.AsyncClient | None,
        client_getter: ClientGetter | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.store = store
        self.client = client
        self.client_getter = client_getter
        self.clock = clock
        self._lock = asyncio.Lock()
        self._cached: ClaudeAccountReport | None = None
        self._expires_at = 0.0

    async def report(self) -> ClaudeAccountReport:
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

    async def _fetch(self) -> ClaudeAccountReport:
        client = await self._get_client()
        headers = await AnthropicOAuth(self.store, client).headers()
        try:
            response = await client.get(CLAUDE_USAGE_URL, headers=headers, timeout=5.0)
        except httpx.RequestError as exc:
            raise RouterError(
                f"Claude account usage connection failed: {exc}",
                type="upstream_error",
                code="claude_account_connection_error",
                status_code=502,
            ) from exc

        if response.status_code in {401, 403}:
            raise RouterError(
                "Claude login session cannot read account usage. Log in again.",
                type="authentication_error",
                code="oauth_required",
                status_code=401,
            )
        if response.status_code == 429:
            raise RouterError(
                "Claude account usage is temporarily rate limited.",
                type="upstream_error",
                code="claude_account_rate_limited",
                status_code=429,
            )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RouterError(
                "Claude account usage request failed.",
                type="upstream_error",
                code="claude_account_upstream_error",
                status_code=response.status_code,
            ) from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise self._invalid_response("response is not valid JSON") from exc
        return ClaudeAccountReport(rate_limits=self._normalize(payload))

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None and self.client_getter is not None:
            self.client = await self.client_getter()
        if self.client is None:
            raise RouterError(
                "Claude account usage HTTP client is unavailable.",
                type="server_error",
                code="claude_account_client_unavailable",
                status_code=500,
            )
        return self.client

    @classmethod
    def _normalize(cls, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise cls._invalid_response("response is not an object")
        result: dict[str, Any] = {}
        for name in _WINDOWS:
            value = payload.get(name)
            if value is None:
                continue
            if not isinstance(value, dict):
                raise cls._invalid_response(f"{name} is invalid")
            utilization = value.get("utilization")
            resets_at = value.get("resets_at")
            if utilization is not None and not isinstance(utilization, (int, float)):
                raise cls._invalid_response(f"{name}.utilization is invalid")
            if resets_at is not None and not isinstance(resets_at, str):
                raise cls._invalid_response(f"{name}.resets_at is invalid")
            result[name] = {"utilization": utilization, "resets_at": resets_at}

        extra = payload.get("extra_usage")
        if extra is not None:
            if not isinstance(extra, dict):
                raise cls._invalid_response("extra_usage is invalid")
            result["extra_usage"] = {
                key: extra.get(key)
                for key in (
                    "is_enabled",
                    "monthly_limit",
                    "used_credits",
                    "utilization",
                    "currency",
                    "disabled_reason",
                )
            }

        limits = payload.get("limits")
        if limits is not None:
            if not isinstance(limits, list) or not all(isinstance(item, dict) for item in limits):
                raise cls._invalid_response("limits is invalid")
            result["limits"] = limits
        return result

    @staticmethod
    def _invalid_response(detail: str) -> RouterError:
        return RouterError(
            f"Claude account usage returned an invalid response: {detail}",
            type="upstream_error",
            code="invalid_claude_account_response",
            status_code=502,
        )
