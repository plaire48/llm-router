from __future__ import annotations

import asyncio
import json
import os
import shutil
import stat
import tempfile
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from llm_router.errors import RouterError

BinaryFinder = Callable[[str], str | None]
BundledResolver = Callable[[], str | None]
BrowserOpener = Callable[[str], object]
OPENCODE_USER_AGENT = "opencode/1.18.18"


def bundled_opencode_path() -> str | None:
    """Return the platform-specific OpenCode binary shipped in the wheel."""
    executable = "opencode.exe" if os.name == "nt" else "opencode"
    candidate = Path(__file__).resolve().parent / "_vendor" / "opencode" / executable
    return str(candidate) if candidate.is_file() else None


class OpenCodeRuntime:
    """Own or connect to the loopback OpenCode server used for inference."""

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:4097",
        binary: str = "opencode",
        directory: str | Path | None = None,
        auto_start: bool = True,
        binary_finder: BinaryFinder = shutil.which,
        bundled_resolver: BundledResolver = bundled_opencode_path,
        startup_timeout: float = 8.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.binary = binary
        self.directory = (
            Path(directory).expanduser()
            if directory is not None
            else Path.home() / ".llm-router" / "opencode"
        )
        self.auto_start = auto_start
        self.binary_finder = binary_finder
        self.bundled_resolver = bundled_resolver
        self.startup_timeout = startup_timeout
        self.process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()

    @property
    def binary_available(self) -> bool:
        return self._resolve_binary() is not None

    @property
    def auth_path(self) -> Path:
        return self.directory / "data" / "opencode" / "auth.json"

    async def ready(self, client: httpx.AsyncClient) -> bool:
        try:
            response = await client.get(f"{self.base_url}/global/health", timeout=0.5)
            if response.status_code != 200:
                return False
            payload = response.json()
            return isinstance(payload, dict) and payload.get("healthy") is True
        except (httpx.HTTPError, ValueError):
            return False

    async def usable(self, client: httpx.AsyncClient) -> bool:
        healthy = await self.ready(client)
        return healthy and (not self.auto_start or self.process is not None)

    async def ensure_started(self, client: httpx.AsyncClient) -> None:
        if await self.ready(client):
            if not self.auto_start or self.process is not None:
                return
            raise RouterError(
                "내부 OpenCode 포트를 다른 서버가 사용 중입니다. "
                "LLM_ROUTER_OPENCODE_URL을 변경하세요.",
                type="configuration_error",
                code="opencode_port_in_use",
                status_code=503,
            )
        async with self._lock:
            if await self.ready(client):
                if not self.auto_start or self.process is not None:
                    return
                raise RouterError(
                    "내부 OpenCode 포트를 다른 서버가 사용 중입니다.",
                    type="configuration_error",
                    code="opencode_port_in_use",
                    status_code=503,
                )
            if not self.auto_start:
                raise self._unavailable_error()
            executable = self._resolve_binary()
            if executable is None:
                raise RouterError(
                    "배포 패키지에 포함된 OpenCode 실행 파일을 찾을 수 없습니다. "
                    "현재 플랫폼용 llm-router wheel을 다시 설치하거나 "
                    "LLM_ROUTER_OPENCODE_BINARY에 실행 파일의 절대 경로를 설정하세요.",
                    type="configuration_error",
                    code="opencode_runtime_unavailable",
                    status_code=503,
                )
            parsed = urlsplit(self.base_url)
            host = parsed.hostname
            if parsed.scheme != "http" or host not in {"127.0.0.1", "localhost", "::1"}:
                raise RouterError(
                    "OpenCode 자동 시작 주소는 localhost HTTP 주소여야 합니다.",
                    type="configuration_error",
                    code="opencode_url_invalid",
                    status_code=500,
                )
            port = parsed.port or 80
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            environment = os.environ.copy()
            for name in (
                "OPENCODE_AUTH_CONTENT",
                "OPENCODE_CONFIG",
                "OPENCODE_CONFIG_DIR",
                "OPENCODE_CONFIG_CONTENT",
                "OPENCODE_SERVER_PASSWORD",
                "OPENCODE_SERVER_USERNAME",
            ):
                environment.pop(name, None)
            environment.update(
                {
                    "OPENCODE_DISABLE_PROJECT_CONFIG": "true",
                    "OPENCODE_CONFIG_CONTENT": json.dumps(
                        {
                            "$schema": "https://opencode.ai/config.json",
                            "permission": "deny",
                            "provider": {
                                "openai": {
                                    "options": {
                                        "headers": {"User-Agent": OPENCODE_USER_AGENT},
                                    }
                                }
                            },
                            "share": "disabled",
                        }
                    ),
                    "XDG_CACHE_HOME": str(self.directory / "cache"),
                    "XDG_CONFIG_HOME": str(self.directory / "config"),
                    "XDG_DATA_HOME": str(self.directory / "data"),
                }
            )
            try:
                self.process = await asyncio.create_subprocess_exec(
                    executable,
                    "--pure",
                    "serve",
                    "--hostname",
                    host,
                    "--port",
                    str(port),
                    cwd=self.directory,
                    env=environment,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
            except OSError as exc:
                raise self._unavailable_error() from exc

            loop = asyncio.get_running_loop()
            deadline = loop.time() + self.startup_timeout
            while loop.time() < deadline:
                if self.process.returncode is not None:
                    break
                if await self.ready(client):
                    return
                await asyncio.sleep(0.1)
            await self.close()
            raise self._unavailable_error()

    async def login_openai(
        self,
        client: httpx.AsyncClient,
        *,
        browser_opener: BrowserOpener,
        timeout: float = 300.0,
    ) -> None:
        """Run ChatGPT OAuth through the router-owned OpenCode server."""
        await self.ensure_started(client)
        params = {"directory": str(self.directory)}
        try:
            authorize = await client.post(
                f"{self.base_url}/provider/openai/oauth/authorize",
                params=params,
                json={"method": 0},
            )
            authorize.raise_for_status()
            payload = authorize.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise RouterError(
                "OpenCode에서 OpenAI 로그인을 시작할 수 없습니다.",
                type="upstream_error",
                code="opencode_login_start_failed",
                status_code=502,
            ) from exc
        auth_url = payload.get("url") if isinstance(payload, dict) else None
        method = payload.get("method") if isinstance(payload, dict) else None
        if not isinstance(auth_url, str) or method != "auto":
            raise RouterError(
                "OpenCode가 올바른 OpenAI 로그인 주소를 반환하지 않았습니다.",
                type="upstream_error",
                code="invalid_opencode_login_response",
                status_code=502,
            )
        opened = await asyncio.to_thread(browser_opener, auth_url)
        if opened is False:
            raise RouterError(
                "OpenAI 로그인 창을 열 수 없습니다. 기본 브라우저 설정을 확인하세요.",
                type="configuration_error",
                code="openai_browser_unavailable",
                status_code=503,
            )
        try:
            async with asyncio.timeout(timeout):
                callback = await client.post(
                    f"{self.base_url}/provider/openai/oauth/callback",
                    params=params,
                    json={"method": 0},
                    timeout=None,
                )
            callback.raise_for_status()
            completed = callback.json()
        except TimeoutError as exc:
            raise RouterError(
                "OpenAI 브라우저 로그인 시간이 초과되었습니다.",
                type="authentication_error",
                code="openai_login_timeout",
                status_code=408,
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise RouterError(
                "OpenCode에서 OpenAI 로그인을 완료하지 못했습니다.",
                type="authentication_error",
                code="opencode_login_failed",
                status_code=401,
            ) from exc
        if completed is not True:
            raise RouterError(
                "OpenCode가 OpenAI 로그인 완료를 확인하지 못했습니다.",
                type="authentication_error",
                code="opencode_login_failed",
                status_code=401,
            )

    async def close(self) -> None:
        process = self.process
        self.process = None
        if process is None or process.returncode is not None:
            return
        try:
            process.terminate()
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(process.wait(), timeout=2.0)
        except TimeoutError:
            process.kill()
            await process.wait()

    def remove_openai_auth(self) -> None:
        """Remove only the router-owned OpenAI credential from OpenCode storage."""
        try:
            payload = json.loads(self.auth_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return
        except (OSError, json.JSONDecodeError) as exc:
            raise RouterError(
                "OpenCode 인증 저장소를 정리할 수 없습니다.",
                type="authentication_error",
                code="opencode_auth_store_error",
                status_code=500,
            ) from exc
        if not isinstance(payload, dict):
            return
        payload.pop("openai", None)
        payload.pop("openai/", None)
        self.auth_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, temporary_name = tempfile.mkstemp(
            dir=self.auth_path.parent,
            prefix=f".{self.auth_path.name}.",
        )
        temporary = Path(temporary_name)
        try:
            os.fchmod(descriptor, stat.S_IRUSR | stat.S_IWUSR)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.auth_path)
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            temporary.unlink(missing_ok=True)
            raise

    def _resolve_binary(self) -> str | None:
        candidate = Path(self.binary).expanduser()
        if candidate.parent != Path("."):
            return str(candidate) if candidate.is_file() else None
        if self.binary == "opencode":
            bundled = self.bundled_resolver()
            if bundled is not None:
                return bundled
        return self.binary_finder(self.binary)

    @staticmethod
    def _unavailable_error() -> RouterError:
        return RouterError(
            "OpenCode 내부 서버에 연결할 수 없습니다.",
            type="upstream_error",
            code="opencode_runtime_unavailable",
            status_code=503,
        )
