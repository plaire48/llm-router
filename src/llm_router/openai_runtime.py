from __future__ import annotations

import asyncio
import json
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, Self

import certifi
from dotenv import load_dotenv

from llm_router.errors import RouterError

RuntimeResolver = Callable[[], tuple[Path, Path | None]]


def openai_account_home() -> Path:
    configured = os.environ.get("LLM_ROUTER_OPENAI_HOME", "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".llm-router" / "openai"


def bundled_openai_runtime() -> tuple[Path, Path | None]:
    """Return the OpenAI SDK runtime without requiring a separate installation."""
    try:
        from codex_cli_bin import bundled_codex_path, bundled_path_dir

        return bundled_codex_path(), bundled_path_dir()
    except (ImportError, FileNotFoundError, OSError) as exc:
        raise RouterError(
            "OpenAI 로그인 구성 요소를 찾을 수 없습니다. llm-router를 다시 설치하세요.",
            type="configuration_error",
            code="openai_login_runtime_unavailable",
            status_code=503,
        ) from exc


class OpenAIAppServerSession:
    """A cancellable JSON-RPC session with the SDK-bundled OpenAI account runtime."""

    def __init__(
        self,
        *,
        runtime_resolver: RuntimeResolver = bundled_openai_runtime,
        request_timeout: float = 20.0,
    ) -> None:
        self.runtime_resolver = runtime_resolver
        self.request_timeout = request_timeout
        self.process: asyncio.subprocess.Process | None = None
        self._request_id = 0
        self._notifications: list[dict[str, Any]] = []
        self._ca_bundle_path: Path | None = None

    async def __aenter__(self) -> Self:
        await self.start()
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def start(self) -> None:
        if self.process is not None:
            return
        executable, path_dir = self.runtime_resolver()
        load_dotenv(dotenv_path=Path.cwd() / ".env", override=False)
        environment = os.environ.copy()
        environment["CODEX_HOME"] = str(openai_account_home())
        if path_dir is not None:
            current_path = environment.get("PATH", "")
            environment["PATH"] = os.pathsep.join(
                part for part in (str(path_dir), current_path) if part
            )
        extra_ca = environment.get("NODE_EXTRA_CA_CERTS", "").strip()
        if extra_ca and not environment.get("SSL_CERT_FILE", "").strip():
            environment["SSL_CERT_FILE"] = self._merged_ca_bundle(extra_ca)
        if environment.get("SSL_CERT_FILE") and not environment.get("CARGO_HTTP_CAINFO"):
            environment["CARGO_HTTP_CAINFO"] = environment["SSL_CERT_FILE"]
        try:
            self.process = await asyncio.create_subprocess_exec(
                str(executable),
                "--config",
                'cli_auth_credentials_store="file"',
                "app-server",
                "--listen",
                "stdio://",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=environment,
            )
        except OSError as exc:
            self._remove_ca_bundle()
            raise RouterError(
                "OpenAI 계정 서비스를 시작할 수 없습니다.",
                type="upstream_error",
                code="openai_account_service_unavailable",
                status_code=503,
            ) from exc

        try:
            await self.request(
                "initialize",
                {
                    "clientInfo": {
                        "name": "llm_router",
                        "title": "LLM Router",
                        "version": "0.1.0",
                    }
                },
            )
            await self.notify("initialized", {})
        except Exception:
            await self.close()
            raise

    async def close(self) -> None:
        process = self.process
        self.process = None
        if process is None:
            self._remove_ca_bundle()
            return
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
        finally:
            self._remove_ca_bundle()

    def _merged_ca_bundle(self, extra_ca: str) -> str:
        extra_path = Path(extra_ca).expanduser()
        try:
            public_certificates = Path(certifi.where()).read_bytes()
            extra_certificates = extra_path.read_bytes()
        except OSError as exc:
            raise RouterError(
                f"NODE_EXTRA_CA_CERTS 인증서를 읽을 수 없습니다: {exc}",
                type="configuration_error",
                code="tls_ca_bundle_invalid",
                status_code=500,
            ) from exc
        descriptor, name = tempfile.mkstemp(prefix="llm-router-openai-ca-", suffix=".pem")
        path = Path(name)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(public_certificates)
                if not public_certificates.endswith(b"\n"):
                    handle.write(b"\n")
                handle.write(extra_certificates)
        except Exception:
            path.unlink(missing_ok=True)
            raise
        self._ca_bundle_path = path
        return str(path)

    def _remove_ca_bundle(self) -> None:
        if self._ca_bundle_path is not None:
            self._ca_bundle_path.unlink(missing_ok=True)
            self._ca_bundle_path = None

    async def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        await self._write({"method": method, "params": params or {}})

    async def request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self._request_id += 1
        request_id = self._request_id
        message: dict[str, Any] = {"method": method, "id": request_id}
        if params is not None:
            message["params"] = params
        await self._write(message)
        try:
            async with asyncio.timeout(timeout or self.request_timeout):
                while True:
                    incoming = await self._read()
                    if incoming.get("id") != request_id:
                        if "id" not in incoming:
                            self._notifications.append(incoming)
                        continue
                    error = incoming.get("error")
                    if isinstance(error, dict):
                        detail = error.get("message")
                        raise RouterError(
                            detail
                            if isinstance(detail, str)
                            else "OpenAI 계정 요청에 실패했습니다.",
                            type="upstream_error",
                            code="openai_account_request_failed",
                            status_code=502,
                        )
                    result = incoming.get("result")
                    if not isinstance(result, dict):
                        raise self.protocol_error("result is missing")
                    return result
        except TimeoutError as exc:
            raise RouterError(
                "OpenAI 계정 요청 시간이 초과되었습니다.",
                type="upstream_error",
                code="openai_account_timeout",
                status_code=504,
            ) from exc

    async def wait_for_notification(
        self,
        method: str,
        *,
        predicate: Callable[[dict[str, Any]], bool] | None = None,
        timeout: float = 300.0,
    ) -> dict[str, Any]:
        def matches(message: dict[str, Any]) -> bool:
            params = message.get("params")
            return (
                message.get("method") == method
                and isinstance(params, dict)
                and (predicate is None or predicate(params))
            )

        for index, message in enumerate(self._notifications):
            if matches(message):
                return self._notifications.pop(index)["params"]
        try:
            async with asyncio.timeout(timeout):
                while True:
                    message = await self._read()
                    if matches(message):
                        return message["params"]
                    if "id" not in message:
                        self._notifications.append(message)
        except TimeoutError as exc:
            raise RouterError(
                "OpenAI 브라우저 로그인 시간이 초과되었습니다.",
                type="authentication_error",
                code="openai_login_timeout",
                status_code=408,
            ) from exc

    async def _write(self, message: dict[str, Any]) -> None:
        if self.process is None or self.process.stdin is None:
            raise self.protocol_error("service is not running")
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        try:
            await self.process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as exc:
            raise self.protocol_error("service stopped unexpectedly") from exc

    async def _read(self) -> dict[str, Any]:
        if self.process is None or self.process.stdout is None:
            raise self.protocol_error("service output is unavailable")
        line = await self.process.stdout.readline()
        if not line:
            raise self.protocol_error("service stopped before responding")
        try:
            message = json.loads(line)
        except json.JSONDecodeError as exc:
            raise self.protocol_error("response is not valid JSON") from exc
        if not isinstance(message, dict):
            raise self.protocol_error("response is not an object")
        return message

    @staticmethod
    def protocol_error(detail: str) -> RouterError:
        return RouterError(
            f"OpenAI 계정 서비스 응답이 올바르지 않습니다: {detail}",
            type="upstream_error",
            code="invalid_openai_account_response",
            status_code=502,
        )


class OpenAIAccountClient:
    """Managed ChatGPT login, account state, and usage through the official runtime."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], OpenAIAppServerSession] = OpenAIAppServerSession,
    ) -> None:
        self.session_factory = session_factory

    async def login(
        self,
        *,
        browser_opener: Callable[[str], object],
        timeout: float = 300.0,
    ) -> None:
        async with self.session_factory() as session:
            result = await session.request(
                "account/login/start",
                {
                    "type": "chatgpt",
                    "useHostedLoginSuccessPage": True,
                    "appBrand": "chatgpt",
                },
            )
            login_id = result.get("loginId")
            auth_url = result.get("authUrl")
            if not isinstance(login_id, str) or not isinstance(auth_url, str):
                raise session.protocol_error("browser login details are missing")
            opened = await asyncio.to_thread(browser_opener, auth_url)
            if opened is False:
                raise RouterError(
                    "OpenAI 로그인 창을 열 수 없습니다. 기본 브라우저 설정을 확인하세요.",
                    type="configuration_error",
                    code="openai_browser_unavailable",
                    status_code=503,
                )
            completed = await session.wait_for_notification(
                "account/login/completed",
                predicate=lambda params: params.get("loginId") == login_id,
                timeout=timeout,
            )
            if completed.get("success") is not True:
                detail = completed.get("error")
                raise RouterError(
                    detail if isinstance(detail, str) else "OpenAI 로그인을 완료하지 못했습니다.",
                    type="authentication_error",
                    code="openai_login_failed",
                    status_code=401,
                )

    async def account(self, *, refresh_token: bool = False) -> dict[str, Any]:
        async with self.session_factory() as session:
            return await session.request(
                "account/read",
                {"refreshToken": refresh_token},
            )

    async def logout(self) -> None:
        async with self.session_factory() as session:
            await session.request("account/logout")

    async def call_many(self, methods: list[str]) -> dict[str, dict[str, Any]]:
        async with self.session_factory() as session:
            return {method: await session.request(method) for method in methods}
