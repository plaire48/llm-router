import time

import httpx
import pytest
import respx

from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.errors import RouterError
from llm_router.usage.claude_account import CLAUDE_USAGE_URL, ClaudeAccountSource


def _store(tmp_path) -> TokenStore:
    store = TokenStore(tmp_path / "credentials.json")
    store.save(
        {
            "access_token": "claude-access",
            "refresh_token": "claude-refresh",
            "expires_at": time.time() + 3600,
        }
    )
    return store


def _usage_payload() -> dict:
    return {
        "five_hour": {"utilization": 22.5, "resets_at": "2026-08-12T13:00:00Z"},
        "seven_day": {"utilization": 48, "resets_at": "2026-08-17T00:00:00Z"},
        "seven_day_sonnet": None,
        "extra_usage": {
            "is_enabled": True,
            "monthly_limit": 15000,
            "used_credits": 3750,
            "utilization": 25,
            "currency": "USD",
            "disabled_reason": None,
        },
        "limits": [
            {
                "kind": "model_scoped",
                "group": "sonnet",
                "percent": 12,
                "resets_at": "2026-08-17T00:00:00Z",
                "scope": {"model": {"display_name": "Sonnet"}},
            }
        ],
    }


@respx.mock
async def test_reads_only_connected_claude_account_usage(tmp_path):
    route = respx.get(CLAUDE_USAGE_URL).mock(
        return_value=httpx.Response(200, json=_usage_payload())
    )
    async with httpx.AsyncClient() as client:
        report = await ClaudeAccountSource(store=_store(tmp_path), client=client).report()

    assert report.rate_limits["five_hour"]["utilization"] == 22.5
    assert report.rate_limits["extra_usage"]["monthly_limit"] == 15000
    assert report.rate_limits["extra_usage"]["used_credits"] == 3750
    assert route.calls.last.request.method == "GET"
    assert route.calls.last.request.headers["authorization"] == "Bearer claude-access"
    assert route.calls.last.request.headers["anthropic-beta"] == "oauth-2025-04-20"


@respx.mock
async def test_claude_account_usage_uses_stale_cache_on_failure(tmp_path):
    route = respx.get(CLAUDE_USAGE_URL).mock(
        side_effect=[
            httpx.Response(200, json=_usage_payload()),
            httpx.Response(429, json={}),
        ]
    )
    ticks = iter([0.0, 0.0, 301.0, 301.0])
    async with httpx.AsyncClient() as client:
        source = ClaudeAccountSource(
            store=_store(tmp_path),
            client=client,
            clock=lambda: next(ticks),
        )
        fresh = await source.report()
        stale = await source.report()

    assert route.call_count == 2
    assert fresh.stale is False
    assert stale.stale is True
    assert stale.rate_limits == fresh.rate_limits


@respx.mock
async def test_claude_account_usage_rejects_invalid_shape(tmp_path):
    respx.get(CLAUDE_USAGE_URL).mock(
        return_value=httpx.Response(200, json={"five_hour": {"utilization": "many"}})
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await ClaudeAccountSource(store=_store(tmp_path), client=client).report()
    assert error.value.code == "invalid_claude_account_response"


async def test_claude_account_usage_requires_browser_login(tmp_path):
    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await ClaudeAccountSource(
                store=TokenStore(tmp_path / "missing.json"),
                client=client,
            ).report()
    assert error.value.code == "oauth_required"
