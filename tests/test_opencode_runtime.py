import asyncio
import base64
import json
import time

import httpx
import pytest

from llm_router.aipro_auth import AI_PRO_JWT_ENV, AIProTokenStore
from llm_router.errors import RouterError
from llm_router.models import Profile
from llm_router.opencode_runtime import (
    WINDOWS_CREATE_NO_WINDOW,
    OpenCodeRuntime,
    background_process_options,
)


def _jwt(payload: dict) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature"


async def test_runtime_uses_an_already_running_opencode_server(tmp_path):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, json={"healthy": True, "version": "1.0.0"})

    runtime = OpenCodeRuntime(
        directory=tmp_path,
        auto_start=False,
        binary_finder=lambda _: None,
        bundled_resolver=lambda: None,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await runtime.ensure_started(client)

    assert calls == ["http://127.0.0.1:4097/global/health"]
    assert runtime.process is None


async def test_custom_opencode_port_does_not_reuse_an_unisolated_server(tmp_path):
    def handler(_request):
        return httpx.Response(200, json={"healthy": True, "version": "1.0.0"})

    runtime = OpenCodeRuntime(
        base_url="http://127.0.0.1:4100",
        directory=tmp_path,
        binary_finder=lambda _: "/opt/bin/opencode",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RouterError) as error:
            await runtime.ensure_started(client)

    assert error.value.code == "opencode_port_in_use"


async def test_legacy_default_port_conflict_selects_a_free_port(tmp_path, monkeypatch):
    started = False
    captured = {}

    def handler(request):
        if request.url.port == 4097:
            return httpx.Response(200, json={"healthy": True, "version": "other"})
        if started:
            return httpx.Response(200, json={"healthy": True, "version": "1.18.18"})
        return httpx.Response(503)

    class FakeProcess:
        returncode = None

        def terminate(self):
            self.returncode = 0

        async def wait(self):
            return self.returncode

    async def create_process(*args, **_kwargs):
        nonlocal started
        started = True
        captured["args"] = args
        return FakeProcess()

    monkeypatch.setattr("llm_router.opencode_runtime._allocate_loopback_port", lambda _host: 49152)
    monkeypatch.setattr("llm_router.opencode_runtime._loopback_port_available", lambda *_: True)
    monkeypatch.setattr(
        "llm_router.opencode_runtime.asyncio.create_subprocess_exec",
        create_process,
    )
    runtime = OpenCodeRuntime(directory=tmp_path, binary_finder=lambda _: "/opt/bin/opencode")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await runtime.ensure_started(client)

    assert runtime.base_url == "http://127.0.0.1:49152"
    assert captured["args"][-2:] == ("--port", "49152")
    await runtime.close()


def test_zero_port_is_resolved_when_the_runtime_is_created(monkeypatch):
    monkeypatch.setattr("llm_router.opencode_runtime._allocate_loopback_port", lambda _host: 49153)

    runtime = OpenCodeRuntime(base_url="http://127.0.0.1:0")

    assert runtime.base_url == "http://127.0.0.1:49153"


async def test_runtime_reports_missing_opencode_binary(tmp_path):
    def handler(_request):
        return httpx.Response(503)

    runtime = OpenCodeRuntime(
        directory=tmp_path,
        binary_finder=lambda _: None,
        bundled_resolver=lambda: None,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RouterError) as error:
            await runtime.ensure_started(client)

    assert error.value.code == "opencode_runtime_unavailable"
    assert error.value.status_code == 503


async def test_runtime_reports_opencode_exit_code_and_stderr(tmp_path, monkeypatch):
    def handler(_request):
        return httpx.Response(503)

    stderr = asyncio.StreamReader()
    stderr.feed_data(b"startup failed because execution was blocked\n")
    stderr.feed_eof()

    class FailedProcess:
        returncode = 5

        def __init__(self):
            self.stderr = stderr

    async def create_process(*_args, **_kwargs):
        return FailedProcess()

    monkeypatch.setattr(
        "llm_router.opencode_runtime.asyncio.create_subprocess_exec",
        create_process,
    )
    monkeypatch.setattr("llm_router.opencode_runtime._loopback_port_available", lambda *_: True)
    runtime = OpenCodeRuntime(
        directory=tmp_path,
        bundled_resolver=lambda: "C:/package/opencode.exe",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RouterError) as error:
            await runtime.ensure_started(client)

    assert error.value.code == "opencode_runtime_unavailable"
    assert "종료 코드 5" in error.value.message
    assert "execution was blocked" in error.value.message


async def test_runtime_distinguishes_a_started_process_from_a_missing_binary(tmp_path, monkeypatch):
    def handler(_request):
        return httpx.Response(502)

    class SlowProcess:
        returncode = None
        pid = 31415
        stderr = None

        def terminate(self):
            self.returncode = 0

        async def wait(self):
            return self.returncode

    async def create_process(*_args, **_kwargs):
        return SlowProcess()

    monkeypatch.setattr(
        "llm_router.opencode_runtime.asyncio.create_subprocess_exec",
        create_process,
    )
    monkeypatch.setattr("llm_router.opencode_runtime._loopback_port_available", lambda *_: True)
    runtime = OpenCodeRuntime(
        directory=tmp_path,
        bundled_resolver=lambda: "C:/package/opencode.exe",
        startup_timeout=0.01,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RouterError) as error:
            await runtime.ensure_started(client)

    assert "실행 파일을 찾았고 OpenCode 프로세스(PID 31415)를 시작했지만" in error.value.message
    assert "/global/health" in error.value.message
    assert "마지막 확인 오류: HTTP 502" in error.value.message


async def test_runtime_runs_openai_oauth_entirely_through_opencode(tmp_path):
    calls = []

    def handler(request):
        calls.append((request.method, request.url.path, json.loads(request.content or b"{}")))
        if request.url.path == "/global/health":
            return httpx.Response(200, json={"healthy": True, "version": "1.18.18"})
        if request.url.path.endswith("/oauth/authorize"):
            return httpx.Response(
                200,
                json={
                    "url": "https://auth.openai.com/oauth/authorize?originator=opencode",
                    "method": "auto",
                },
            )
        if request.url.path.endswith("/oauth/callback"):
            return httpx.Response(200, json=True)
        return httpx.Response(404)

    opened = []
    runtime = OpenCodeRuntime(directory=tmp_path, auto_start=False)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await runtime.login_openai(
            client,
            browser_opener=lambda url: opened.append(url) or True,
            timeout=5,
        )

    assert opened == ["https://auth.openai.com/oauth/authorize?originator=opencode"]
    assert calls == [
        ("GET", "/global/health", {}),
        ("POST", "/provider/openai/oauth/authorize", {"method": 0}),
        ("POST", "/provider/openai/oauth/callback", {"method": 0}),
    ]


async def test_runtime_restarts_owned_opencode_after_oauth_login(tmp_path):
    lifecycle = []

    class RestartTrackingRuntime(OpenCodeRuntime):
        async def ensure_started(self, _client):
            lifecycle.append("start")
            self.process = object()

        async def close(self):
            lifecycle.append("close")
            self.process = None

    def handler(request):
        if request.url.path.endswith("/oauth/authorize"):
            return httpx.Response(
                200,
                json={"url": "https://auth.openai.com/oauth/authorize", "method": "auto"},
            )
        if request.url.path.endswith("/oauth/callback"):
            return httpx.Response(200, json=True)
        return httpx.Response(404)

    runtime = RestartTrackingRuntime(directory=tmp_path)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await runtime.login_openai(client, browser_opener=lambda _: True)

    assert lifecycle == ["start", "close", "start"]


async def test_runtime_stops_before_callback_when_browser_cannot_open(tmp_path):
    paths = []

    def handler(request):
        paths.append(request.url.path)
        if request.url.path == "/global/health":
            return httpx.Response(200, json={"healthy": True})
        return httpx.Response(
            200,
            json={"url": "https://auth.openai.com/authorize", "method": "auto"},
        )

    runtime = OpenCodeRuntime(directory=tmp_path, auto_start=False)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RouterError) as error:
            await runtime.login_openai(client, browser_opener=lambda _: False)

    assert error.value.code == "openai_browser_unavailable"
    assert paths == ["/global/health", "/provider/openai/oauth/authorize"]


def test_runtime_prefers_bundled_opencode_over_path_install(tmp_path):
    bundled = tmp_path / "package" / "opencode"
    bundled.parent.mkdir()
    bundled.write_text("binary")
    runtime = OpenCodeRuntime(
        binary_finder=lambda _: "/usr/local/bin/opencode",
        bundled_resolver=lambda: str(bundled),
    )

    assert runtime._resolve_binary() == str(bundled)


def test_runtime_prefers_bundle_for_windows_executable_name(tmp_path):
    bundled = tmp_path / "package" / "opencode.exe"
    bundled.parent.mkdir()
    bundled.write_text("binary")
    runtime = OpenCodeRuntime(
        binary="opencode.exe",
        binary_finder=lambda _: None,
        bundled_resolver=lambda: str(bundled),
    )

    assert runtime._resolve_binary() == str(bundled)


def test_runtime_prefers_bundle_when_binary_setting_is_empty(tmp_path):
    bundled = tmp_path / "package" / "opencode.exe"
    bundled.parent.mkdir()
    bundled.write_text("binary")
    runtime = OpenCodeRuntime(
        binary="   ",
        binary_finder=lambda _: None,
        bundled_resolver=lambda: str(bundled),
    )

    assert runtime._resolve_binary() == str(bundled)


def test_runtime_allows_slow_windows_first_start_by_default():
    assert OpenCodeRuntime().startup_timeout == 120.0


def test_runtime_honors_explicit_opencode_binary_over_bundle(tmp_path):
    explicit = tmp_path / "custom-opencode"
    explicit.write_text("binary")
    runtime = OpenCodeRuntime(
        binary=str(explicit),
        bundled_resolver=lambda: "/package/opencode",
    )

    assert runtime._resolve_binary() == str(explicit)


def test_runtime_hides_the_bundled_console_process_only_on_windows():
    assert background_process_options("nt") == {"creationflags": WINDOWS_CREATE_NO_WINDOW}
    assert background_process_options("posix") == {}


async def test_runtime_starts_a_pure_isolated_headless_server(tmp_path, monkeypatch):
    health_checks = 0
    captured = {}

    def handler(_request):
        nonlocal health_checks
        health_checks += 1
        if health_checks < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"healthy": True, "version": "1.0.0"})

    class FakeProcess:
        returncode = None
        terminated = False

        def terminate(self):
            self.terminated = True
            self.returncode = 0

        async def wait(self):
            return self.returncode

    process = FakeProcess()

    async def create_process(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return process

    monkeypatch.setattr(
        "llm_router.opencode_runtime.asyncio.create_subprocess_exec",
        create_process,
    )
    monkeypatch.setenv("OPENCODE_AUTH_CONTENT", '{"openai":{"access":"do-not-inherit"}}')
    monkeypatch.setenv("OPENCODE_DISABLE_DEFAULT_PLUGINS", "true")
    monkeypatch.setenv("OPENCODE_SERVER_PASSWORD", "do-not-inherit")
    monkeypatch.setenv("BUN_OPTIONS", "--user-agent=spoofed-client")
    monkeypatch.setenv("OPENAI_API_KEY", "do-not-inherit")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://wrong-upstream.test/v1")
    company_ca = tmp_path / "company.pem"
    company_ca.write_text("-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n")
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(company_ca))
    runtime = OpenCodeRuntime(
        directory=tmp_path,
        binary_finder=lambda _: "/opt/bin/opencode",
        bundled_resolver=lambda: None,
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await runtime.ensure_started(client)

    assert captured["args"][:3] == ("/opt/bin/opencode", "--pure", "serve")
    assert captured["args"][-4:] == ("--hostname", "127.0.0.1", "--port", "4097")
    assert captured["kwargs"]["cwd"] == tmp_path
    environment = captured["kwargs"]["env"]
    assert environment["OPENCODE_DISABLE_PROJECT_CONFIG"] == "true"
    config = json.loads(environment["OPENCODE_CONFIG_CONTENT"])
    assert config["permission"] == "deny"
    assert config["autoupdate"] is False
    assert "provider" not in config
    assert environment["XDG_DATA_HOME"] == str(tmp_path / "data")
    assert "BUN_OPTIONS" not in environment
    assert "OPENAI_API_KEY" not in environment
    assert "OPENAI_BASE_URL" not in environment
    assert "OPENCODE_AUTH_CONTENT" not in environment
    assert "OPENCODE_DISABLE_DEFAULT_PLUGINS" not in environment
    assert "OPENCODE_SERVER_PASSWORD" not in environment
    assert environment["OPENCODE_DISABLE_AUTOUPDATE"] == "true"
    assert environment["OPENCODE_DISABLE_TERMINAL_TITLE"] == "true"
    assert environment["NODE_EXTRA_CA_CERTS"] == str(company_ca)

    await runtime.close()
    assert process.terminated is True


def test_runtime_keeps_router_owned_opencode_credentials_isolated(tmp_path):
    runtime = OpenCodeRuntime(directory=tmp_path)

    assert runtime.auth_path == tmp_path / "data" / "opencode" / "auth.json"


def test_runtime_passes_relative_company_ca_as_an_absolute_path(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", "sds.crt")
    (tmp_path / "sds.crt").write_text(
        "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n"
    )
    runtime = OpenCodeRuntime(directory=tmp_path / "runtime")

    environment = runtime._isolated_environment()

    assert environment["NODE_EXTRA_CA_CERTS"] == str((tmp_path / "sds.crt").resolve())


def test_runtime_logout_removes_only_openai_from_its_isolated_store(tmp_path):
    runtime = OpenCodeRuntime(directory=tmp_path)
    runtime.auth_path.parent.mkdir(parents=True)
    runtime.auth_path.write_text(
        json.dumps(
            {
                "openai": {"type": "oauth", "access": "secret"},
                "another": {"type": "api", "key": "keep"},
            }
        )
    )

    runtime.remove_openai_auth()

    assert json.loads(runtime.auth_path.read_text()) == {"another": {"type": "api", "key": "keep"}}
    assert oct(runtime.auth_path.stat().st_mode & 0o777) == "0o600"


async def test_runtime_configures_aipro_as_an_opencode_custom_provider(tmp_path, monkeypatch):
    captured = {}

    class ConfigRuntime(OpenCodeRuntime):
        async def ensure_started(self, _client):
            captured["environment"] = self._isolated_environment()

    monkeypatch.setenv("AIPRO_API_KEY", "company-secret")
    monkeypatch.setenv("BUN_OPTIONS", "--user-agent=forced-client")
    profile = Profile(
        name="aipro-team",
        provider="aipro",
        auth="api_key",
        api_key_env="AIPRO_API_KEY",
        base_url="https://aipro.company.test/v1/",
        model="company-model",
    )
    runtime = ConfigRuntime(directory=tmp_path)

    await runtime.ensure_profile(object(), profile)

    environment = captured["environment"]
    config = json.loads(environment["OPENCODE_CONFIG_CONTENT"])
    provider = config["provider"]["llm-router-aipro-aipro-team"]
    assert provider == {
        "npm": "@ai-sdk/openai-compatible",
        "name": "AI Pro (aipro-team)",
        "options": {
            "baseURL": "https://aipro.company.test/v1",
            "apiKey": "{env:AIPRO_API_KEY}",
            "headers": {"Authorization": "Bearer {env:AIPRO_API_KEY}"},
        },
        "models": {"company-model": {"name": "company-model"}},
    }
    assert "User-Agent" not in environment["OPENCODE_CONFIG_CONTENT"]
    assert "company-secret" not in environment["OPENCODE_CONFIG_CONTENT"]
    assert environment["AIPRO_API_KEY"] == "company-secret"
    assert "BUN_OPTIONS" not in environment


async def test_runtime_configures_aipro_browser_jwt_without_putting_it_in_config(tmp_path):
    captured = {}

    class ConfigRuntime(OpenCodeRuntime):
        async def ensure_started(self, _client):
            captured["environment"] = self._isolated_environment()

    token = _jwt({"exp": time.time() + 3600})
    store = AIProTokenStore(tmp_path / "aipro-auth.json")
    store.save(token)
    profile = Profile(
        name="aipro-browser",
        provider="aipro",
        auth="oauth",
        model="company-model",
    )
    runtime = ConfigRuntime(directory=tmp_path / "runtime", aipro_token_store=store)

    await runtime.ensure_profile(object(), profile)

    environment = captured["environment"]
    config = json.loads(environment["OPENCODE_CONFIG_CONTENT"])
    provider = config["provider"]["llm-router-aipro-aipro-browser"]
    assert provider == {
        "npm": "@ai-sdk/openai-compatible",
        "name": "AI Pro (aipro-browser)",
        "options": {
            "baseURL": "https://aipro.sdsdev.co.kr/api/v1",
            "apiKey": f"{{env:{AI_PRO_JWT_ENV}}}",
            "headers": {"Authorization": f"{{env:{AI_PRO_JWT_ENV}}}"},
        },
        "models": {"company-model": {"name": "company-model"}},
    }
    assert token not in environment["OPENCODE_CONFIG_CONTENT"]
    assert environment[AI_PRO_JWT_ENV] == token


async def test_clearing_aipro_browser_profiles_keeps_api_key_profiles(tmp_path, monkeypatch):
    class ConfigRuntime(OpenCodeRuntime):
        async def ensure_started(self, _client):
            return None

    monkeypatch.setenv("AIPRO_API_KEY", "company-secret")
    store = AIProTokenStore(tmp_path / "aipro-auth.json")
    store.save(_jwt({"exp": time.time() + 3600}))
    runtime = ConfigRuntime(directory=tmp_path / "runtime", aipro_token_store=store)
    api_key_profile = Profile(
        name="aipro-key",
        provider="aipro",
        auth="api_key",
        api_key_env="AIPRO_API_KEY",
        model="key-model",
    )
    browser_profile = Profile(
        name="aipro-browser",
        provider="aipro",
        auth="oauth",
        model="browser-model",
    )
    await runtime.ensure_profile(object(), api_key_profile)
    await runtime.ensure_profile(object(), browser_profile)

    await runtime.clear_aipro_browser_profiles()

    environment = runtime._isolated_environment()
    config = json.loads(environment["OPENCODE_CONFIG_CONTENT"])
    assert set(config["provider"]) == {"llm-router-aipro-aipro-key"}
    assert AI_PRO_JWT_ENV not in environment


async def test_removing_aipro_profile_drops_its_runtime_config(tmp_path, monkeypatch):
    class ConfigRuntime(OpenCodeRuntime):
        async def ensure_started(self, _client):
            return None

    monkeypatch.setenv("AIPRO_API_KEY", "company-secret")
    profile = Profile(
        name="aipro-team",
        provider="aipro",
        auth="api_key",
        api_key_env="AIPRO_API_KEY",
        model="company-model",
    )
    runtime = ConfigRuntime(directory=tmp_path)
    await runtime.ensure_profile(object(), profile)

    await runtime.remove_profile(profile)

    config = json.loads(runtime._isolated_environment()["OPENCODE_CONFIG_CONTENT"])
    assert "provider" not in config
