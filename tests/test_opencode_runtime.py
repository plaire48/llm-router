import json

import httpx
import pytest

from llm_router.errors import RouterError
from llm_router.opencode_runtime import OpenCodeRuntime


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


async def test_auto_start_does_not_reuse_an_unisolated_server_on_its_port(tmp_path):
    def handler(_request):
        return httpx.Response(200, json={"healthy": True, "version": "1.0.0"})

    runtime = OpenCodeRuntime(directory=tmp_path, binary_finder=lambda _: "/opt/bin/opencode")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RouterError) as error:
            await runtime.ensure_started(client)

    assert error.value.code == "opencode_port_in_use"


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


def test_runtime_honors_explicit_opencode_binary_over_bundle(tmp_path):
    explicit = tmp_path / "custom-opencode"
    explicit.write_text("binary")
    runtime = OpenCodeRuntime(
        binary=str(explicit),
        bundled_resolver=lambda: "/package/opencode",
    )

    assert runtime._resolve_binary() == str(explicit)


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
    monkeypatch.setenv("OPENCODE_SERVER_PASSWORD", "do-not-inherit")
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", "/company/ca.pem")
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
    assert config["provider"]["openai"]["options"]["headers"]["User-Agent"] == ("opencode/1.18.18")
    assert environment["XDG_DATA_HOME"] == str(tmp_path / "data")
    assert "OPENCODE_AUTH_CONTENT" not in environment
    assert "OPENCODE_SERVER_PASSWORD" not in environment
    assert environment["NODE_EXTRA_CA_CERTS"] == "/company/ca.pem"

    await runtime.close()
    assert process.terminated is True


def test_runtime_keeps_router_owned_opencode_credentials_isolated(tmp_path):
    runtime = OpenCodeRuntime(directory=tmp_path)

    assert runtime.auth_path == tmp_path / "data" / "opencode" / "auth.json"


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
