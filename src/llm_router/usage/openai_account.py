from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from typing import Any

from llm_router.errors import RouterError
from llm_router.openai_runtime import OpenAIAccountClient, OpenAIAppServerSession

RpcCall = Callable[[str], Awaitable[dict[str, Any]]]
BatchRpcCall = Callable[[list[str]], Awaitable[dict[str, dict[str, Any]]]]
CACHE_TTL_SECONDS = 300.0


@dataclass(frozen=True, slots=True)
class OpenAIAccountReport:
    rate_limits: dict[str, Any]
    token_usage: dict[str, Any]
    stale: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "object": "openai_account_usage",
            "status": "ok",
            "source": "openai_account_service",
            "configured": True,
            "stale": self.stale,
            "rate_limits": self.rate_limits,
            "token_usage": self.token_usage,
        }


class OpenAIAccountSource:
    def __init__(
        self,
        *,
        rpc: RpcCall | None = None,
        batch_rpc: BatchRpcCall | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        client = OpenAIAccountClient()
        self.rpc = rpc
        self.batch_rpc = batch_rpc or (None if rpc is not None else client.call_many)
        self.clock = clock
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
                if self.batch_rpc is not None:
                    results = await self.batch_rpc(
                        ["account/rateLimits/read", "account/usage/read"]
                    )
                    rate_limits = results["account/rateLimits/read"]
                    token_usage = results["account/usage/read"]
                else:
                    if self.rpc is None:
                        raise OpenAIAppServerSession.protocol_error("RPC client is missing")
                    rate_limits, token_usage = await asyncio.gather(
                        self.rpc("account/rateLimits/read"),
                        self.rpc("account/usage/read"),
                    )
            except RouterError:
                if self._cached is not None:
                    return replace(self._cached, stale=True)
                raise
            report = OpenAIAccountReport(
                rate_limits=self._normalize_limits(rate_limits),
                token_usage=self._normalize_usage(token_usage),
            )
            self._cached = report
            self._expires_at = current + CACHE_TTL_SECONDS
            return report

    @staticmethod
    def _normalize_limits(payload: dict[str, Any]) -> dict[str, Any]:
        limits = payload.get("rateLimits")
        if not isinstance(limits, dict):
            raise OpenAIAppServerSession.protocol_error("rateLimits is missing")
        individual = limits.get("individualLimit")
        if individual is not None and not isinstance(individual, dict):
            raise OpenAIAppServerSession.protocol_error("individualLimit is invalid")
        return limits

    @staticmethod
    def _normalize_usage(payload: dict[str, Any]) -> dict[str, Any]:
        summary = payload.get("summary")
        buckets = payload.get("dailyUsageBuckets")
        if not isinstance(summary, dict) or (buckets is not None and not isinstance(buckets, list)):
            raise OpenAIAppServerSession.protocol_error("token usage is invalid")
        return {"summary": summary, "daily_usage_buckets": buckets or []}
