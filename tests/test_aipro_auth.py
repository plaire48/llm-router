import base64
import json
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from llm_router.aipro_auth import AIProTokenStore, AIProWebLogin, jwt_claims
from llm_router.errors import RouterError


def _jwt(payload: dict) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature"


def test_aipro_token_store_persists_only_the_jwt_with_private_permissions(tmp_path):
    token = _jwt({"exp": time.time() + 3600, "email": "person@example.com"})
    store = AIProTokenStore(tmp_path / "aipro-auth.json")

    store.save(token)

    assert store.token() == token
    assert store.status()["connected"] is True
    assert store.status()["account"] == "person@example.com"
    assert oct(store.path.stat().st_mode & 0o777) == "0o600"
    assert json.loads(store.path.read_text()) == {
        "access_token": token,
        "expires_at": pytest.approx(jwt_claims(token)["exp"]),
    }


def test_aipro_token_store_rejects_invalid_and_expired_jwts(tmp_path):
    store = AIProTokenStore(tmp_path / "aipro-auth.json")

    with pytest.raises(RouterError) as error:
        store.save("not-a-jwt")
    assert error.value.code == "aipro_invalid_jwt"

    store.save(_jwt({"exp": time.time() - 10}))
    assert store.token() is None
    assert store.status()["connected"] is False


async def test_aipro_browser_login_receives_the_webview_jwt_header(tmp_path):
    opened = []
    token = _jwt({"exp": time.time() + 3600, "sub": "employee"})
    store = AIProTokenStore(tmp_path / "aipro-auth.json")
    login = AIProWebLogin(store, browser_opener=lambda url: opened.append(url), timeout=2)

    started = await login.start()
    port = started["callback_port"]
    query = parse_qs(urlsplit(opened[0]).query)
    assert opened[0].startswith("https://aipro.sdsdev.co.kr/auth/login?")
    assert query == {"port": [str(port)]}

    async with httpx.AsyncClient() as client:
        preflight = await client.options(
            f"http://127.0.0.1:{port}/callback",
            headers={
                "origin": "https://aipro.sdsdev.co.kr",
                "access-control-request-method": "POST",
                "access-control-request-headers": "jwt",
                "access-control-request-private-network": "true",
            },
        )
        callback = await client.post(
            f"http://127.0.0.1:{port}/callback",
            headers={"origin": "https://aipro.sdsdev.co.kr", "jwt": token},
        )

    assert preflight.status_code == 204
    assert preflight.headers["access-control-allow-origin"] == "https://aipro.sdsdev.co.kr"
    assert preflight.headers["access-control-allow-private-network"] == "true"
    assert callback.status_code == 200
    await login._task
    assert store.token() == token
    assert login.is_pending() is False


async def test_aipro_browser_login_rejects_an_untrusted_origin(tmp_path):
    store = AIProTokenStore(tmp_path / "aipro-auth.json")
    login = AIProWebLogin(store, browser_opener=lambda _url: True, timeout=0.2)
    started = await login.start()
    token = _jwt({"exp": time.time() + 3600})

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"http://127.0.0.1:{started['callback_port']}/",
            headers={"origin": "https://attacker.example", "jwt": token},
        )

    assert response.status_code == 403
    await login.close()
    assert store.token() is None
