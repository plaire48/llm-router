from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import socket
import stat
import tempfile
from collections import deque
from collections.abc import Callable
from contextlib import suppress
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from llm_router.aipro import effective_aipro_base_url, is_aipro_profile
from llm_router.aipro_auth import AI_PRO_JWT_ENV, AIProTokenStore
from llm_router.credentials.env_key import load_provider_env
from llm_router.errors import RouterError
from llm_router.http_client import prepare_extra_ca_file, resolve_environment_path
from llm_router.models import Profile
from llm_router.opencode_tool_bridge import OpenCodeToolBridge

BinaryFinder = Callable[[str], str | None]
BundledResolver = Callable[[], str | None]
BrowserOpener = Callable[[str], object]
WINDOWS_CREATE_NO_WINDOW = 0x08000000
LEGACY_OPENCODE_PORT = 4097


def background_process_options(platform: str | None = None) -> dict[str, int]:
    """Keep the bundled console executable invisible when launched on Windows."""
    return {"creationflags": WINDOWS_CREATE_NO_WINDOW} if (platform or os.name) == "nt" else {}


def bundled_opencode_path() -> str | None:
    """Return the platform-specific OpenCode binary shipped in the wheel."""
    executable = "opencode.exe" if os.name == "nt" else "opencode"
    candidate = Path(__file__).resolve().parent / "_vendor" / "opencode" / executable
    return str(candidate) if candidate.is_file() else None


def _loopback_socket_host(host: str) -> tuple[int, str]:
    if host == "::1":
        return socket.AF_INET6, host
    return socket.AF_INET, "127.0.0.1" if host == "localhost" else host


def _allocate_loopback_port(host: str) -> int:
    family, bind_host = _loopback_socket_host(host)
    with socket.socket(family, socket.SOCK_STREAM) as listener:
        listener.bind((bind_host, 0))
        return int(listener.getsockname()[1])


def _loopback_port_available(host: str, port: int) -> bool:
    family, bind_host = _loopback_socket_host(host)
    try:
        with socket.socket(family, socket.SOCK_STREAM) as listener:
            listener.bind((bind_host, port))
    except OSError:
        return False
    return True


def _loopback_url(host: str, port: int) -> str:
    display_host = f"[{host}]" if ":" in host else host
    return f"http://{display_host}:{port}"


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
        startup_timeout: float = 120.0,
        aipro_token_store: AIProTokenStore | None = None,
    ) -> None:
        configured_base_url = base_url.rstrip("/")
        parsed_base_url = urlsplit(configured_base_url)
        configured_host = parsed_base_url.hostname
        configured_port = parsed_base_url.port
        self._allow_port_fallback = bool(
            auto_start
            and parsed_base_url.scheme == "http"
            and configured_host in {"127.0.0.1", "localhost", "::1"}
            and configured_port in {0, LEGACY_OPENCODE_PORT}
        )
        self._port_relocated = False
        if configured_host and configured_port == 0:
            configured_base_url = _loopback_url(
                configured_host,
                _allocate_loopback_port(configured_host),
            )
        self.base_url = configured_base_url
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
        self.aipro_token_store = aipro_token_store or AIProTokenStore.default()
        self.process: asyncio.subprocess.Process | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._stderr_lines: deque[str] = deque(maxlen=20)
        self._last_health_error: str | None = None
        self._lock = asyncio.Lock()
        self._profile_lock = asyncio.Lock()
        self._api_profile_configs: dict[str, dict[str, object]] = {}
        self._api_profile_signatures: dict[str, tuple[str, ...]] = {}
        self.tool_bridge = OpenCodeToolBridge(self.directory)

    @property
    def binary_available(self) -> bool:
        return self._resolve_binary() is not None

    @property
    def auth_path(self) -> Path:
        return self.directory / "data" / "opencode" / "auth.json"

    async def ready(self, client: httpx.AsyncClient) -> bool:
        try:
            response = await client.get(f"{self.base_url}/global/health", timeout=1.0)
            if response.status_code != 200:
                self._last_health_error = f"HTTP {response.status_code}"
                return False
            payload = response.json()
            healthy = isinstance(payload, dict) and payload.get("healthy") is True
            self._last_health_error = None if healthy else "invalid health response"
            return healthy
        except (httpx.HTTPError, ValueError) as exc:
            self._last_health_error = f"{type(exc).__name__}: {exc}"
            return False

    async def usable(self, client: httpx.AsyncClient) -> bool:
        healthy = await self.ready(client)
        return healthy and (not self.auto_start or self.process is not None)

    async def ensure_started(self, client: httpx.AsyncClient) -> None:
        if await self.ready(client) and (not self.auto_start or self.process is not None):
            return
        async with self._lock:
            if await self.ready(client):
                if not self.auto_start or self.process is not None:
                    return
                self._relocate_from_conflict()
            if not self.auto_start:
                raise self._unavailable_error()
            if self.process is not None and self.process.returncode is not None:
                await self.close()
            executable = self._resolve_binary()
            if executable is None:
                raise RouterError(
                    "배포 패키지에 포함된 OpenCode 실행 파일을 찾을 수 없습니다. "
                    f"설정값: {self.binary!r}. "
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
            if not _loopback_port_available(host, port):
                self._relocate_from_conflict()
                parsed = urlsplit(self.base_url)
                host = parsed.hostname
                port = parsed.port or 80
                if host is None or not _loopback_port_available(host, port):
                    raise self._port_in_use_error()
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            environment = self._isolated_environment()
            self._stderr_lines.clear()
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
                    stderr=asyncio.subprocess.PIPE,
                    **background_process_options(),
                )
            except OSError as exc:
                raise self._unavailable_error(
                    f"실행 파일: {executable}. 운영체제 오류: {exc}"
                ) from exc

            process_stderr = getattr(self.process, "stderr", None)
            if process_stderr is not None:
                self._stderr_task = asyncio.create_task(self._capture_stderr(process_stderr))

            loop = asyncio.get_running_loop()
            deadline = loop.time() + self.startup_timeout
            while loop.time() < deadline:
                if self.process.returncode is not None:
                    break
                if await self.ready(client):
                    return
                await asyncio.sleep(0.1)
            return_code = self.process.returncode
            process_pid = getattr(self.process, "pid", None)
            await self.close()
            if return_code is not None:
                detail = f"OpenCode가 준비 전에 종료되었습니다(종료 코드 {return_code})."
            else:
                process_detail = f"(PID {process_pid})" if process_pid is not None else ""
                detail = (
                    f"실행 파일을 찾았고 OpenCode 프로세스{process_detail}를 시작했지만 "
                    f"{self.startup_timeout:g}초 안에 {self.base_url}/global/health가 "
                    "응답하지 않았습니다."
                )
                if self._last_health_error:
                    detail += f" 마지막 확인 오류: {self._last_health_error}."
            stderr = self._startup_stderr()
            if stderr:
                detail = f"{detail} OpenCode 오류: {stderr}"
            raise self._unavailable_error(f"실행 파일: {executable}. {detail}")

    async def ensure_profile(self, client: httpx.AsyncClient, profile: Profile) -> None:
        """Start OpenCode with an AI Pro API key or browser JWT custom provider."""
        if not is_aipro_profile(profile):
            await self.ensure_started(client)
            return
        if not profile.base_url:
            raise RouterError(
                "AI Pro requires an endpoint.",
                type="configuration_error",
                code="invalid_aipro_profile",
                status_code=422,
            )
        if not self.auto_start:
            raise RouterError(
                "AI Pro requires the router-managed OpenCode runtime.",
                type="configuration_error",
                code="aipro_managed_opencode_required",
                status_code=503,
            )
        if profile.auth == "api_key":
            load_provider_env()
            credential_env = profile.api_key_env
            credential = os.environ.get(credential_env or "", "").strip()
            if not credential_env or not credential:
                raise RouterError(
                    f"missing credential: set {credential_env or 'AI Pro API key'} in .env",
                    type="authentication_error",
                    code="missing_credential",
                    status_code=401,
                )
            base_url = effective_aipro_base_url(profile.base_url, profile.auth)
            options: dict[str, object] = {
                "baseURL": base_url,
                "apiKey": f"{{env:{credential_env}}}",
                "headers": {"Authorization": f"Bearer {{env:{credential_env}}}"},
            }
        elif profile.auth == "oauth":
            credential_env = AI_PRO_JWT_ENV
            credential = self.aipro_token_store.token()
            if not credential:
                raise RouterError(
                    "AI Pro SAML 브라우저 로그인이 필요합니다.",
                    type="authentication_error",
                    code="aipro_browser_login_required",
                    status_code=401,
                )
            base_url = effective_aipro_base_url(profile.base_url, profile.auth)
            options = {
                "baseURL": base_url,
                "apiKey": f"{{env:{credential_env}}}",
                "headers": {"Authorization": f"{{env:{credential_env}}}"},
            }
        else:
            raise RouterError(
                "AI Pro 인증 방식이 올바르지 않습니다.",
                type="configuration_error",
                code="invalid_aipro_profile",
                status_code=422,
            )

        provider_id = self.provider_id(profile)
        config: dict[str, object] = {
            "npm": "@ai-sdk/openai-compatible",
            "name": f"AI Pro ({profile.name})",
            "options": options,
            "models": {profile.model: {"name": profile.model}},
        }
        signature = (
            profile.auth,
            base_url,
            profile.model,
            credential_env,
            hashlib.sha256(credential.encode("utf-8")).hexdigest(),
        )
        async with self._profile_lock:
            if self._api_profile_signatures.get(profile.name) != signature:
                self._api_profile_configs[provider_id] = config
                self._api_profile_signatures[profile.name] = signature
                await self.close()
            await self.ensure_started(client)

    async def remove_profile(self, profile: Profile) -> None:
        if not is_aipro_profile(profile):
            return
        async with self._profile_lock:
            self._api_profile_configs.pop(self.provider_id(profile), None)
            self._api_profile_signatures.pop(profile.name, None)
            await self.close()

    async def clear_aipro_browser_profiles(self) -> None:
        """Drop browser-JWT configs after logout so future starts contain no stale auth refs."""
        async with self._profile_lock:
            browser_profiles = [
                name
                for name, signature in self._api_profile_signatures.items()
                if signature and signature[0] == "oauth"
            ]
            for name in browser_profiles:
                self._api_profile_configs.pop(f"llm-router-aipro-{name}", None)
                self._api_profile_signatures.pop(name, None)
            await self.close()

    @staticmethod
    def provider_id(profile: Profile) -> str:
        return f"llm-router-aipro-{profile.name}"

    async def login_openai(
        self,
        client: httpx.AsyncClient,
        *,
        browser_opener: BrowserOpener,
        timeout: float = 300.0,
    ) -> None:
        """Run ChatGPT OAuth through the router-owned OpenCode server."""
        await self.ensure_started(client)
        restart_after_login = self.process is not None
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
        if restart_after_login:
            # OpenCode caches provider options for the lifetime of an instance. If a
            # request initialized the OpenAI provider before OAuth completed, that
            # instance keeps the API-key-only options until the server restarts.
            await self.close()
            await self.ensure_started(client)

    async def close(self) -> None:
        await self.tool_bridge.close()
        process = self.process
        self.process = None
        if process is None:
            await self._finish_stderr_capture()
            return
        if process.returncode is None:
            try:
                process.terminate()
            except ProcessLookupError:
                pass
            else:
                try:
                    await asyncio.wait_for(process.wait(), timeout=2.0)
                except TimeoutError:
                    process.kill()
                    await process.wait()
        await self._finish_stderr_capture()

    async def _capture_stderr(self, stream: asyncio.StreamReader) -> None:
        while line := await stream.readline():
            decoded = line.decode("utf-8", errors="replace").strip()
            if decoded:
                self._stderr_lines.append(decoded)

    async def _finish_stderr_capture(self) -> None:
        task = self._stderr_task
        self._stderr_task = None
        if task is None:
            return
        try:
            await asyncio.wait_for(task, timeout=1.0)
        except TimeoutError:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    def _startup_stderr(self) -> str:
        return " | ".join(self._stderr_lines)[-1200:]

    def remove_openai_auth(self) -> None:
        """Remove only the router-owned OpenAI credential from OpenCode storage."""
        self._remove_auth_entries("openai")

    def _read_auth_payload(self) -> dict[str, object]:
        try:
            payload = json.loads(self.auth_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as exc:
            raise RouterError(
                "OpenCode 인증 저장소를 읽을 수 없습니다.",
                type="authentication_error",
                code="opencode_auth_store_error",
                status_code=500,
            ) from exc
        if not isinstance(payload, dict):
            return {}
        return payload

    def _remove_auth_entries(self, key: str) -> None:
        payload = self._read_auth_payload()
        payload.pop(key, None)
        payload.pop(f"{key}/", None)
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

    def _isolated_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        for name in ("CODEX_CA_CERTIFICATE", "NODE_EXTRA_CA_CERTS"):
            if resolved := resolve_environment_path(name):
                environment[name] = prepare_extra_ca_file(name, resolved)
        for name in (
            "BUN_OPTIONS",
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "OPENAI_ORGANIZATION",
            "OPENAI_ORG_ID",
            "OPENAI_PROJECT",
            "OPENCODE_AUTH_CONTENT",
            "OPENCODE_CONFIG",
            "OPENCODE_CONFIG_DIR",
            "OPENCODE_CONFIG_CONTENT",
            "OPENCODE_DISABLE_DEFAULT_PLUGINS",
            "OPENCODE_DISABLE_AUTOUPDATE",
            "OPENCODE_EXPERIMENTAL_WEBSOCKETS",
            "OPENCODE_SERVER_PASSWORD",
            "OPENCODE_SERVER_USERNAME",
            "OPENCODE_DISABLE_TERMINAL_TITLE",
        ):
            environment.pop(name, None)
        environment.pop(AI_PRO_JWT_ENV, None)
        config: dict[str, object] = {
            "$schema": "https://opencode.ai/config.json",
            "autoupdate": False,
            "permission": "deny",
            "share": "disabled",
        }
        if self._api_profile_configs:
            config["provider"] = self._api_profile_configs
        environment.update(
            {
                "OPENCODE_DISABLE_PROJECT_CONFIG": "true",
                "OPENCODE_DISABLE_AUTOUPDATE": "true",
                "OPENCODE_DISABLE_TERMINAL_TITLE": "true",
                "OPENCODE_CONFIG_CONTENT": json.dumps(config),
                "XDG_CACHE_HOME": str(self.directory / "cache"),
                "XDG_CONFIG_HOME": str(self.directory / "config"),
                "XDG_DATA_HOME": str(self.directory / "data"),
            }
        )
        aipro_jwt = self.aipro_token_store.token()
        if aipro_jwt and any(
            signature and signature[0] == "oauth"
            for signature in self._api_profile_signatures.values()
        ):
            environment[AI_PRO_JWT_ENV] = aipro_jwt
        return environment

    def _resolve_binary(self) -> str | None:
        configured = self.binary.strip()
        if not configured or configured.casefold() in {"opencode", "opencode.exe"}:
            bundled = self.bundled_resolver()
            if bundled is not None:
                return bundled
            lookup = configured or "opencode"
            found = self.binary_finder(lookup)
            if found is None and lookup.casefold() == "opencode.exe":
                found = self.binary_finder("opencode")
            return found
        candidate = Path(configured).expanduser()
        if candidate.parent != Path("."):
            return str(candidate) if candidate.is_file() else None
        return self.binary_finder(configured)

    def _relocate_from_conflict(self) -> None:
        parsed = urlsplit(self.base_url)
        host = parsed.hostname
        if not self._allow_port_fallback or self._port_relocated or host is None:
            raise self._port_in_use_error()
        self.base_url = _loopback_url(host, _allocate_loopback_port(host))
        self._port_relocated = True

    @staticmethod
    def _port_in_use_error() -> RouterError:
        return RouterError(
            "내부 OpenCode 포트를 다른 서버가 사용 중입니다. "
            "자동 포트 선택을 사용하려면 LLM_ROUTER_OPENCODE_URL을 "
            "http://127.0.0.1:0으로 설정하세요.",
            type="configuration_error",
            code="opencode_port_in_use",
            status_code=503,
        )

    @staticmethod
    def _unavailable_error(detail: str | None = None) -> RouterError:
        return RouterError(
            "OpenCode 내부 서버에 연결할 수 없습니다." + (f" {detail}" if detail else ""),
            type="upstream_error",
            code="opencode_runtime_unavailable",
            status_code=503,
        )
