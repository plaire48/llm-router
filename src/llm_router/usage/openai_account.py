from __future__ import annotations

import asyncio
import json
import shutil
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from typing import Any

from llm_router.errors import RouterError

RpcCall = Callable[[str], Awaitable[dict[str, Any]]]
BatchRpcCall = Callable[[list[str]], Awaitable[dict[str, dict[str, Any]]]]
CACHE_TTL_SECONDS = 300.0


class CodexAppServerClient:
    """Make a short-lived, read-only account request through the official Codex app-server."""

    def __init__(
        self,
        *,
        binary_finder: Callable[[str], str | None] = shutil.which,
        timeout: float = 20.0,
    ) -> None:
        self.binary_finder = binary_finder
        self.timeout = timeout

    async def call(self, method: str) -> dict[str, Any]:
        return (await self.call_many([method]))[method]

    async def call_many(self, methods: list[str]) -> dict[str, dict[str, Any]]:
        binary = self.binary_finder("codex")
        if binary is None:
            raise RouterError(
                "Codex CLI is required to read OpenAI usage.",
                type="configuration_error",
                code="codex_cli_required",
                status_code=503,
            )
        try:
            process = await asyncio.create_subprocess_exec(
                binary,
                "app-server",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
        except OSError as exc:
            raise RouterError(
                f"Could not start Codex app-server: {exc}",
                type="upstream_error",
                code="codex_app_server_unavailable",
                status_code=503,
            ) from exc

        try:
            if process.stdin is None or process.stdout is None:
                raise self._protocol_error("stdio is unavailable")
            requests: list[dict[str, Any]] = [
                {
                    "method": "initialize",
                    "id": 1,
                    "params": {
                        "clientInfo": {
                            "name": "llm_router",
                            "title": "LLM Router",
                            "version": "0.1.0",
                        }
                    },
                },
                {"method": "initialized"},
            ]
            request_methods = {index + 2: method for index, method in enumerate(methods)}
            requests.extend(
                {"method": method, "id": request_id}
                for request_id, method in request_methods.items()
            )
            for request in requests:
                process.stdin.write((json.dumps(request) + "\n").encode())
            await process.stdin.drain()

            results: dict[str, dict[str, Any]] = {}
            async with asyncio.timeout(self.timeout):
                while len(results) < len(methods):
                    line = await process.stdout.readline()
                    if not line:
                        raise self._protocol_error("process exited before a response")
                    try:
                        message = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(message, dict) or message.get("id") not in request_methods:
                        continue
                    method = request_methods[message["id"]]
                    error = message.get("error")
                    if isinstance(error, dict):
                        detail = error.get("message")
                        raise RouterError(
                            detail if isinstance(detail, str) else "Codex account request failed.",
                            type="upstream_error",
                            code="codex_account_request_failed",
                            status_code=502,
                        )
                    result = message.get("result")
                    if not isinstance(result, dict):
                        raise self._protocol_error("result is missing")
                    results[method] = result
            return results
        except TimeoutError as exc:
            raise RouterError(
                "Codex account usage request timed out.",
                type="upstream_error",
                code="codex_account_timeout",
                status_code=504,
            ) from exc
        finally:
            if process.stdin is not None:
                process.stdin.close()
            if process.returncode is None:
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass
            try:
                await asyncio.wait_for(process.wait(), timeout=2.0)
            except TimeoutError:
                process.kill()
                await process.wait()

    @staticmethod
    def _protocol_error(detail: str) -> RouterError:
        return RouterError(
            f"Codex app-server returned an invalid response: {detail}",
            type="upstream_error",
            code="invalid_codex_account_response",
            status_code=502,
        )


@dataclass(frozen=True, slots=True)
class OpenAIAccountReport:
    rate_limits: dict[str, Any]
    token_usage: dict[str, Any]
    stale: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "object": "openai_account_usage",
            "status": "ok",
            "source": "codex_app_server",
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
        client = CodexAppServerClient()
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
                        raise CodexAppServerClient._protocol_error("RPC client is missing")
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
            raise CodexAppServerClient._protocol_error("rateLimits is missing")
        individual = limits.get("individualLimit")
        if individual is not None and not isinstance(individual, dict):
            raise CodexAppServerClient._protocol_error("individualLimit is invalid")
        return limits

    @staticmethod
    def _normalize_usage(payload: dict[str, Any]) -> dict[str, Any]:
        summary = payload.get("summary")
        buckets = payload.get("dailyUsageBuckets")
        if not isinstance(summary, dict) or (buckets is not None and not isinstance(buckets, list)):
            raise CodexAppServerClient._protocol_error("token usage is invalid")
        return {"summary": summary, "daily_usage_buckets": buckets or []}
