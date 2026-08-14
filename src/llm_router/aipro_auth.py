from __future__ import annotations

import asyncio
import base64
import json
import os
import stat
import tempfile
import threading
import time
import webbrowser
from collections.abc import Callable
from contextlib import suppress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlencode, urlsplit

from llm_router.aipro import AI_PRO_LOGIN_URL, AI_PRO_ORIGIN
from llm_router.errors import RouterError

if TYPE_CHECKING:
    from llm_router.opencode_runtime import OpenCodeRuntime

BrowserOpener = Callable[[str], object]
AI_PRO_JWT_ENV = "LLM_ROUTER_AIPRO_BROWSER_JWT"
AI_PRO_LOGIN_TIMEOUT = 300.0


def jwt_claims(token: str | None) -> dict[str, Any]:
    if not token or token.count(".") != 2:
        return {}
    encoded = token.split(".", 2)[1]
    encoded += "=" * (-len(encoded) % 4)
    try:
        value = json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


class AIProTokenStore:
    """Persist the AI Pro browser JWT without exposing it through profiles or APIs."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).expanduser()

    @classmethod
    def default(cls) -> AIProTokenStore:
        return cls(Path.home() / ".llm-router" / "aipro-auth.json")

    def load(self) -> dict[str, Any] | None:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except OSError as exc:
            raise RouterError(
                f"AI Pro 브라우저 인증 정보를 읽을 수 없습니다: {exc}",
                type="authentication_error",
                code="aipro_auth_store_error",
                status_code=500,
            ) from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RouterError(
                "AI Pro 브라우저 인증 정보가 손상되었습니다. 다시 로그인하세요.",
                type="authentication_error",
                code="aipro_auth_store_error",
                status_code=401,
            ) from exc
        return payload if isinstance(payload, dict) else None

    def save(self, token: str) -> None:
        normalized = token.strip()
        claims = jwt_claims(normalized)
        if not claims:
            raise RouterError(
                "AI Pro 로그인 콜백이 올바른 JWT를 반환하지 않았습니다.",
                type="authentication_error",
                code="aipro_invalid_jwt",
                status_code=401,
            )
        payload: dict[str, Any] = {"access_token": normalized}
        expires_at = claims.get("exp")
        if isinstance(expires_at, (int, float)):
            payload["expires_at"] = float(expires_at)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, name = tempfile.mkstemp(dir=self.path.parent, prefix=f".{self.path.name}.")
        temporary = Path(name)
        try:
            os.fchmod(descriptor, stat.S_IRUSR | stat.S_IWUSR)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
            os.chmod(self.path, stat.S_IRUSR | stat.S_IWUSR)
        except Exception:
            with suppress(OSError):
                os.close(descriptor)
            temporary.unlink(missing_ok=True)
            raise

    def token(self, *, allow_expired: bool = False) -> str | None:
        payload = self.load()
        token = payload.get("access_token") if payload else None
        if not isinstance(token, str) or not token:
            return None
        expires_at = self.expires_at(payload)
        if not allow_expired and expires_at is not None and time.time() >= expires_at:
            return None
        return token

    @staticmethod
    def expires_at(payload: dict[str, Any] | None) -> float | None:
        value = payload.get("expires_at") if payload else None
        if isinstance(value, (int, float)):
            return float(value)
        token = payload.get("access_token") if payload else None
        claim = jwt_claims(token if isinstance(token, str) else None).get("exp")
        return float(claim) if isinstance(claim, (int, float)) else None

    def status(self) -> dict[str, Any]:
        try:
            payload = self.load()
        except RouterError as exc:
            return {
                "connected": False,
                "status": "error",
                "expires_at": None,
                "account": None,
                "message": exc.message,
            }
        token = payload.get("access_token") if payload else None
        claims = jwt_claims(token if isinstance(token, str) else None)
        expires_at = self.expires_at(payload)
        connected = bool(token) and (expires_at is None or time.time() < expires_at)
        account = next(
            (
                claims.get(key)
                for key in ("email", "preferred_username", "sub")
                if isinstance(claims.get(key), str) and claims.get(key)
            ),
            None,
        )
        return {
            "connected": connected,
            "status": "connected" if connected else "disconnected",
            "expires_at": expires_at,
            "account": account,
            "refreshable": False,
            "message": (
                "SAML 브라우저 로그인으로 받은 AI Pro JWT를 사용합니다."
                if connected
                else "AI Pro SAML 브라우저 로그인이 필요합니다."
            ),
        }

    def delete(self) -> None:
        self.path.unlink(missing_ok=True)


class _CallbackState:
    def __init__(self) -> None:
        self.token: str | None = None
        self.event = threading.Event()


def _token_from_authorization(value: str | None) -> str | None:
    if not value:
        return None
    scheme, separator, token = value.strip().partition(" ")
    if separator and scheme.lower() in {"jwt", "bearer"} and token.strip():
        return token.strip()
    return None


def _callback_handler(state: _CallbackState) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "LLMRouterAIProCallback/1"

        def log_message(self, _format: str, *args: object) -> None:
            return

        def _origin_allowed(self) -> bool:
            origin = self.headers.get("origin")
            return origin is None or origin.rstrip("/").lower() == AI_PRO_ORIGIN.lower()

        def _cors_headers(self) -> None:
            origin = self.headers.get("origin")
            if origin and origin.rstrip("/").lower() == AI_PRO_ORIGIN.lower():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header(
                "Access-Control-Allow-Headers",
                "authorization, content-type, jwt",
            )
            if self.headers.get("access-control-request-private-network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def _respond(self, status: int, message: str) -> None:
            body = json.dumps({"ok": status < 400, "message": message}).encode("utf-8")
            self.send_response(status)
            self._cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            if not self._origin_allowed():
                self._respond(403, "origin not allowed")
                return
            self.send_response(204)
            self._cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _body_token(self) -> str | None:
            try:
                length = min(int(self.headers.get("content-length", "0")), 1024 * 1024)
            except ValueError:
                return None
            body = self.rfile.read(length) if length else b""
            content_type = self.headers.get("content-type", "").lower()
            if "application/json" in content_type:
                try:
                    payload = json.loads(body)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    return None
                if isinstance(payload, dict):
                    return next(
                        (
                            payload.get(key)
                            for key in ("jwt", "token", "auth_jwt")
                            if isinstance(payload.get(key), str) and payload.get(key)
                        ),
                        None,
                    )
            values = parse_qs(body.decode("utf-8", errors="ignore"))
            return next(
                (values[key][0] for key in ("jwt", "token", "auth_jwt") if values.get(key)), None
            )

        def _receive(self, body_token: str | None = None) -> None:
            if not self._origin_allowed():
                self._respond(403, "origin not allowed")
                return
            query = parse_qs(urlsplit(self.path).query)
            token = (
                self.headers.get("jwt")
                or _token_from_authorization(self.headers.get("authorization"))
                or body_token
                or next(
                    (query[key][0] for key in ("jwt", "token", "auth_jwt") if query.get(key)),
                    None,
                )
            )
            if not isinstance(token, str) or not jwt_claims(token.strip()):
                self._respond(400, "valid jwt is required")
                return
            state.token = token.strip()
            state.event.set()
            self._respond(200, "AI Pro login completed")

        def do_GET(self) -> None:
            self._receive()

        def do_POST(self) -> None:
            self._receive(self._body_token())

    return Handler


class AIProWebLogin:
    """Receive the AI Pro SAML webview JWT through a temporary loopback port."""

    def __init__(
        self,
        store: AIProTokenStore,
        *,
        runtime: OpenCodeRuntime | None = None,
        browser_opener: BrowserOpener = webbrowser.open,
        timeout: float = AI_PRO_LOGIN_TIMEOUT,
    ) -> None:
        self.store = store
        self.runtime = runtime
        self.browser_opener = browser_opener
        self.timeout = timeout
        self._task: asyncio.Task[None] | None = None
        self._server: ThreadingHTTPServer | None = None
        self._last_error: str | None = None

    @property
    def available(self) -> bool:
        return True

    async def start(self) -> dict[str, Any]:
        if self.store.status()["connected"]:
            return {"provider": "aipro", "status": "connected", "opened_browser": False}
        if self.is_pending():
            return {"provider": "aipro", "status": "pending", "opened_browser": True}
        self._last_error = None
        state = _CallbackState()
        try:
            server = ThreadingHTTPServer(("127.0.0.1", 0), _callback_handler(state))
        except OSError as exc:
            raise RouterError(
                "AI Pro 로그인 콜백 포트를 열 수 없습니다.",
                type="configuration_error",
                code="aipro_callback_unavailable",
                status_code=503,
            ) from exc
        self._server = server
        threading.Thread(target=server.serve_forever, daemon=True).start()
        login_url = f"{AI_PRO_LOGIN_URL}?{urlencode({'port': server.server_port})}"
        opened = await asyncio.to_thread(self.browser_opener, login_url)
        if opened is False:
            await asyncio.to_thread(self._close_server)
            raise RouterError(
                "AI Pro 로그인 창을 열 수 없습니다. 기본 브라우저 설정을 확인하세요.",
                type="configuration_error",
                code="aipro_browser_unavailable",
                status_code=503,
            )
        self._task = asyncio.create_task(self._wait_for_token(state))
        await asyncio.sleep(0)
        return {
            "provider": "aipro",
            "status": "pending",
            "opened_browser": True,
            "callback_port": server.server_port,
        }

    async def _wait_for_token(self, state: _CallbackState) -> None:
        try:
            loop = asyncio.get_running_loop()
            deadline = loop.time() + self.timeout
            while not state.event.is_set() and loop.time() < deadline:
                await asyncio.sleep(0.1)
            if not state.event.is_set() or not state.token:
                self._last_error = "AI Pro 브라우저 로그인 시간이 초과되었습니다."
                return
            self.store.save(state.token)
            if self.runtime is not None:
                await self.runtime.close()
        except asyncio.CancelledError:
            raise
        except (OSError, RouterError) as exc:
            self._last_error = exc.message if isinstance(exc, RouterError) else str(exc)
        finally:
            await asyncio.to_thread(self._close_server)

    async def logout(self) -> None:
        await self.close()
        self.store.delete()
        if self.runtime is not None:
            clear_profiles = getattr(self.runtime, "clear_aipro_browser_profiles", None)
            if callable(clear_profiles):
                await clear_profiles()
            else:
                await self.runtime.close()

    async def close(self) -> None:
        if self.is_pending() and self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            return
        await asyncio.to_thread(self._close_server)

    def _close_server(self) -> None:
        server = self._server
        self._server = None
        if server is None:
            return
        server.shutdown()
        server.server_close()

    def is_pending(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def last_error(self) -> str | None:
        return self._last_error
