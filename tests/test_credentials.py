import asyncio
import json
import time

import httpx
import pytest
import respx

from llm_router.credentials.anthropic_oauth import AnthropicOAuth, TokenStore
from llm_router.credentials.base import NoAuthCredential
from llm_router.credentials.env_key import EnvApiKey
from llm_router.errors import RouterError
from llm_router.oauth import constants


async def test_env_key_styles(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-abc")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    bearer = EnvApiKey("OPENAI_API_KEY", style="bearer")
    anthropic = EnvApiKey("ANTHROPIC_API_KEY", style="x-api-key")
    assert await bearer.headers() == {"authorization": "Bearer sk-abc"}
    assert await anthropic.headers() == {
        "x-api-key": "sk-ant",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }


async def test_no_auth_credential_sends_no_authentication_headers():
    assert await NoAuthCredential().headers() == {}


async def test_env_key_missing_raises_401(monkeypatch):
    monkeypatch.delenv("MISSING_KEY", raising=False)
    credential = EnvApiKey("MISSING_KEY", style="bearer")
    with pytest.raises(RouterError) as error:
        await credential.headers()
    assert error.value.status_code == 401
    assert error.value.code == "missing_credential"
    assert "MISSING_KEY" in error.value.message


async def test_env_key_loads_arbitrary_provider_key_from_dotenv(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("CUSTOM_PROVIDER_KEY", raising=False)
    (tmp_path / ".env").write_text("CUSTOM_PROVIDER_KEY=from-dotenv\n")
    credential = EnvApiKey("CUSTOM_PROVIDER_KEY", style="bearer")
    assert await credential.headers() == {"authorization": "Bearer from-dotenv"}


def test_token_store_roundtrip_and_permissions(tmp_path):
    path = tmp_path / "credentials" / "creds.json"
    store = TokenStore(path)
    store.save(
        {
            "access_token": "a",
            "refresh_token": "r",
            "expires_at": time.time() + 1000,
        }
    )
    assert store.load()["access_token"] == "a"
    assert oct(path.stat().st_mode & 0o777) == "0o600"


def test_token_store_expiry(tmp_path):
    store = TokenStore(tmp_path / "c.json")
    assert store.is_expired({"expires_at": time.time() - 1})
    assert store.is_expired({})
    assert not store.is_expired({"expires_at": time.time() + 10_000})


def test_token_store_rejects_malformed_json(tmp_path):
    path = tmp_path / "c.json"
    path.write_text("{")
    with pytest.raises(RouterError, match="credential store is invalid"):
        TokenStore(path).load()


@respx.mock
async def test_oauth_refreshes_with_json_body_when_expired(tmp_path):
    store = TokenStore(tmp_path / "c.json")
    store.save(
        {
            "access_token": "old",
            "refresh_token": "r",
            "expires_at": time.time() - 1,
        }
    )
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"access_token": "new", "refresh_token": "r2", "expires_in": 3600},
        )

    route = respx.post(constants.TOKEN_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        headers = await AnthropicOAuth(store, client).headers()

    assert route.called
    assert captured["body"]["grant_type"] == "refresh_token"
    assert captured["body"]["scope"] == " ".join(constants.SCOPES)
    assert headers["authorization"] == "Bearer new"
    assert store.load()["access_token"] == "new"


@respx.mock
async def test_concurrent_expired_requests_share_one_refresh(tmp_path):
    store = TokenStore(tmp_path / "c.json")
    store.save(
        {
            "access_token": "old",
            "refresh_token": "r",
            "expires_at": time.time() - 1,
        }
    )
    route = respx.post(constants.TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "new", "expires_in": 3600})
    )
    async with httpx.AsyncClient() as client:
        oauth = AnthropicOAuth(store, client)
        headers = await asyncio.gather(oauth.headers(), oauth.headers(), oauth.headers())
    assert route.call_count == 1
    assert {item["authorization"] for item in headers} == {"Bearer new"}


@respx.mock
async def test_oauth_refresh_failure_is_actionable(tmp_path):
    store = TokenStore(tmp_path / "c.json")
    store.save(
        {
            "access_token": "old",
            "refresh_token": "r",
            "expires_at": time.time() - 1,
        }
    )
    respx.post(constants.TOKEN_URL).mock(return_value=httpx.Response(400, json={"error": "x"}))
    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await AnthropicOAuth(store, client).headers()
    assert error.value.code == "oauth_required"
    assert "llm-router oauth login anthropic" in error.value.message


async def test_oauth_no_tokens_raises(tmp_path):
    async with httpx.AsyncClient() as client:
        oauth = AnthropicOAuth(TokenStore(tmp_path / "none.json"), client)
        with pytest.raises(RouterError) as error:
            await oauth.headers()
    assert error.value.code == "oauth_required"
