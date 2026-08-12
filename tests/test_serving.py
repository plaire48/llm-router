from llm_router.config import ProfileRegistry
from llm_router.models import Profile
from llm_router.serving import ProfileServingManager


class FakeServer:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True

    async def wait_closed(self):
        return None


async def test_profile_serving_manager_opens_and_closes_local_proxy(monkeypatch):
    target_port = 18787
    profile_port = 18803
    observed = {}
    fake_server = FakeServer()

    async def fake_start_server(handler, *, host, port):
        observed.update(handler=handler, host=host, port=port)
        return fake_server

    monkeypatch.setattr("llm_router.serving.asyncio.start_server", fake_start_server)
    registry = ProfileRegistry(
        [
            Profile(
                name="company",
                provider="openai_compatible",
                auth="api_key",
                api_key_env="COMPANY_KEY",
                base_url="https://llm.company.test/v1",
                model="company-model",
                port=profile_port,
            )
        ]
    )
    manager = ProfileServingManager(
        registry,
        target_host="127.0.0.1",
        target_port=target_port,
    )
    started = await manager.start("company")

    assert observed["host"] == "127.0.0.1"
    assert observed["port"] == profile_port
    assert started["status"] == "running"
    assert started["base_url"] == f"http://localhost:{profile_port}/v1"

    stopped = await manager.stop("company")
    assert stopped["status"] == "stopped"
    assert fake_server.closed is True
