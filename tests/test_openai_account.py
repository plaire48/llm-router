import json
import ssl
import time
from urllib.parse import parse_qs

import httpx
import pytest
import respx

from llm_router.credentials.openai_oauth import OpenAIAccountStore
from llm_router.errors import RouterError
from llm_router.usage.openai_account import (
    OPENAI_ACCOUNT_USAGE_URL,
    OPENAI_TOKEN_URL,
    OPENCODE_ACCOUNT_USER_AGENT,
    OpenAIAccountSource,
)


def _store(tmp_path, *, expired: bool = False) -> OpenAIAccountStore:
    store = OpenAIAccountStore.from_opencode(tmp_path / "auth.json")
    store.save(
        {
            "openai": {
                "type": "oauth",
                "access": "openai-access",
                "refresh": "openai-refresh",
                "expires": (time.time() + (-60 if expired else 3600)) * 1000,
                "accountId": "account_1",
                "metadata": {"kept": True},
            },
            "other": {"type": "api", "key": "preserved"},
        }
    )
    return store


def _usage_payload() -> dict:
    return {
        "plan_type": "enterprise",
        "rate_limit": {
            "primary_window": {
                "used_percent": 32,
                "limit_window_seconds": 604800,
                "reset_at": 1_800_000_000,
            },
            "secondary_window": None,
        },
        "credits": {
            "has_credits": True,
            "unlimited": False,
            "balance": "4500",
        },
        "spend_control": {
            "reached": False,
            "individual_limit": {
                "limit": "6000",
                "used": "1500",
                "remaining_percent": 75,
                "reset_at": 1_800_000_000,
            },
        },
        "rate_limit_reached_type": None,
    }


@respx.mock
async def test_reads_openai_credits_from_the_authenticated_account_api(tmp_path):
    route = respx.get(OPENAI_ACCOUNT_USAGE_URL).mock(
        return_value=httpx.Response(200, json=_usage_payload())
    )
    async with httpx.AsyncClient() as client:
        report = await OpenAIAccountSource(store=_store(tmp_path), client=client).report()

    assert report.rate_limits["credits"]["balance"] == "4500"
    assert report.rate_limits["credits"]["hasCredits"] is True
    assert report.rate_limits["individualLimit"]["remainingPercent"] == 75
    assert report.rate_limits["primary"]["windowDurationMins"] == 10080
    assert report.to_dict()["source"] == "openai_chatgpt_usage_api"
    assert report.to_dict()["token_usage"]["daily_usage_buckets"] == []
    request = route.calls.last.request
    assert request.method == "GET"
    assert request.headers["authorization"] == "Bearer openai-access"
    assert request.headers["chatgpt-account-id"] == "account_1"
    assert request.headers["user-agent"] == OPENCODE_ACCOUNT_USER_AGENT
    assert request.headers["originator"] == "opencode"
    assert request.headers["accept"] == "application/json"


@respx.mock
async def test_refreshes_expired_opencode_oauth_before_reading_credits(tmp_path):
    store = _store(tmp_path, expired=True)
    refresh = respx.post(OPENAI_TOKEN_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": "openai-new-access",
                "refresh_token": "openai-new-refresh",
                "expires_in": 3600,
            },
        )
    )
    usage = respx.get(OPENAI_ACCOUNT_USAGE_URL).mock(
        return_value=httpx.Response(200, json=_usage_payload())
    )

    async with httpx.AsyncClient() as client:
        await OpenAIAccountSource(store=store, client=client).report()

    form = parse_qs(refresh.calls.last.request.content.decode())
    assert form["grant_type"] == ["refresh_token"]
    assert form["refresh_token"] == ["openai-refresh"]
    assert usage.calls.last.request.headers["authorization"] == "Bearer openai-new-access"
    saved = json.loads(store.path.read_text(encoding="utf-8"))
    assert saved["openai"]["access"] == "openai-new-access"
    assert saved["openai"]["refresh"] == "openai-new-refresh"
    assert saved["openai"]["metadata"] == {"kept": True}
    assert saved["other"] == {"type": "api", "key": "preserved"}


@respx.mock
async def test_openai_account_usage_uses_stale_api_cache_on_failure(tmp_path):
    route = respx.get(OPENAI_ACCOUNT_USAGE_URL).mock(
        side_effect=[
            httpx.Response(200, json=_usage_payload()),
            httpx.Response(429, json={}),
        ]
    )
    ticks = iter([0.0, 0.0, 301.0, 301.0])
    async with httpx.AsyncClient() as client:
        source = OpenAIAccountSource(
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
async def test_openai_account_usage_rejects_invalid_credit_shape(tmp_path):
    respx.get(OPENAI_ACCOUNT_USAGE_URL).mock(
        return_value=httpx.Response(
            200,
            json={"rate_limit": {}, "credits": {"has_credits": "yes"}},
        )
    )
    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await OpenAIAccountSource(store=_store(tmp_path), client=client).report()
    assert error.value.code == "invalid_openai_account_response"


@respx.mock
async def test_enterprise_credit_response_can_omit_rate_limit_and_credit_flags(tmp_path):
    respx.get(OPENAI_ACCOUNT_USAGE_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "plan_type": "enterprise",
                "rate_limit": None,
                "credits": {"balance": "9000"},
                "spend_control": None,
            },
        )
    )
    async with httpx.AsyncClient() as client:
        report = await OpenAIAccountSource(store=_store(tmp_path), client=client).report()

    assert report.rate_limits["primary"] is None
    assert report.rate_limits["credits"] == {
        "hasCredits": True,
        "unlimited": False,
        "balance": "9000",
    }


@respx.mock
async def test_openai_account_usage_retries_a_bad_gateway_once(tmp_path):
    route = respx.get(OPENAI_ACCOUNT_USAGE_URL).mock(
        side_effect=[
            httpx.Response(502, json={}),
            httpx.Response(200, json=_usage_payload()),
        ]
    )
    async with httpx.AsyncClient() as client:
        report = await OpenAIAccountSource(store=_store(tmp_path), client=client).report()

    assert route.call_count == 2
    assert report.rate_limits["credits"]["balance"] == "4500"


async def test_openai_account_usage_requires_browser_login(tmp_path):
    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await OpenAIAccountSource(
                store=OpenAIAccountStore.from_opencode(tmp_path / "missing.json"),
                client=client,
            ).report()
    assert error.value.code == "oauth_required"


async def test_openai_account_usage_explains_tls_certificate_failure(tmp_path, monkeypatch):
    class CertificateFailingClient:
        async def get(self, *args, **kwargs):
            request = httpx.Request("GET", OPENAI_ACCOUNT_USAGE_URL)
            ssl_error = ssl.SSLCertVerificationError(
                1, "certificate verify failed: unable to get local issuer certificate"
            )
            raise httpx.ConnectError("certificate verify failed", request=request) from ssl_error

    certificate = tmp_path / "sds.crt"
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(certificate))
    source = OpenAIAccountSource(
        store=_store(tmp_path),
        client=CertificateFailingClient(),
    )
    with pytest.raises(RouterError) as error:
        await source.report()

    assert error.value.code == "tls_certificate_verify_failed"
    assert "NODE_EXTRA_CA_CERTS" in error.value.message
    assert str(certificate) in error.value.message
    assert "root and any required intermediate" in error.value.message
