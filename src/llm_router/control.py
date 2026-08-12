from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field

from llm_router.config import ProfileFile, ProfileRegistry, Settings
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.credentials.env_key import load_provider_env
from llm_router.credentials.openai_oauth import CodexTokenStore
from llm_router.errors import RouterError
from llm_router.models import Profile
from llm_router.profile_secrets import ProfileSecretStore
from llm_router.serving import ProfileServingManager


class ClaudeWebLogin:
    """Let the official Claude CLI own Claude's browser login session."""

    def __init__(self, *, binary_finder: Callable[[str], str | None] = shutil.which) -> None:
        self.binary_finder = binary_finder
        self._task: asyncio.Task[None] | None = None
        self._last_error: str | None = None
        self._cached_status: dict[str, Any] | None = None
        self._cached_at = 0.0

    @property
    def available(self) -> bool:
        return self.binary_finder("claude") is not None

    async def status(self, *, force: bool = False) -> dict[str, Any]:
        if not force and self._cached_status is not None and time.monotonic() - self._cached_at < 3:
            return self._cached_status
        binary = self.binary_finder("claude")
        if binary is None:
            result = {"connected": False, "status": "unavailable", "account": None}
        else:
            try:
                process = await asyncio.create_subprocess_exec(
                    binary,
                    "auth",
                    "status",
                    "--json",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await asyncio.wait_for(process.communicate(), timeout=5)
                payload = json.loads(stdout) if process.returncode == 0 else {}
            except (OSError, TimeoutError, json.JSONDecodeError):
                payload = {}
            connected = payload.get("loggedIn") is True
            account = payload.get("email") or payload.get("accountEmail")
            result = {
                "connected": connected,
                "status": "connected" if connected else "disconnected",
                "account": account if isinstance(account, str) else None,
                "auth_method": payload.get("authMethod"),
            }
        self._cached_status = result
        self._cached_at = time.monotonic()
        return result

    async def start(self) -> dict[str, Any]:
        if (await self.status(force=True))["connected"]:
            return {"provider": "anthropic", "status": "connected", "opened_browser": False}
        if self.is_pending():
            return {"provider": "anthropic", "status": "pending", "opened_browser": True}
        binary = self.binary_finder("claude")
        if binary is None:
            raise RouterError(
                "Claude Code CLI is required for Claude browser login.",
                type="configuration_error",
                code="claude_cli_required",
                status_code=503,
            )
        self._last_error = None
        self._task = asyncio.create_task(self._run(binary))
        await asyncio.sleep(0)
        return {"provider": "anthropic", "status": "pending", "opened_browser": True}

    async def _run(self, binary: str) -> None:
        try:
            process = await asyncio.create_subprocess_exec(
                binary,
                "auth",
                "login",
                "--claudeai",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                detail = (stderr or stdout).decode("utf-8", errors="replace").strip()
                self._last_error = detail[-500:] or "Claude browser login failed."
            self._cached_status = None
        except (OSError, asyncio.CancelledError) as exc:
            if isinstance(exc, asyncio.CancelledError):
                raise
            self._last_error = f"Could not start Claude login: {exc}"

    async def logout(self) -> None:
        binary = self.binary_finder("claude")
        if binary is not None:
            process = await asyncio.create_subprocess_exec(
                binary,
                "auth",
                "logout",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await process.communicate()
        self._cached_status = None

    def is_pending(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def last_error(self) -> str | None:
        return self._last_error


class OpenAIWebLogin:
    """Let the official Codex CLI own OpenAI's browser login and credential storage."""

    def __init__(
        self,
        store: CodexTokenStore,
        *,
        binary_finder: Callable[[str], str | None] = shutil.which,
    ) -> None:
        self.store = store
        self.binary_finder = binary_finder
        self._task: asyncio.Task[None] | None = None
        self._last_error: str | None = None

    @property
    def available(self) -> bool:
        return self.binary_finder("codex") is not None

    async def start(self) -> dict[str, Any]:
        if _openai_oauth_status(self.store)["connected"]:
            return {"provider": "openai", "status": "connected", "opened_browser": False}
        if self._task is not None and not self._task.done():
            return {"provider": "openai", "status": "pending", "opened_browser": True}
        binary = self.binary_finder("codex")
        if binary is None:
            raise RouterError(
                "Codex CLI is required for OpenAI browser login.",
                type="configuration_error",
                code="codex_cli_required",
                status_code=503,
            )
        self._last_error = None
        self._task = asyncio.create_task(self._run(binary))
        await asyncio.sleep(0)
        return {"provider": "openai", "status": "pending", "opened_browser": True}

    async def _run(self, binary: str) -> None:
        try:
            process = await asyncio.create_subprocess_exec(
                binary,
                "login",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                detail = (stderr or stdout).decode("utf-8", errors="replace").strip()
                self._last_error = detail[-500:] or "Codex browser login failed."
        except (OSError, asyncio.CancelledError) as exc:
            if isinstance(exc, asyncio.CancelledError):
                raise
            self._last_error = f"Could not start Codex login: {exc}"

    async def logout(self) -> None:
        binary = self.binary_finder("codex")
        if binary is None:
            self.store.path.unlink(missing_ok=True)
            return
        process = await asyncio.create_subprocess_exec(
            binary,
            "logout",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            detail = (stderr or stdout).decode("utf-8", errors="replace").strip()
            raise RouterError(
                detail[-500:] or "Codex logout failed.",
                type="authentication_error",
                code="openai_logout_failed",
                status_code=500,
            )

    def is_pending(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def last_error(self) -> str | None:
        return self._last_error


def _openai_oauth_status(store: CodexTokenStore) -> dict[str, Any]:
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
    connected = bool(isinstance(access_token, str) and access_token and account_id)
    claims = store.claims(tokens)
    email = claims.get("email")
    return {
        "connected": connected,
        "status": "connected" if connected else "disconnected",
        "expires_at": expires_at,
        "refreshable": bool(tokens and tokens.get("refresh_token")),
        "account": email if isinstance(email, str) else None,
        "message": (
            "Codex 브라우저 로그인 세션을 사용합니다."
            if connected
            else "OpenAI 브라우저 로그인이 필요합니다."
        ),
    }


def _router_claude_oauth_connected(store: TokenStore) -> bool:
    try:
        tokens = store.load()
    except RouterError:
        return False
    if not tokens or not isinstance(tokens.get("access_token"), str):
        return False
    try:
        expires_at = float(tokens.get("expires_at", 0))
    except (TypeError, ValueError):
        expires_at = 0
    return expires_at > time.time() or bool(tokens.get("refresh_token"))


def _profile_status(
    profile: Profile,
    anthropic_connected: bool,
    openai_store: CodexTokenStore,
) -> tuple[str, str]:
    if profile.auth == "oauth":
        if profile.provider == "openai":
            oauth = _openai_oauth_status(openai_store)
            if oauth["connected"]:
                return "ready", "OpenAI Codex 로그인 연결됨"
            return "login_required", "OpenAI 로그인이 필요합니다"
        if anthropic_connected:
            return "ready", "Claude Code 로그인 연결됨"
        return "login_required", "Claude 로그인이 필요합니다"

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
    openai_store: CodexTokenStore,
    secret_store: ProfileSecretStore,
    settings: Settings,
) -> dict[str, Any]:
    status, message = _profile_status(profile, anthropic_connected, openai_store)
    return {
        **profile.model_dump(
            mode="json",
            exclude_none=True,
            exclude={"api_key_env", "client_key_env", "port"},
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


def _opencode_config(settings: Settings, registry: ProfileRegistry) -> dict[str, Any]:
    fallback_url = f"http://{_public_host(settings.host)}:{settings.port}/v1"
    providers: dict[str, Any] = {}
    endpoints: list[dict[str, Any]] = []
    for profile in registry.profiles():
        provider_id = f"llm-router-{profile.name}"
        options = {"baseURL": fallback_url}
        if settings.master_key is not None:
            options["apiKey"] = settings.master_key
        providers[provider_id] = {
            "npm": "@ai-sdk/openai-compatible",
            "name": f"llm-router / {profile.name}",
            "options": options,
            "models": {profile.name: {"name": profile.name}},
        }
        endpoints.append({"profile": profile.name, "base_url": fallback_url})
    config = {
        "$schema": "https://opencode.ai/config.json",
        "provider": providers,
    }
    result = {
        "base_url": fallback_url,
        "endpoints": endpoints,
        "config": config,
    }
    if settings.master_key is not None:
        result["api_key"] = settings.master_key
    return result


class ProfileWrite(BaseModel):
    name: str
    provider: Literal["anthropic", "openai", "openai_compatible", "fabrix"]
    auth: Literal["oauth", "api_key"]
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
    provider: Literal["anthropic", "openai", "openai_compatible", "fabrix"]
    auth: Literal["oauth", "api_key"]
    base_url: str | None = None
    api_key: str | None = None


def build_control_router(
    settings: Settings,
    registry: ProfileRegistry,
    auth_dependency: Callable[..., Any],
    client_getter: Callable[[], Awaitable[Any]],
    *,
    token_store: TokenStore | None = None,
    codex_token_store: CodexTokenStore | None = None,
    profile_file: ProfileFile | None = None,
    secret_store: ProfileSecretStore | None = None,
    serving_manager: ProfileServingManager | None = None,
    claude_login: ClaudeWebLogin | None = None,
    openai_login: OpenAIWebLogin | None = None,
) -> APIRouter:
    router = APIRouter()
    router_claude_store = token_store or TokenStore.default()
    codex_store = codex_token_store or CodexTokenStore.default()
    profiles_file = profile_file or ProfileFile(None)
    secrets_store = secret_store or ProfileSecretStore.default()
    secrets_store.hydrate()
    claude_cli_login = claude_login or ClaudeWebLogin()
    codex_login = openai_login or OpenAIWebLogin(codex_store)
    protected = [Depends(auth_dependency)]

    @router.get("/v1/auth/status", dependencies=protected)
    async def auth_status(response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        claude_status = await claude_cli_login.status()
        router_oauth_connected = _router_claude_oauth_connected(router_claude_store)
        claude_connected = claude_status["connected"] or router_oauth_connected
        anthropic = {
            **claude_status,
            "connected": claude_connected,
            "status": "connected" if claude_connected else claude_status["status"],
            "message": (
                "Claude 브라우저 로그인 세션을 사용합니다."
                if claude_connected
                else "Claude 브라우저 로그인이 필요합니다."
            ),
            "session_source": "claude_cli"
            if claude_status["connected"]
            else "router_oauth"
            if router_oauth_connected
            else None,
        }
        anthropic.update(
            {
                "provider": "anthropic",
                "label": "Claude",
                "available": claude_cli_login.available,
                "experimental": False,
                "login_pending": claude_cli_login.is_pending(),
            }
        )
        if claude_cli_login.last_error and not anthropic["connected"]:
            anthropic.update(status="error", message=claude_cli_login.last_error)
        openai = _openai_oauth_status(codex_store)
        openai.update(
            {
                "provider": "openai",
                "label": "OpenAI",
                "available": codex_login.available,
                "experimental": False,
                "login_pending": codex_login.is_pending(),
            }
        )
        if codex_login.last_error and not openai["connected"]:
            openai.update(status="error", message=codex_login.last_error)
        return {"object": "auth_status", "data": [anthropic, openai]}

    @router.post("/v1/auth/{provider}/login", dependencies=protected)
    async def start_login(provider: str, response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        if provider == "openai":
            return await codex_login.start()
        if provider != "anthropic":
            raise RouterError(
                f"unsupported OAuth provider: {provider}",
                type="invalid_request_error",
                code="unsupported_provider",
                status_code=404,
            )
        return await claude_cli_login.start()

    @router.delete("/v1/auth/{provider}", dependencies=protected)
    async def disconnect(provider: str, response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        if provider == "openai":
            await codex_login.logout()
            return {"provider": provider, "status": "disconnected"}
        if provider != "anthropic":
            raise RouterError(
                f"unsupported OAuth provider: {provider}",
                type="invalid_request_error",
                code="unsupported_provider",
                status_code=404,
            )
        router_claude_store.delete()
        await claude_cli_login.logout()
        return {"provider": provider, "status": "disconnected"}

    @router.get("/v1/profiles", dependencies=protected)
    async def list_profiles(response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        anthropic_connected = (await claude_cli_login.status())[
            "connected"
        ] or _router_claude_oauth_connected(router_claude_store)
        return {
            "object": "list",
            "editable": True,
            "gateway": _gateway_data(settings),
            "data": [
                _profile_data(
                    profile,
                    anthropic_connected,
                    codex_store,
                    secrets_store,
                    settings,
                )
                for profile in registry.profiles()
            ],
        }

    def profile_from_payload(payload: ProfileWrite, existing: Profile | None = None) -> Profile:
        if payload.provider in {"anthropic", "openai"} and payload.auth != "oauth":
            raise RouterError(
                "OpenAI and Anthropic profiles require browser login.",
                type="invalid_request_error",
                code="browser_login_required",
                status_code=400,
            )
        api_key_env = None
        client_key_env = None
        if payload.auth == "api_key":
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
                auth=payload.auth,
                model=payload.model.strip(),
                api_key_env=api_key_env,
                client_key_env=client_key_env,
                base_url=payload.base_url.strip() if payload.base_url else None,
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
        if payload.provider in {"anthropic", "openai"} and payload.auth != "oauth":
            raise RouterError(
                "OpenAI and Anthropic profiles require browser login.",
                type="invalid_request_error",
                code="browser_login_required",
                status_code=400,
            )
        if payload.auth == "oauth":
            models = (
                ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"]
                if payload.provider == "anthropic"
                else ["gpt-5.6-sol", "gpt-5.4", "gpt-5.3-codex"]
            )
            return {"object": "list", "data": models}
        if payload.provider == "fabrix":
            raise RouterError(
                "FabriX 모델 ID는 발급받은 값을 직접 입력하세요.",
                type="invalid_request_error",
                code="fabrix_model_id_required",
                status_code=400,
            )
        key = (payload.api_key or "").strip()
        if not key:
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
            headers = {"authorization": f"Bearer {key}"}
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
        registry.upsert(profile)
        profiles_file.save(registry)
        return {"profile": profile.name, "gateway": _gateway_data(settings)}

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
        registry.upsert(profile, previous_name=profile_name)
        profiles_file.save(registry)
        return {"profile": profile.name, "gateway": _gateway_data(settings)}

    @router.delete("/v1/profiles/{profile_name}", dependencies=protected)
    async def delete_profile(profile_name: str) -> dict[str, Any]:
        registry.delete(profile_name)
        profiles_file.save(registry)
        secrets_store.delete(profile_name)
        return {"profile": profile_name, "status": "deleted"}

    @router.post("/v1/profiles/{profile_name}/start", dependencies=protected)
    async def start_profile(profile_name: str) -> dict[str, Any]:
        profile = registry.resolve(profile_name)
        anthropic_connected = (await claude_cli_login.status())[
            "connected"
        ] or _router_claude_oauth_connected(router_claude_store)
        status, message = _profile_status(profile, anthropic_connected, codex_store)
        if status != "ready":
            raise RouterError(
                message,
                type="authentication_error",
                code="profile_credential_required",
                status_code=409,
            )
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

    @router.get("/v1/connect/opencode", dependencies=protected)
    async def opencode_config(response: Response) -> dict[str, Any]:
        response.headers["Cache-Control"] = "private, no-store"
        return _opencode_config(settings, registry)

    return router
