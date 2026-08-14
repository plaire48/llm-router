from __future__ import annotations

import asyncio
import os
import time
import webbrowser
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from llm_router.aipro import (
    AI_PRO_BASE_URL,
    AI_PRO_BROWSER_BASE_URL,
    is_aipro_base_url,
    is_aipro_profile,
)
from llm_router.aipro_auth import AIProTokenStore, AIProWebLogin
from llm_router.config import ProfileFile, ProfileRegistry, Settings
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.credentials.env_key import load_provider_env
from llm_router.credentials.openai_oauth import OpenAIAccountStore, refresh_openai_tokens
from llm_router.errors import RouterError
from llm_router.models import Profile
from llm_router.opencode_runtime import OpenCodeRuntime
from llm_router.profile_secrets import ProfileSecretStore
from llm_router.provider_policy import (
    ANTHROPIC_OAUTH_DISABLED_MESSAGE,
    anthropic_oauth_disabled_error,
    is_policy_disabled,
)
from llm_router.serving import ProfileServingManager


class ClaudeWebLogin:
    """Expose the policy-disabled Claude subscription OAuth state."""

    def __init__(self, store: TokenStore) -> None:
        self.store = store

    @property
    def available(self) -> bool:
        return False

    async def status(self, *, force: bool = False) -> dict[str, Any]:
        return {
            "connected": False,
            "status": "disabled",
            "account": None,
            "auth_method": None,
            "message": ANTHROPIC_OAUTH_DISABLED_MESSAGE,
        }

    async def start(self) -> dict[str, Any]:
        raise anthropic_oauth_disabled_error()

    async def logout(self) -> None:
        self.store.delete()

    def is_pending(self) -> bool:
        return False

    @property
    def last_error(self) -> str | None:
        return None


class OpenAIWebLogin:
    """Run the router-owned OpenCode browser login in the background."""

    def __init__(
        self,
        store: OpenAIAccountStore,
        *,
        runtime: OpenCodeRuntime | None = None,
        client_getter: Callable[[], Awaitable[httpx.AsyncClient]] | None = None,
        browser_opener: Callable[[str], object] = webbrowser.open,
        login_runner: Callable[[], Awaitable[None]] | None = None,
        logout_runner: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self.store = store
        self.runtime = runtime
        self.client_getter = client_getter
        self.browser_opener = browser_opener
        self.login_runner = login_runner or self._login_with_opencode
        self.logout_runner = logout_runner
        self._task: asyncio.Task[None] | None = None
        self._last_error: str | None = None
        self._status_lock = asyncio.Lock()

    @property
    def available(self) -> bool:
        # Keep browser OAuth actionable even when the runtime preflight cannot
        # resolve OpenCode yet. Starting the flow performs the authoritative
        # runtime check and reports an actionable error through auth status.
        return True

    async def start(self) -> dict[str, Any]:
        if (await self.status())["connected"]:
            return {"provider": "openai", "status": "connected", "opened_browser": False}
        if self.is_pending():
            return {"provider": "openai", "status": "pending", "opened_browser": True}
        self._last_error = None
        self._task = asyncio.create_task(self._run())
        await asyncio.sleep(0)
        return {"provider": "openai", "status": "pending", "opened_browser": True}

    async def status(self) -> dict[str, Any]:
        """Validate and refresh the stored browser token before reporting it connected."""
        current = _openai_oauth_status(self.store)
        expires_at = current.get("expires_at")
        if (
            current.get("status") not in {"connected", "expired"}
            or not current.get("refreshable")
            or not isinstance(expires_at, (int, float))
            or expires_at > time.time() + 60
        ):
            return current
        async with self._status_lock:
            current = _openai_oauth_status(self.store)
            expires_at = current.get("expires_at")
            if (
                current.get("status") not in {"connected", "expired"}
                or not current.get("refreshable")
                or not isinstance(expires_at, (int, float))
                or expires_at > time.time() + 60
            ):
                return current
            tokens = self.store.tokens()
            if not tokens or not tokens.get("refresh_token") or self.client_getter is None:
                return current
            try:
                client = await self.client_getter()
                await refresh_openai_tokens(self.store, client, tokens)
            except RouterError as exc:
                return {
                    **current,
                    "connected": False,
                    "status": "expired",
                    "message": f"ChatGPT OAuth 토큰 자동 갱신에 실패했습니다. 다시 로그인하세요. ({exc.code})",
                }
            return _openai_oauth_status(self.store)

    async def _run(self) -> None:
        try:
            await self.login_runner()
        except asyncio.CancelledError:
            raise
        except (RouterError, OSError) as exc:
            detail = exc.message if isinstance(exc, RouterError) else str(exc)
            self._last_error = detail[-500:] or "OpenAI browser login failed."
        except Exception as exc:  # noqa: BLE001 - expose background login failures in status
            self._last_error = f"Could not complete OpenAI login: {exc}"

    async def _login_with_opencode(self) -> None:
        if self.runtime is None or self.client_getter is None:
            raise RouterError(
                "OpenCode 로그인 런타임이 구성되지 않았습니다.",
                type="configuration_error",
                code="opencode_login_runtime_unavailable",
                status_code=503,
            )
        client = await self.client_getter()
        await self.runtime.login_openai(client, browser_opener=self.browser_opener)

    async def logout(self) -> None:
        if self.is_pending() and self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
        if self.logout_runner is not None:
            await self.logout_runner()
        elif self.runtime is not None:
            self.runtime.remove_openai_auth()
            await self.runtime.close()

    def is_pending(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def last_error(self) -> str | None:
        return self._last_error


def _openai_oauth_status(store: OpenAIAccountStore) -> dict[str, Any]:
    try:
        tokens = store.tokens()
    except RouterError as exc:
        return {
            "connected": False,
            "status": "error",
            "expires_at": None,
            "message": exc.message,
        }
    access_token = tokens.get("access_token") if tokens else None
    account_id = store.account_id(tokens)
    expires_at = store.expires_at(tokens)
    token_present = bool(isinstance(access_token, str) and access_token and account_id)
    expired = bool(token_present and expires_at is not None and expires_at <= time.time())
    connected = token_present and not expired
    claims = store.claims(tokens)
    email = claims.get("email")
    return {
        "connected": connected,
        "status": "connected" if connected else "expired" if expired else "disconnected",
        "expires_at": expires_at,
        "refreshable": bool(tokens and tokens.get("refresh_token")),
        "account": email if isinstance(email, str) else None,
        "message": (
            "OpenCode가 관리하는 ChatGPT 계정 OAuth 세션을 사용합니다."
            if connected
            else "ChatGPT 계정 OAuth 토큰이 만료되었습니다. 다시 로그인하세요."
            if expired
            else "ChatGPT 계정 OAuth 로그인이 필요합니다."
        ),
    }


def _profile_status(
    profile: Profile,
    anthropic_connected: bool,
    openai_store: OpenAIAccountStore,
    aipro_store: AIProTokenStore,
) -> tuple[str, str]:
    if is_policy_disabled(profile):
        return "policy_disabled", ANTHROPIC_OAUTH_DISABLED_MESSAGE
    if profile.auth == "oauth":
        if profile.provider == "openai":
            oauth = _openai_oauth_status(openai_store)
            if oauth["connected"]:
                return "ready", "ChatGPT 계정 OAuth 연결됨"
            return "login_required", "ChatGPT 계정 로그인이 필요합니다"
        if profile.provider == "aipro":
            if aipro_store.status()["connected"]:
                return "ready", "AI Pro SAML 브라우저 JWT 연결됨"
            return "login_required", "AI Pro SAML 브라우저 로그인이 필요합니다"
        if anthropic_connected:
            return "ready", "Claude 브라우저 로그인 연결됨"
        return "login_required", "Claude 로그인이 필요합니다"
    if profile.auth == "none":
        return "ready", "인증 헤더 없이 연결됨"

    load_provider_env()
    api_key_ready = bool(profile.api_key_env and os.environ.get(profile.api_key_env, "").strip())
    client_key_ready = bool(
        profile.client_key_env and os.environ.get(profile.client_key_env, "").strip()
    )
    if profile.provider == "fabrix":
        if api_key_ready and client_key_ready:
            return "ready", "FabriX Client Key와 API Token 설정됨"
        return "credential_required", "FabriX Client Key와 API Token이 필요합니다"
    if api_key_ready:
        return "ready", f"{profile.api_key_env} 설정됨"
    return "credential_required", f"{profile.api_key_env} 환경변수가 필요합니다"


def _profile_data(
    profile: Profile,
    anthropic_connected: bool,
    openai_store: OpenAIAccountStore,
    aipro_store: AIProTokenStore,
    secret_store: ProfileSecretStore,
    settings: Settings,
) -> dict[str, Any]:
    status, message = _profile_status(
        profile,
        anthropic_connected,
        openai_store,
        aipro_store,
    )
    return {
        **profile.model_dump(
            mode="json",
            exclude_none=True,
            exclude={"api_key_env", "client_key_env", "port"},
        ),
        **(
            {"inference_engine": "opencode"}
            if (profile.provider == "openai" and profile.auth == "oauth")
            or is_aipro_profile(profile)
            else {}
        ),
        "status": status,
        "status_message": message,
        "has_api_key": bool(
            profile.auth == "api_key"
            and profile.api_key_env
            and (os.environ.get(profile.api_key_env, "").strip() or secret_store.has(profile.name))
        ),
        "has_client_key": bool(
            profile.provider == "fabrix"
            and profile.client_key_env
            and (
                os.environ.get(profile.client_key_env, "").strip()
                or secret_store.has(profile.name, "client_key")
            )
        ),
        "serving": _gateway_data(settings),
    }


def _public_host(host: str) -> str:
    if host in {"0.0.0.0", "::", "[::]"}:
        return "127.0.0.1"
    return host


def _gateway_data(settings: Settings) -> dict[str, str]:
    base_url = f"http://{_public_host(settings.host)}:{settings.port}/v1"
    return {
        "status": "running",
        "base_url": base_url,
        "chat_completions_url": f"{base_url}/chat/completions",
        "models_url": f"{base_url}/models",
    }


class ProfileWrite(BaseModel):
    name: str
    provider: Literal["anthropic", "openai", "aipro", "openai_compatible", "fabrix"]
    auth: Literal["oauth", "api_key", "none"]
    model: str
    base_url: str | None = None
    aliases: list[str] = Field(default_factory=list)
    # Accepted only so older desktop clients can save without breaking. The router
    # now exposes one shared gateway and does not create profile-specific ports.
    port: int | None = Field(default=None, ge=1024, le=65535)
    params: dict[str, Any] = Field(default_factory=dict)
    api_key: str | None = None
    client_key: str | None = None
    start: bool = False


class ModelDiscovery(BaseModel):
    provider: Literal["anthropic", "openai", "aipro", "openai_compatible", "fabrix"]
    auth: Literal["oauth", "api_key", "none"]
    base_url: str | None = None
    api_key: str | None = None


def build_control_router(
    settings: Settings,
    registry: ProfileRegistry,
    auth_dependency: Callable[..., Any],
    client_getter: Callable[[], Awaitable[Any]],
    *,
    token_store: TokenStore | None = None,
    codex_token_store: OpenAIAccountStore | None = None,
    profile_file: ProfileFile | None = None,
    secret_store: ProfileSecretStore | None = None,
    serving_manager: ProfileServingManager | None = None,
    claude_login: ClaudeWebLogin | None = None,
    openai_login: OpenAIWebLogin | None = None,
    aipro_token_store: AIProTokenStore | None = None,
    aipro_login: AIProWebLogin | None = None,
    opencode_runtime: OpenCodeRuntime | None = None,
) -> APIRouter:
    router = APIRouter()
    router_claude_store = token_store or TokenStore.default()
    profiles_file = profile_file or ProfileFile(None)
    secrets_store = secret_store or ProfileSecretStore.default()
    secrets_store.hydrate()
    active_aipro_store = aipro_token_store or AIProTokenStore.default()
    claude_web_login = claude_login or ClaudeWebLogin(router_claude_store)
    active_opencode_runtime = opencode_runtime or OpenCodeRuntime(
        base_url=settings.opencode_url,
        binary=settings.opencode_binary,
        directory=settings.opencode_directory,
        auto_start=settings.opencode_auto_start,
        startup_timeout=settings.opencode_startup_timeout,
        aipro_token_store=active_aipro_store,
    )
    codex_store = codex_token_store or OpenAIAccountStore.from_opencode(
        active_opencode_runtime.auth_path
    )

    openai_web_login = openai_login or OpenAIWebLogin(
        codex_store,
        runtime=active_opencode_runtime,
        client_getter=client_getter,
    )
    aipro_web_login = aipro_login or AIProWebLogin(
        active_aipro_store,
        runtime=active_opencode_runtime,
    )
    protected = [Depends(auth_dependency)]

    @router.get("/v1/auth/status", dependencies=protected)
    async def auth_status(response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        claude_status = await claude_web_login.status()
        anthropic = {
            **claude_status,
            "connected": False,
            "status": "disabled",
            "message": ANTHROPIC_OAUTH_DISABLED_MESSAGE,
            "session_source": None,
        }
        anthropic.update(
            {
                "provider": "anthropic",
                "label": "Claude",
                "available": False,
                "experimental": False,
                "login_pending": False,
            }
        )
        openai = await openai_web_login.status()
        client = await client_getter()
        runtime_ready = await active_opencode_runtime.usable(client)
        openai.update(
            {
                "provider": "openai",
                "label": "OpenAI",
                "available": openai_web_login.available,
                "experimental": False,
                "login_pending": openai_web_login.is_pending(),
                "inference_engine": "opencode",
                "runtime_available": runtime_ready or active_opencode_runtime.binary_available,
                "runtime_ready": runtime_ready,
            }
        )
        if openai_web_login.last_error and not openai["connected"]:
            openai.update(status="error", message=openai_web_login.last_error)
        aipro = active_aipro_store.status()
        aipro.update(
            {
                "provider": "aipro",
                "label": "AI Pro",
                "available": aipro_web_login.available,
                "experimental": False,
                "login_pending": aipro_web_login.is_pending(),
                "inference_engine": "opencode",
                "auth_method": "saml_jwt",
                "endpoint": AI_PRO_BROWSER_BASE_URL,
            }
        )
        callback_status = getattr(aipro_web_login, "callback_status", None)
        if callable(callback_status):
            aipro["callback"] = callback_status()
        if aipro_web_login.is_pending():
            aipro["message"] = (
                aipro_web_login.last_error
                or "브라우저 로그인 완료 후 localhost JWT callback을 기다리는 중입니다."
            )
        if aipro_web_login.last_error and not aipro["connected"]:
            aipro.update(status="error", message=aipro_web_login.last_error)
        return {"object": "auth_status", "data": [anthropic, openai, aipro]}

    @router.post("/v1/auth/{provider}/login", dependencies=protected)
    async def start_login(provider: str, response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        if provider == "openai":
            return await openai_web_login.start()
        if provider == "aipro":
            return await aipro_web_login.start()
        if provider == "anthropic":
            raise anthropic_oauth_disabled_error()
        raise RouterError(
            f"unsupported OAuth provider: {provider}",
            type="invalid_request_error",
            code="unsupported_provider",
            status_code=404,
        )

    @router.delete("/v1/auth/{provider}", dependencies=protected)
    async def disconnect(provider: str, response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        if provider == "openai":
            await openai_web_login.logout()
            return {"provider": provider, "status": "disconnected"}
        if provider == "aipro":
            await aipro_web_login.logout()
            return {"provider": provider, "status": "disconnected"}
        if provider != "anthropic":
            raise RouterError(
                f"unsupported OAuth provider: {provider}",
                type="invalid_request_error",
                code="unsupported_provider",
                status_code=404,
            )
        router_claude_store.delete()
        await claude_web_login.logout()
        return {"provider": provider, "status": "disconnected"}

    @router.get("/v1/profiles", dependencies=protected)
    async def list_profiles(response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        anthropic_connected = False
        return {
            "object": "list",
            "editable": True,
            "gateway": _gateway_data(settings),
            "data": [
                _profile_data(
                    profile,
                    anthropic_connected,
                    codex_store,
                    active_aipro_store,
                    secrets_store,
                    settings,
                )
                for profile in registry.profiles()
            ],
        }

    def profile_from_payload(payload: ProfileWrite, existing: Profile | None = None) -> Profile:
        if payload.provider == "anthropic" and payload.auth == "oauth":
            raise anthropic_oauth_disabled_error()
        if payload.provider in {"anthropic", "openai"} and payload.auth != "oauth":
            raise RouterError(
                "OpenAI and Anthropic profiles require browser login.",
                type="invalid_request_error",
                code="browser_login_required",
                status_code=400,
            )
        effective_auth = payload.auth
        if (
            payload.provider == "openai_compatible"
            and payload.auth == "api_key"
            and not (payload.api_key and payload.api_key.strip())
            and not (existing is not None and existing.auth == "api_key" and existing.api_key_env)
            and not secrets_store.has(payload.name)
        ):
            effective_auth = "none"
        api_key_env = None
        client_key_env = None
        if effective_auth == "api_key":
            if payload.api_key and payload.api_key.strip():
                api_key_env = secrets_store.set(payload.name, payload.api_key)
            elif existing is not None and existing.api_key_env:
                api_key_env = existing.api_key_env
            elif secrets_store.has(payload.name):
                api_key_env = ProfileSecretStore.env_name(payload.name)
            else:
                raise RouterError(
                    "API key is required for this profile.",
                    type="configuration_error",
                    code="profile_api_key_required",
                    status_code=400,
                )
        if payload.provider == "fabrix":
            if payload.client_key and payload.client_key.strip():
                client_key_env = secrets_store.set(
                    payload.name,
                    payload.client_key,
                    "client_key",
                )
            elif existing is not None and existing.client_key_env:
                client_key_env = existing.client_key_env
            elif secrets_store.has(payload.name, "client_key"):
                client_key_env = ProfileSecretStore.env_name(payload.name, "client_key")
            else:
                raise RouterError(
                    "FabriX Client Key is required for this profile.",
                    type="configuration_error",
                    code="profile_client_key_required",
                    status_code=400,
                )
        try:
            return Profile(
                name=payload.name,
                provider=payload.provider,
                auth=effective_auth,
                model=payload.model.strip(),
                api_key_env=api_key_env,
                client_key_env=client_key_env,
                base_url=(
                    payload.base_url.strip()
                    if payload.base_url
                    else (AI_PRO_BROWSER_BASE_URL if effective_auth == "oauth" else AI_PRO_BASE_URL)
                    if payload.provider == "aipro"
                    else None
                ),
                aliases=payload.aliases,
                port=None,
                params=payload.params,
            )
        except ValueError as exc:
            raise RouterError(
                f"invalid profile: {exc}",
                type="invalid_request_error",
                code="invalid_profile",
                status_code=422,
            ) from exc

    @router.post("/v1/profiles/discover-models", dependencies=protected)
    async def discover_models(payload: ModelDiscovery) -> dict[str, Any]:
        if payload.provider == "anthropic" and payload.auth == "oauth":
            raise anthropic_oauth_disabled_error()
        if payload.provider in {"anthropic", "openai"} and payload.auth != "oauth":
            raise RouterError(
                "OpenAI and Anthropic profiles require browser login.",
                type="invalid_request_error",
                code="browser_login_required",
                status_code=400,
            )
        if payload.auth == "none" and payload.provider != "openai_compatible":
            raise RouterError(
                "Authentication can be omitted only for OpenAI-compatible endpoints.",
                type="invalid_request_error",
                code="invalid_auth_mode",
                status_code=400,
            )
        if payload.provider == "aipro" or (
            payload.provider == "openai_compatible" and is_aipro_base_url(payload.base_url)
        ):
            raise RouterError(
                "AI Pro model ID는 발급받은 값을 직접 입력하세요.",
                type="invalid_request_error",
                code="aipro_model_id_required",
                status_code=400,
            )
        if payload.auth == "oauth":
            client = await client_getter()
            await active_opencode_runtime.ensure_started(client)
            try:
                provider_response = await client.get(
                    f"{active_opencode_runtime.base_url}/provider",
                    params={"directory": str(active_opencode_runtime.directory)},
                )
                provider_response.raise_for_status()
                provider_payload = provider_response.json()
            except (httpx.HTTPError, ValueError) as exc:
                raise RouterError(
                    "OpenCode에서 브라우저 로그인 모델 목록을 불러올 수 없습니다.",
                    type="upstream_error",
                    code="opencode_model_discovery_failed",
                    status_code=502,
                ) from exc
            providers = provider_payload.get("all") if isinstance(provider_payload, dict) else None
            openai_provider = next(
                (
                    item
                    for item in providers or []
                    if isinstance(item, dict) and item.get("id") == "openai"
                ),
                None,
            )
            provider_models = openai_provider.get("models") if openai_provider else None
            models = sorted(provider_models) if isinstance(provider_models, dict) else []
            return {"object": "list", "data": models}
        if payload.provider == "fabrix":
            raise RouterError(
                "FabriX 모델 ID는 발급받은 값을 직접 입력하세요.",
                type="invalid_request_error",
                code="fabrix_model_id_required",
                status_code=400,
            )
        key = (payload.api_key or "").strip()
        if payload.auth == "api_key" and not key:
            raise RouterError(
                "enter an API key before loading models",
                type="invalid_request_error",
                code="api_key_required",
                status_code=400,
            )
        if payload.provider == "anthropic":
            url = "https://api.anthropic.com/v1/models"
            headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        else:
            base_url = payload.base_url or "https://api.openai.com/v1"
            url = f"{base_url.rstrip('/')}/models"
            headers = {"authorization": f"Bearer {key}"} if key else {}
        client = await client_getter()
        try:
            upstream = await client.get(url, headers=headers, timeout=10)
            upstream.raise_for_status()
            data = upstream.json().get("data", [])
        except (httpx.HTTPError, ValueError, AttributeError) as exc:
            raise RouterError(
                "Could not load models from the provider.",
                type="upstream_error",
                code="model_discovery_failed",
                status_code=502,
            ) from exc
        models = sorted(
            item["id"]
            for item in data
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        )
        return {"object": "list", "data": models}

    @router.post("/v1/profiles", dependencies=protected)
    async def create_profile(payload: ProfileWrite) -> dict[str, Any]:
        if payload.name in registry.names():
            raise RouterError(
                f"profile '{payload.name}' already exists",
                type="invalid_request_error",
                code="profile_exists",
                status_code=409,
            )
        profile = profile_from_payload(payload)
        if profile.provider == "openai" and profile.auth == "oauth":
            client = await client_getter()
            await active_opencode_runtime.ensure_started(client)
        if is_aipro_profile(profile) and (
            profile.auth == "api_key" or active_aipro_store.status()["connected"]
        ):
            client = await client_getter()
            await active_opencode_runtime.ensure_profile(client, profile)
        registry.upsert(profile)
        profiles_file.save(registry)
        return {
            "profile": profile.name,
            "inference_engine": (
                "opencode"
                if (profile.provider == "openai" and profile.auth == "oauth")
                or is_aipro_profile(profile)
                else None
            ),
            "gateway": _gateway_data(settings),
        }

    @router.put("/v1/profiles/{profile_name}", dependencies=protected)
    async def update_profile(profile_name: str, payload: ProfileWrite) -> dict[str, Any]:
        existing = registry.resolve(profile_name)
        if payload.name != profile_name:
            raise RouterError(
                "profile name cannot be changed; create a new profile instead",
                type="invalid_request_error",
                code="profile_name_immutable",
                status_code=409,
            )
        profile = profile_from_payload(payload, existing)
        remove_stored_api_key = existing.auth == "api_key" and profile.auth == "none"
        if is_aipro_profile(existing) and not is_aipro_profile(profile):
            await active_opencode_runtime.remove_profile(existing)
        if profile.provider == "openai" and profile.auth == "oauth":
            client = await client_getter()
            await active_opencode_runtime.ensure_started(client)
        if is_aipro_profile(profile) and (
            profile.auth == "api_key" or active_aipro_store.status()["connected"]
        ):
            client = await client_getter()
            await active_opencode_runtime.ensure_profile(client, profile)
        registry.upsert(profile, previous_name=profile_name)
        profiles_file.save(registry)
        if remove_stored_api_key:
            secrets_store.delete(profile_name)
        return {
            "profile": profile.name,
            "inference_engine": (
                "opencode"
                if (profile.provider == "openai" and profile.auth == "oauth")
                or is_aipro_profile(profile)
                else None
            ),
            "gateway": _gateway_data(settings),
        }

    @router.delete("/v1/profiles/{profile_name}", dependencies=protected)
    async def delete_profile(profile_name: str) -> dict[str, Any]:
        profile = registry.delete(profile_name)
        await active_opencode_runtime.remove_profile(profile)
        profiles_file.save(registry)
        secrets_store.delete(profile_name)
        return {"profile": profile_name, "status": "deleted"}

    @router.post("/v1/profiles/{profile_name}/start", dependencies=protected)
    async def start_profile(profile_name: str) -> dict[str, Any]:
        profile = registry.resolve(profile_name)
        status, message = _profile_status(
            profile,
            False,
            codex_store,
            active_aipro_store,
        )
        if status != "ready":
            raise RouterError(
                message,
                type="authentication_error",
                code="profile_credential_required",
                status_code=409,
            )
        if is_aipro_profile(profile):
            client = await client_getter()
            await active_opencode_runtime.ensure_profile(client, profile)
        return {"profile": profile_name, **_gateway_data(settings)}

    @router.post("/v1/profiles/{profile_name}/stop", dependencies=protected)
    async def stop_profile(profile_name: str) -> dict[str, Any]:
        registry.resolve(profile_name)
        return {
            "profile": profile_name,
            **_gateway_data(settings),
            "deprecated": True,
            "message": "Profiles are routes on the shared gateway and are not stopped separately.",
        }

    return router
