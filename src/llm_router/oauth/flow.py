from __future__ import annotations

import asyncio
import base64
import hashlib
import http.server
import json
import secrets
import time
import urllib.parse
import webbrowser

import httpx

from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.errors import RouterError
from llm_router.http_client import create_async_client
from llm_router.oauth import constants


def _challenge_of(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def make_pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode()
    return verifier, _challenge_of(verifier)


def build_authorize_url(
    state: str,
    verifier: str,
    *,
    redirect_uri: str = constants.REDIRECT_URI,
) -> str:
    params = {
        "response_type": "code",
        "client_id": constants.CLIENT_ID,
        "redirect_uri": redirect_uri,
        "scope": " ".join(constants.SCOPES),
        "state": state,
        "code_challenge": _challenge_of(verifier),
        "code_challenge_method": "S256",
    }
    return f"{constants.AUTHORIZE_URL}?{urllib.parse.urlencode(params)}"


async def exchange_code(
    client: httpx.AsyncClient,
    code: str,
    verifier: str,
    *,
    state: str | None = None,
    redirect_uri: str = constants.REDIRECT_URI,
) -> dict:
    body = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": constants.CLIENT_ID,
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
    }
    if state is not None:
        body["state"] = state
    try:
        response = await client.post(constants.TOKEN_URL, json=body)
    except httpx.RequestError as exc:
        raise RouterError(
            f"OAuth token exchange connection failed: {exc}",
            type="authentication_error",
            code="oauth_exchange_failed",
            status_code=502,
        ) from exc
    if response.status_code != 200:
        raise RouterError(
            f"OAuth token exchange failed ({response.status_code}): {response.text}",
            type="authentication_error",
            code="oauth_exchange_failed",
            status_code=401,
        )
    try:
        data = response.json()
        access_token = data["access_token"]
        expires_in = int(data.get("expires_in", 3600))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise RouterError(
            "OAuth token exchange returned an invalid response",
            type="authentication_error",
            code="oauth_exchange_failed",
            status_code=502,
        ) from exc
    tokens = {
        "access_token": access_token,
        "refresh_token": data.get("refresh_token"),
        "expires_at": time.time() + expires_in,
    }
    if data.get("scope") is not None:
        tokens["scope"] = data["scope"]
    return tokens


def login(store: TokenStore, *, timeout: float = 300.0) -> None:
    verifier, _ = make_pkce()
    state = secrets.token_urlsafe(24)
    received: dict[str, str | None] = {}

    class CallbackHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path != "/callback":
                self.send_error(404)
                return
            query = urllib.parse.parse_qs(parsed.query)
            received["code"] = query.get("code", [None])[0]
            received["state"] = query.get("state", [None])[0]
            received["error"] = query.get("error", [None])[0]
            is_valid = bool(received["code"]) and received["state"] == state
            body = (
                b"Login complete. You can close this tab."
                if is_valid
                else b"Login failed. Return to the terminal for details."
            )
            self.send_response(200 if is_valid else 400)
            self.send_header("content-type", "text/plain; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *args: object) -> None:
            return

    server = http.server.HTTPServer(("127.0.0.1", 0), CallbackHandler)
    server.timeout = timeout
    port = int(server.server_address[1])
    redirect_uri = constants.callback_uri(port)
    authorize_url = build_authorize_url(
        state=state,
        verifier=verifier,
        redirect_uri=redirect_uri,
    )
    print(f"Opening browser for Anthropic login:\n{authorize_url}")
    webbrowser.open(authorize_url)
    try:
        server.handle_request()
    finally:
        server.server_close()

    if received.get("error"):
        raise RouterError(
            f"OAuth authorization failed: {received['error']}",
            type="authentication_error",
            code="oauth_authorization_failed",
            status_code=401,
        )
    if received.get("state") != state:
        raise RouterError(
            "OAuth state mismatch or callback timeout",
            type="authentication_error",
            code="oauth_state_mismatch",
            status_code=401,
        )
    code = received.get("code")
    if not code:
        raise RouterError(
            "OAuth callback did not contain an authorization code",
            type="authentication_error",
            code="oauth_authorization_failed",
            status_code=401,
        )

    async def complete_exchange() -> dict:
        async with create_async_client(timeout=httpx.Timeout(30.0)) as client:
            return await exchange_code(
                client,
                code=code,
                verifier=verifier,
                state=state,
                redirect_uri=redirect_uri,
            )

    store.save(asyncio.run(complete_exchange()))
    print("Saved Anthropic credentials.")
