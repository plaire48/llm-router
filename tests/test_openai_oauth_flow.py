import httpx
import pytest

from llm_router.errors import RouterError
from llm_router.oauth.openai_flow import login


class FakeOpenCodeRuntime:
    def __init__(self, *, error=None):
        self.error = error
        self.called = None

    async def login_openai(self, client, *, browser_opener, timeout):
        self.called = (client, timeout)
        browser_opener("https://auth.openai.com/opencode")
        if self.error is not None:
            raise self.error


async def test_openai_login_delegates_to_opencode_browser_flow():
    runtime = FakeOpenCodeRuntime()
    opened = []
    async with httpx.AsyncClient() as client:
        await login(
            runtime=runtime,
            client=client,
            browser_opener=lambda url: opened.append(url) or True,
            timeout=45,
        )

    assert runtime.called == (client, 45)
    assert opened == ["https://auth.openai.com/opencode"]


async def test_openai_login_surfaces_opencode_login_failure():
    failure = RouterError("denied", code="opencode_login_failed", status_code=401)
    runtime = FakeOpenCodeRuntime(error=failure)

    async with httpx.AsyncClient() as client:
        with pytest.raises(RouterError) as error:
            await login(runtime=runtime, client=client, browser_opener=lambda _: True)

    assert error.value.code == "opencode_login_failed"
