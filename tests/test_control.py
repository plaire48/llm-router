import base64
import json
import time
from pathlib import Path

import httpx
import respx
from fastapi.testclient import TestClient

from llm_router.aipro_auth import AIProTokenStore
from llm_router.config import ProfileRegistry, Settings
from llm_router.control import ClaudeWebLogin, OpenAIWebLogin
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.credentials.openai_oauth import OPENAI_TOKEN_URL, OpenAIAccountStore
from llm_router.models import Profile
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

    def __init__(self):
        self.started = False

    async def start(self):
        self.started = True
        return {
            "provider": "aipro",
            "status": "pending",
            "opened_browser": True,
            "callback_port": 32123,
        }

    async def logout(self):
        self.started = False

    async def close(self):
        return None

    def is_pending(self):
        return self.started


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
    aipro_login=None,
    opencode_runtime=None,
    openai_expires_in=3600,
):
    registry = ProfileRegistry([profile.model_copy(deep=True) for profile in REGISTRY.profiles()])
    claude_store = TokenStore(tmp_path / "claude.json")
    codex_store = OpenAIAccountStore(tmp_path / "auth.json")
    codex_store.save(
        {
            "auth_mode": "chatgpt",
            "tokens": {
                "access_token": _jwt({"exp": time.time() + openai_expires_in}),
                "refresh_token": "openai-refresh-secret",
                "account_id": "account_1",
            },
        }
    )
    aipro_store = AIProTokenStore(tmp_path / "aipro-auth.json")
    if aipro_connected:
        aipro_store.save(_jwt({"exp": time.time() + 3600, "email": "aipro@example.com"}))
    app = create_app(
        SETTINGS,
        registry,
        token_store=claude_store,
        codex_token_store=codex_store,
        profiles_path=tmp_path / "profiles.yaml",
        profile_secret_store=ProfileSecretStore(tmp_path / "secrets.json"),
        claude_login=FakeClaudeLogin(connected=claude_connected),
        aipro_token_store=aipro_store,
        aipro_login=aipro_login,
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
    assert providers["aipro"]["auth_method"] == "saml_jwt"
    assert providers["aipro"]["endpoint"] == "https://aipro.sdsdev.co.kr/api/v1"
    assert set(providers) == {"anthropic", "openai", "aipro"}
    assert response.headers["cache-control"] == "private, no-store"
    assert "openai-refresh-secret" not in response.text
    assert "access_token" not in response.text


@respx.mock
def test_initial_auth_status_refreshes_an_expired_openai_browser_token(tmp_path):
    refresh = respx.post(OPENAI_TOKEN_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "access_token": _jwt({"exp": time.time() + 7200}),
                "refresh_token": "openai-refresh-new",
                "expires_in": 7200,
            },
        )
    )

    with _client(
        tmp_path,
        openai_expires_in=-60,
        opencode_runtime=FakeOpenCodeRuntime(),
    ) as client:
        response = client.get("/v1/auth/status", headers=AUTH)

    openai = next(item for item in response.json()["data"] if item["provider"] == "openai")
    saved = json.loads((tmp_path / "auth.json").read_text())["tokens"]
    assert response.status_code == 200
    assert refresh.call_count == 1
    assert openai["connected"] is True
    assert openai["status"] == "connected"
    assert saved["refresh_token"] == "openai-refresh-new"
    assert saved["expires_at"] > time.time()


@respx.mock
def test_initial_auth_status_requires_login_when_openai_refresh_fails(tmp_path):
    respx.post(OPENAI_TOKEN_URL).mock(return_value=httpx.Response(400, json={"error": "x"}))

    with _client(
        tmp_path,
        openai_expires_in=-60,
        opencode_runtime=FakeOpenCodeRuntime(),
    ) as client:
        response = client.get("/v1/auth/status", headers=AUTH)

    openai = next(item for item in response.json()["data"] if item["provider"] == "openai")
    assert openai["connected"] is False
    assert openai["status"] == "expired"
    assert "다시 로그인" in openai["message"]


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
        self.profiles = []

    async def ready(self, _client):
        return True

    async def usable(self, _client):
        return True

    async def ensure_started(self, _client):
        return None

    async def ensure_profile(self, _client, profile):
        self.profiles.append(profile)

    async def close(self):
        return None

    async def remove_profile(self, profile):
        self.profiles = [item for item in self.profiles if item.name != profile.name]


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
def test_keyless_model_discovery_omits_authorization(tmp_path):
    models = respx.get("https://llm.company.test/v1/models").mock(
        return_value=httpx.Response(200, json={"data": [{"id": "local-model"}]})
    )

    with _client(tmp_path) as client:
        response = client.post(
            "/v1/profiles/discover-models",
            headers=AUTH,
            json={
                "provider": "openai_compatible",
                "auth": "none",
                "base_url": "https://llm.company.test/v1",
            },
        )

    assert response.status_code == 200
    assert response.json()["data"] == ["local-model"]
    assert "authorization" not in models.calls.last.request.headers


def test_aipro_model_discovery_requires_a_manual_model_id(tmp_path):
    with _client(tmp_path) as client:
        response = client.post(
            "/v1/profiles/discover-models",
            headers=AUTH,
            json={"provider": "aipro", "auth": "api_key", "api_key": "secret"},
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "aipro_model_id_required"


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


def test_aipro_browser_login_endpoint_starts_the_local_jwt_handoff(tmp_path):
    login = FakeAIProLogin()
    with _client(tmp_path, aipro_login=login) as client:
        started = client.post("/v1/auth/aipro/login", headers=AUTH)

    assert started.status_code == 200
    assert started.json() == {
        "provider": "aipro",
        "status": "pending",
        "opened_browser": True,
        "callback_port": 32123,
    }
    assert login.started is True


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


def test_openai_compatible_profile_can_leave_api_key_blank(tmp_path):
    with _client(tmp_path) as client:
        created = client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "keyless-llm",
                "provider": "openai_compatible",
                "auth": "api_key",
                "model": "local-model",
                "base_url": "http://127.0.0.1:11434/v1",
                "api_key": "",
            },
        )
        listed = client.get("/v1/profiles", headers=AUTH)

    profile = next(item for item in listed.json()["data"] if item["name"] == "keyless-llm")
    assert created.status_code == 200
    assert profile["auth"] == "none"
    assert profile["status"] == "ready"
    assert profile["has_api_key"] is False
    assert "api_key_env" not in (tmp_path / "profiles.yaml").read_text()


def test_openai_compatible_profile_can_switch_from_api_key_to_no_auth(tmp_path):
    secrets_path = tmp_path / "secrets.json"
    with _client(tmp_path) as client:
        client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "switchable",
                "provider": "openai_compatible",
                "auth": "api_key",
                "model": "local-model",
                "base_url": "http://127.0.0.1:11434/v1",
                "api_key": "remove-me",
            },
        )
        updated = client.put(
            "/v1/profiles/switchable",
            headers=AUTH,
            json={
                "name": "switchable",
                "provider": "openai_compatible",
                "auth": "none",
                "model": "local-model",
                "base_url": "http://127.0.0.1:11434/v1",
            },
        )
        listed = client.get("/v1/profiles", headers=AUTH)

    profile = next(item for item in listed.json()["data"] if item["name"] == "switchable")
    assert updated.status_code == 200
    assert profile["auth"] == "none"
    assert "remove-me" not in secrets_path.read_text()


def test_browser_login_profiles_reject_api_key_auth(tmp_path):
    with _client(tmp_path) as client:
        for provider in ("openai", "anthropic"):
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


def test_aipro_api_key_profile_is_an_opencode_gateway_route(tmp_path):
    runtime = FakeOpenCodeRuntime()
    with _client(tmp_path, opencode_runtime=runtime) as client:
        created = client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "aipro-team",
                "provider": "aipro",
                "auth": "api_key",
                "model": "company-model",
                "api_key": "aipro-secret",
            },
        )
        listed = client.get("/v1/profiles", headers=AUTH)

    assert created.status_code == 200
    assert created.json()["inference_engine"] == "opencode"
    profile = next(item for item in listed.json()["data"] if item["name"] == "aipro-team")
    assert profile["status"] == "ready"
    assert profile["inference_engine"] == "opencode"
    assert profile["base_url"] == "https://aipro.sdsdev.co.kr/open/api/v1"
    assert profile["has_api_key"] is True
    assert runtime.profiles[0].name == "aipro-team"
    assert "aipro-secret" not in listed.text


def test_aipro_browser_jwt_profile_is_available_alongside_api_key(tmp_path):
    runtime = FakeOpenCodeRuntime()
    with _client(tmp_path, aipro_connected=True, opencode_runtime=runtime) as client:
        created = client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "aipro-oauth",
                "provider": "aipro",
                "auth": "oauth",
                "model": "company-model",
            },
        )

        listed = client.get("/v1/profiles", headers=AUTH)

    assert created.status_code == 200
    profile = next(item for item in listed.json()["data"] if item["name"] == "aipro-oauth")
    assert profile["auth"] == "oauth"
    assert profile["status"] == "ready"
    assert profile["base_url"] == "https://aipro.sdsdev.co.kr/api/v1"
    assert profile["has_api_key"] is False
    assert runtime.profiles[0].auth == "oauth"


def test_legacy_aipro_endpoint_profile_is_migrated_to_opencode_at_runtime(tmp_path):
    runtime = FakeOpenCodeRuntime()
    with _client(tmp_path, opencode_runtime=runtime) as client:
        created = client.post(
            "/v1/profiles",
            headers=AUTH,
            json={
                "name": "aipro-legacy",
                "provider": "openai_compatible",
                "auth": "api_key",
                "model": "company-model",
                "base_url": "https://aipro.sdsdev.co.kr/v1/",
                "api_key": "legacy-secret",
            },
        )
        listed = client.get("/v1/profiles", headers=AUTH)

    assert created.status_code == 200
    assert created.json()["inference_engine"] == "opencode"
    profile = next(item for item in listed.json()["data"] if item["name"] == "aipro-legacy")
    assert profile["inference_engine"] == "opencode"
    assert runtime.profiles[0].name == "aipro-legacy"


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
