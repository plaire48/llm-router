from pathlib import Path

import pytest

from llm_router import openai_runtime
from llm_router.errors import RouterError
from llm_router.oauth.openai_flow import login
from llm_router.openai_runtime import (
    OpenAIAccountClient,
    OpenAIAppServerSession,
    bundled_openai_runtime,
)


class FakeSession:
    def __init__(self, *, success=True):
        self.success = success
        self.requests = []
        self.waited = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def request(self, method, params=None):
        self.requests.append((method, params))
        if method == "account/login/start":
            return {
                "type": "chatgpt",
                "loginId": "login_1",
                "authUrl": "https://chatgpt.com/sign-in",
            }
        return {}

    async def wait_for_notification(self, method, *, predicate, timeout):
        params = {
            "loginId": "login_1",
            "success": self.success,
            "error": None if self.success else "denied",
        }
        assert predicate(params)
        self.waited = (method, timeout)
        return params

    @staticmethod
    def protocol_error(detail):
        return AssertionError(detail)


async def test_openai_login_uses_chatgpt_branded_managed_browser_flow():
    session = FakeSession()
    opened = []
    account = OpenAIAccountClient(session_factory=lambda: session)

    await login(
        account_client=account,
        browser_opener=lambda url: opened.append(url) or True,
        timeout=45,
    )

    assert session.requests == [
        (
            "account/login/start",
            {
                "type": "chatgpt",
                "useHostedLoginSuccessPage": True,
                "appBrand": "chatgpt",
            },
        )
    ]
    assert opened == ["https://chatgpt.com/sign-in"]
    assert session.waited == ("account/login/completed", 45)


async def test_openai_login_surfaces_managed_login_failure():
    session = FakeSession(success=False)
    account = OpenAIAccountClient(session_factory=lambda: session)

    with pytest.raises(RouterError) as error:
        await login(account_client=account, browser_opener=lambda _: True)

    assert error.value.code == "openai_login_failed"


async def test_account_read_refresh_and_logout_use_managed_service():
    session = FakeSession()
    account = OpenAIAccountClient(session_factory=lambda: session)

    await account.account(refresh_token=True)
    await account.logout()

    assert session.requests == [
        ("account/read", {"refreshToken": True}),
        ("account/logout", None),
    ]


def test_official_sdk_provides_the_account_runtime():
    executable, path_dir = bundled_openai_runtime()

    assert executable.is_file()
    assert path_dir is None or path_dir.is_dir()


async def test_account_runtime_creates_codex_home_before_launch(tmp_path, monkeypatch):
    account_home = tmp_path / "missing" / "openai"
    launched = False

    class FakeStdin:
        def write(self, _: bytes) -> None:
            return None

        async def drain(self) -> None:
            return None

        def close(self) -> None:
            return None

    class FakeStdout:
        async def readline(self) -> bytes:
            return b'{"id": 1, "result": {}}\n'

    class FakeProcess:
        stdin = FakeStdin()
        stdout = FakeStdout()
        returncode = 0

        async def wait(self) -> int:
            return 0

    async def fake_subprocess_exec(*args, **kwargs):
        nonlocal launched
        launched = True
        assert Path(kwargs["env"]["CODEX_HOME"]) == account_home
        assert account_home.is_dir()
        return FakeProcess()

    monkeypatch.setenv("LLM_ROUTER_OPENAI_HOME", str(account_home))
    monkeypatch.setattr(openai_runtime.asyncio, "create_subprocess_exec", fake_subprocess_exec)
    session = OpenAIAppServerSession(
        runtime_resolver=lambda: (tmp_path / "codex", None)
    )

    async with session:
        pass

    assert launched


def test_account_runtime_merges_node_extra_ca_with_public_roots(tmp_path):
    extra = tmp_path / "company.pem"
    extra.write_text("-----BEGIN CERTIFICATE-----\ncompany\n-----END CERTIFICATE-----\n")
    session = OpenAIAppServerSession()

    bundle = session._merged_ca_bundle(str(extra))

    assert "company" in Path(bundle).read_text(encoding="utf-8")
    session._remove_ca_bundle()
    assert not session._ca_bundle_path
