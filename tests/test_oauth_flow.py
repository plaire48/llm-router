import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx

from llm_router.errors import RouterError
from llm_router.oauth import constants
from llm_router.oauth.flow import build_authorize_url, exchange_code, make_pkce


def test_pkce_challenge_is_s256_of_verifier():
    verifier, challenge = make_pkce()
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    assert 43 <= len(verifier) <= 128
    assert challenge == expected


def test_authorize_url_has_pkce_client_scopes_and_redirect():
    url = build_authorize_url(
        state="st",
        verifier="v",
        redirect_uri="http://localhost:54321/callback",
    )
    query = parse_qs(urlparse(url).query)
    assert query["client_id"] == [constants.CLIENT_ID]
    assert query["code_challenge_method"] == ["S256"]
    assert query["response_type"] == ["code"]
    assert query["state"] == ["st"]
    assert query["redirect_uri"] == ["http://localhost:54321/callback"]
    assert query["scope"] == [" ".join(constants.SCOPES)]


@respx.mock
async def test_exchange_code_uses_json_and_normalizes_tokens():
    captured = {}

    def handler(request):
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "access_token": "a",
                "refresh_token": "r",
                "expires_in": 3600,
                "scope": "user:inference",
            },
        )

    respx.post(constants.TOKEN_URL).mock(side_effect=handler)
    async with httpx.AsyncClient() as client:
        tokens = await exchange_code(
            client,
            code="c",
            verifier="v",
            state="st",
            redirect_uri="http://localhost:54321/callback",
        )
    assert captured["body"]["state"] == "st"
    assert captured["body"]["redirect_uri"] == "http://localhost:54321/callback"
    assert tokens["access_token"] == "a"
    assert tokens["expires_at"] > time.time()
    assert tokens["scope"] == "user:inference"


@respx.mock
async def test_exchange_code_failure_is_actionable():
    respx.post(constants.TOKEN_URL).mock(return_value=httpx.Response(401, text="bad code"))
    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await exchange_code(client, code="bad", verifier="v")
    assert error.value.code == "oauth_exchange_failed"
