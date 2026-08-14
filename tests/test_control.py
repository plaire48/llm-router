import base64
import json
import time
from pathlib import Path

import httpx
import respx
from fastapi.testclient import TestClient

from llm_router.config import ProfileRegistry, Settings
from llm_router.control import AIProWebLogin, ClaudeWebLogin, OpenAIWebLogin
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.credentials.openai_oauth import OpenAIAccountStore
from llm_router.models import Profile
from llm_router.opencode_organizations import AI_PRO_ORIGIN
from llm_router.profile_secrets import ProfileSecretStore
from llm_router.server import create_app

SETTINGS = Settings(master_key="sk-local", host="127.0.0.1", port=8787, _env_file=None)
AUTH = {"authorization": "Bearer sk-local"}
REGISTRY = ProfileRegistry(
    [
        Profile(
            name="claude",
            provider="anthropic",
            auth="oauth",
            model="claude-sonnet-5",
            port=18801,
        ),
        Profile(
            name="openai",
            provider="openai",
            auth="oauth",
            model="gpt-5.6-sol",
            port=18802,
        ),
    ]
)


class FakeClaudeLogin:
    available = True
    last_error = None

    def __init__(self, connected=False):
        self.connected = connected
        self.started = False

    async def status(self, *, force=False):
        return {
            "connected": self.connected,
            "status": "connected" if self.connected else "disconnected",
            "account": "claude@example.com" if self.connected else None,
        }

    async def start(self):
        self.started = True
        return {"provider": "anthropic", "status": "pending", "opened_browser": True}

    async def logout(self):
        self.connected = False

    def is_pending(self):
        return self.started and not self.connected


class FakeAIProLogin:
    available = True
    last_error = None

    def __init__(self, connected=False):
        self.connected = connected
        self.started = False

    async def start(self):
        self.started = True
        return {"provider": "aipro", "status": "pending", "opened_browser": True}

    async def logout(self):
        self.connected = False

    def is_pending(self):
        return self.started and not self.connected


def _jwt(payload):
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.signature"


async def _completed():
    return None


def _client(
    tmp_path,
    *,
    claude_connected=False,
    aipro_connected=False,
    opencode_runtime=None,
):
    registry = ProfileRegistry([profile.model_copy(deep=True) for profile in REGISTRY.profiles()])
    claude_store = TokenStore(tmp_path / "claude.json")
    codex_store = OpenAIAccountStore(tmp_path / "auth.json")
    codex_store.save(
        {
            "auth_mode": "chatgpt",
            "tokens": {
                "access_token": _jwt({"exp": time.time() + 3600}),
                "refresh_token": "openai-refresh-secret",
                "account_id": "account_1",
            },
        }
    )
    app = create_app(
        SETTINGS,
        registry,
        token_store=claude_store,
        codex_token_store=codex_store,
        profiles_path=tmp_path / "profiles.yaml",
        profile_secret_store=ProfileSecretStore(tmp_path / "secrets.json"),
        claude_login=FakeClaudeLogin(connected=claude_connected),
        aipro_login=FakeAIProLogin(connected=aipro_connected),
        opencode_runtime=opencode_runtime,
    )
    return TestClient(app)


def test_auth_status_reports_browser_providers_without_exposing_tokens(tmp_path):
    with _client(tmp_path) as client:
        response = client.get("/v1/auth/status", headers=AUTH)

    assert response.status_code == 200
    providers = {item["provider"]: item for item in response.json()["data"]}
    assert providers["anthropic"]["connected"] is False
    assert providers["anthropic"]["available"] is False
    assert providers["anthropic"]["status"] == "disabled"
    assert providers["openai"]["connected"] is True
    assert providers["openai"]["experimental"] is False
    assert providers["aipro"]["connected"] is False
    assert providers["aipro"]["auth_method"] == "opencode_wellknown"
    assert providers["aipro"]["inference_engine"] == "opencode"
    assert response.headers["cache-control"] == "private, no-store"
    assert "openai-refresh-secret" not in response.text
    assert "access_token" not in response.text


def test_profiles_are_routes_on_one_shared_gateway(tmp_path):
    with _client(tmp_path) as client:
        listed = client.get("/v1/profiles", headers=AUTH)

    assert listed.status_code == 200
    assert listed.json()["editable"] is True
    assert listed.json()["gateway"] == {
        "status": "running",
        "base_url": "http://127.0.0.1:8787/v1",
        "chat_completions_url": "http://127.0.0.1:8787/v1/chat/completions",
        "models_url": "http://127.0.0.1:8787/v1/models",
    }
    statuses = {item["name"]: item["status"] for item in listed.json()["data"]}
    assert statuses == {"claude": "policy_disabled", "openai": "ready"}
    openai = next(item for item in listed.json()["data"] if item["name"] == "openai")
    assert openai["inference_engine"] == "opencode"
    assert {item["serving"]["base_url"] for item in listed.json()["data"]} == {
        "http://127.0.0.1:8787/v1"
    }
    assert all("port" not in item for item in listed.json()["data"])


def test_opencode_is_internal_inference_engine_not_a_downloaded_client_config(tmp_path):
    with _client(tmp_path) as client:
        auth = client.get("/v1/auth/status", headers=AUTH)
        old_config = client.get("/v1/connect/opencode", headers=AUTH)

    openai = next(item for item in auth.json()["data"] if item["provider"] == "openai")
    assert openai["inference_engine"] == "opencode"
    assert isinstance(openai["runtime_available"], bool)
    assert isinstance(openai["runtime_ready"], bool)
    assert old_config.status_code == 404


class FakeOpenCodeRuntime:
    base_url = "http://127.0.0.1:4097"
    directory = Path("/tmp/llm-router-opencode-control-test")
    binary_available = True
    auto_start = True

    def __init__(self):
        self.organizations = set()

    async def ready(self, _client):
        return True

    async def usable(self, _client):
        return True

    async def ensure_started(self, _client):
        return None

    async def close(self):
        return None

    def organization_connected(self, origin):
        return origin in self.organizations

    def remove_organization_auth(self, origin):
        self.organizations.discard(origin)


@respx.mock
def test_openai_model_discovery_comes_from_internal_opencode(tmp_path):
    runtime = FakeOpenCodeRuntime()
    provider = respx.get(f"{runtime.base_url}/provider").mock(
        return_value=httpx.Response(
            200,
            json={
                "all": [
                    {"id": "anthropic", "models": {}},
                    {"id": "openai", "models": {"gpt-z": {}, "gpt-a": {}}},
                ],
                "connected": ["openai"],
            },
        )
    )

    with _client(tmp_path, opencode_runtime=runtime) as client:
        response = client.post(
            "/v1/profiles/discover-models",
            headers=AUTH,
            json={"provider": "openai", "auth": "oauth"},
        )

    assert response.status_code == 200
    assert response.json()["data"] == ["gpt-a", "gpt-z"]
    assert provider.called


@respx.mock
def test_aipro_model_discovery_uses_organization_provider_config(tmp_path):
    runtime = FakeOpenCodeRuntime()
    config = respx.get(f"{runtime.base_url}/config").mock(
        return_value=httpx.Response(
            200,
            json={"provider": {"sds-aipro": {"name": "AI Pro"}}},
        )
    )
    provider = respx.get(f"{runtime.base_url}/provider").mock(
        return_value=httpx.Response(
            200,
            json={
                "all": [
                    {"id": "openai", "models": {"gpt-public": {}}},
                    {
                        "id": "sds-aipro",
                        "models": {"company-z": {}, "company-a": {}},
                    },
                ],
                "connected": ["sds-aipro"],
            },
        )
    )

    with _client(
        tmp_path,
        aipro_connected=True,
        opencode_runtime=runtime,
    ) as client:
        response = client.post(
            "/v1/profiles/discover-models",
            headers=AUTH,
            json={"provider": "aipro", "auth": "oauth"},
        )

    assert response.status_code == 200
    assert response.json()["data"] == [
        "sds-aipro/company-a",
        "sds-aipro/company-z",
    ]
    assert config.called
    assert provider.called


def test_aipro_model_discovery_requires_browser_login(tmp_path):
    with _client(tmp_path) as client:
        response = client.post(
            "/v1/profiles/discover-models",
            headers=AUTH,
            json={"provider": "aipro", "auth": "oauth"},
        )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "aipro_oauth_required"


def test_openai_login_endpoint_recognizes_existing_browser_session(tmp_path):
    with _client(tmp_path) as client:
        response = client.post("/v1/auth/openai/login", headers=AUTH)

    assert response.status_code == 200
    assert response.json() == {
        "provider": "openai",
        "status": "connected",
        "opened_browser": False,
    }


def test_claude_login_endpoint_is_policy_disabled(tmp_path):
    with _client(tmp_path) as client:
        started = client.post("/v1/auth/anthropic/login", headers=AUTH)

    assert started.status_code == 403
    assert started.json()["error"]["code"] == "anthropic_oauth_policy_disabled"


def test_aipro_login_endpoint_starts_opencode_organization_oauth(tmp_path):
    with _client(tmp_path) as client:
        started = client.post("/v1/auth/aipro/login", headers=AUTH)

    assert started.status_code == 200
    assert started.json() == {
        "provider": "aipro",
        "status": "pending",
        "opened_browser": True,
    }


async def test_openai_browser_login_controller_tracks_opencode_completion(tmp_path):
    openai_store = OpenAIAccountStore(tmp_path / "openai.json")

    async def login_openai():
        openai_store.save(
            {
                "auth_mode": "chatgpt",
                "tokens": {
                    "access_token": _jwt({"exp": time.time() + 3600}),
                    "refresh_token": "openai-refresh",
                    "account_id": "account_1",
                },
            }
        )

    openai = OpenAIWebLogin(
        openai_store,
        login_runner=login_openai,
        logout_runner=lambda: _completed(),
    )

    assert openai.available is True
    assert (await openai.start())["status"] == "pending"
    await openai._task
    assert (await openai.start())["status"] == "connected"


async def test_openai_browser_login_is_not_blocked_by_runtime_preflight(tmp_path):
    class MissingRuntime:
        auto_start = True
        binary_available = False

    attempted = False

    async def login_openai():
        nonlocal attempted
        attempted = True

    openai = OpenAIWebLogin(
        OpenAIAccountStore(tmp_path / "openai.json"),
        runtime=MissingRuntime(),
        login_runner=login_openai,
    )

    assert openai.available is True
    assert (await openai.start()) == {
        "provider": "openai",
        "status": "pending",
        "opened_browser": True,
    }
    await openai._task
    assert attempted is True


async def test_claude_browser_login_controller_is_policy_disabled(tmp_path):
    claude = ClaudeWebLogin(TokenStore(tmp_path / "claude.json"))

    assert claude.available is False
    assert (await claude.status())["status"] == "disabled"


async def test_aipro_browser_login_controller_tracks_opencode_completion():
    runtime = FakeOpenCodeRuntime()
    runtime.binary_available = False

    async def get_client():
        return object()

    async def login_aipro():
        runtime.organizations.add(AI_PRO_ORIGIN)

    aipro = AIProWebLogin(
        runtime,
        client_getter=get_client,
        login_runner=login_aipro,
    )

    assert aipro.available is True
    assert aipro.connected is False
    assert (await aipro.start())["status"] == "pending"
    await aipro._task
    assert aipro.connected is True


def test_api_key_profile_is_added_as_a_gateway_route_without_exposing_key(tmp_path):
    with _client(tmp_path) as client:
        created = client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "company-llm",
                "provider": "openai_compatible",
                "auth": "api_key",
                "model": "company-model",
                "base_url": "https://llm.company.test/v1",
                "api_key": "company-secret",
            },
        )
        listed = client.get("/v1/profiles", headers=AUTH)

    assert created.status_code == 200
    assert created.json()["gateway"]["base_url"] == "http://127.0.0.1:8787/v1"
    profile = next(item for item in listed.json()["data"] if item["name"] == "company-llm")
    assert profile["has_api_key"] is True
    assert "company-secret" not in listed.text
    assert "company-secret" not in (tmp_path / "profiles.yaml").read_text()
    assert "company-secret" in (tmp_path / "secrets.json").read_text()


def test_browser_login_profiles_reject_api_key_auth(tmp_path):
    with _client(tmp_path) as client:
        for provider in ("openai", "anthropic", "aipro"):
            response = client.post(
                "/v1/profiles",
                headers=AUTH,
                json={
                    "name": f"{provider}-key",
                    "provider": provider,
                    "auth": "api_key",
                    "model": "public-model",
                    "api_key": "must-not-be-stored",
                },
            )

            assert response.status_code == 400
            assert response.json()["error"]["code"] == "browser_login_required"

    secrets_path = tmp_path / "secrets.json"
    assert not secrets_path.exists() or "must-not-be-stored" not in secrets_path.read_text()


def test_aipro_oauth_profile_is_an_opencode_gateway_route(tmp_path):
    runtime = FakeOpenCodeRuntime()
    with _client(
        tmp_path,
        aipro_connected=True,
        opencode_runtime=runtime,
    ) as client:
        created = client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "aipro-team",
                "provider": "aipro",
                "auth": "oauth",
                "model": "sds-aipro/company-model",
            },
        )
        listed = client.get("/v1/profiles", headers=AUTH)

    assert created.status_code == 200
    assert created.json()["inference_engine"] == "opencode"
    profile = next(item for item in listed.json()["data"] if item["name"] == "aipro-team")
    assert profile["status"] == "ready"
    assert profile["inference_engine"] == "opencode"
    assert "base_url" not in profile


def test_anthropic_oauth_profile_creation_and_serving_are_disabled(tmp_path):
    with _client(tmp_path) as client:
        created = client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "claude-new",
                "provider": "anthropic",
                "auth": "oauth",
                "model": "claude-sonnet",
            },
        )
        models = client.get("/v1/models", headers=AUTH)
        completion = client.post(
            "/v1/chat/completions",
            headers=AUTH,
            json={"model": "claude", "messages": [{"role": "user", "content": "hi"}]},
        )

    assert created.status_code == 403
    assert created.json()["error"]["code"] == "anthropic_oauth_policy_disabled"
    assert {item["id"] for item in models.json()["data"]} == {"openai"}
    assert completion.status_code == 403
    assert completion.json()["error"]["code"] == "anthropic_oauth_policy_disabled"


def test_fabrix_profile_stores_both_secrets_and_uses_shared_gateway(tmp_path):
    with _client(tmp_path) as client:
        created = client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "fabrix-team",
                "provider": "fabrix",
                "auth": "api_key",
                "model": "019a-model-id",
                "base_url": "https://fabrix.company.test",
                "client_key": "fabrix-client-secret",
                "api_key": "fabrix-token-secret",
            },
        )
        listed = client.get("/v1/profiles", headers=AUTH)

    assert created.status_code == 200
    assert created.json()["gateway"] == {
        "status": "running",
        "base_url": "http://127.0.0.1:8787/v1",
        "chat_completions_url": "http://127.0.0.1:8787/v1/chat/completions",
        "models_url": "http://127.0.0.1:8787/v1/models",
    }
    profile = next(item for item in listed.json()["data"] if item["name"] == "fabrix-team")
    assert profile["provider"] == "fabrix"
    assert profile["has_api_key"] is True
    assert profile["has_client_key"] is True
    assert "api_key_env" not in profile
    assert "client_key_env" not in profile
    assert "fabrix-client-secret" not in listed.text
    assert "fabrix-token-secret" not in listed.text
    yaml_text = (tmp_path / "profiles.yaml").read_text()
    assert "fabrix-client-secret" not in yaml_text
    assert "fabrix-token-secret" not in yaml_text
