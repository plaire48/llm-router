from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Any

import httpx
from fastapi import Cookie, Depends, FastAPI, File, Form, Header, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from llm_router.adapters import build_adapter
from llm_router.aipro_auth import AIProTokenStore, AIProWebLogin
from llm_router.config import ProfileFile, ProfileRegistry, Settings, is_loopback_host
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.credentials.openai_oauth import OpenAIAccountStore
from llm_router.errors import RouterError, to_openai_error
from llm_router.http_client import create_async_client
from llm_router.models import ChatCompletionRequest
from llm_router.openai_files import MAX_UPLOAD_BYTES, OpenAIFileStore
from llm_router.opencode_runtime import OpenCodeRuntime
from llm_router.profile_secrets import ProfileSecretStore
from llm_router.provider_policy import anthropic_oauth_disabled_error, is_policy_disabled
from llm_router.serving import ProfileServingManager
from llm_router.usage import UsageRecorder


def _upstream_status_error(exc: httpx.HTTPStatusError) -> RouterError:
    try:
        detail = exc.response.text
    except httpx.ResponseNotRead:
        detail = f"HTTP {exc.response.status_code}"
    return RouterError(
        f"upstream error: {detail}",
        type="upstream_error",
        code="upstream_error",
        status_code=exc.response.status_code,
    )


def _upstream_connection_error(exc: httpx.RequestError) -> RouterError:
    return RouterError(
        f"upstream connection failed: {exc}",
        type="upstream_error",
        code="upstream_connection_error",
        status_code=502,
    )


def create_app(
    settings: Settings,
    registry: ProfileRegistry,
    client: httpx.AsyncClient | None = None,
    store: object | None = None,
    token_store: TokenStore | None = None,
    codex_token_store: OpenAIAccountStore | None = None,
    profiles_path: str | Path | None = None,
    profile_secret_store: ProfileSecretStore | None = None,
    serving_manager: ProfileServingManager | None = None,
    claude_login: Any | None = None,
    openai_login: Any | None = None,
    aipro_token_store: AIProTokenStore | None = None,
    aipro_login: AIProWebLogin | None = None,
    opencode_runtime: OpenCodeRuntime | None = None,
    uploaded_files: OpenAIFileStore | None = None,
) -> FastAPI:
    if settings.master_key is None and not is_loopback_host(settings.host):
        raise RouterError(
            "LLM_ROUTER_MASTER_KEY is required when binding outside localhost",
            type="configuration_error",
            code="master_key_required",
            status_code=500,
        )

    owns_client = client is None
    active_aipro_store = aipro_token_store or AIProTokenStore.default()
    active_opencode_runtime = opencode_runtime or OpenCodeRuntime(
        base_url=settings.opencode_url,
        binary=settings.opencode_binary,
        directory=settings.opencode_directory,
        auto_start=settings.opencode_auto_start,
        startup_timeout=settings.opencode_startup_timeout,
        aipro_token_store=active_aipro_store,
    )
    if isinstance(active_opencode_runtime, OpenCodeRuntime):
        active_opencode_runtime.aipro_token_store = active_aipro_store
    active_aipro_login = aipro_login or AIProWebLogin(
        active_aipro_store,
        runtime=active_opencode_runtime,
    )
    active_openai_store = codex_token_store or OpenAIAccountStore.from_opencode(
        active_opencode_runtime.auth_path
    )
    active_uploaded_files = uploaded_files or OpenAIFileStore()
    recorder = UsageRecorder(store, log_bodies=settings.log_bodies)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        yield
        active_serving_manager = getattr(application.state, "serving_manager", None)
        if active_serving_manager is not None:
            await active_serving_manager.stop_all()
        await active_aipro_login.close()
        await active_opencode_runtime.close()
        active_uploaded_files.clear()
        active_client = application.state.client
        if owns_client and active_client is not None:
            await active_client.aclose()

    app = FastAPI(lifespan=lifespan)
    app.state.client = client
    app.state.client_lock = asyncio.Lock()
    # Kept as an injectable compatibility hook for older integrations. New
    # versions serve every profile through this FastAPI app's single gateway.
    active_serving_manager = serving_manager
    app.state.serving_manager = active_serving_manager

    async def get_client() -> httpx.AsyncClient:
        if app.state.client is None:
            async with app.state.client_lock:
                if app.state.client is None:
                    app.state.client = create_async_client(timeout=httpx.Timeout(600.0))
        return app.state.client

    def require_auth(authorization: str | None = Header(default=None)) -> None:
        if settings.master_key is None:
            return
        expected = f"Bearer {settings.master_key}"
        if authorization is None or not secrets.compare_digest(authorization, expected):
            raise RouterError(
                "invalid master key",
                type="authentication_error",
                code="invalid_api_key",
                status_code=401,
            )

    dashboard_secret = (
        settings.master_key.encode("utf-8")
        if settings.master_key is not None
        else secrets.token_bytes(32)
    )
    dashboard_session = hmac.new(
        dashboard_secret,
        b"llm-router-dashboard-session-v1",
        hashlib.sha256,
    ).hexdigest()

    def require_control_auth(
        authorization: str | None = Header(default=None),
        session: str | None = Cookie(default=None, alias="llm_router_dashboard"),
    ) -> None:
        expected = f"Bearer {settings.master_key}"
        bearer_ok = (
            settings.master_key is not None
            and authorization is not None
            and secrets.compare_digest(authorization, expected)
        )
        session_ok = session is not None and secrets.compare_digest(session, dashboard_session)
        if not bearer_ok and not session_ok:
            raise RouterError(
                (
                    "open the local dashboard first"
                    if settings.master_key is None
                    else "open the local dashboard first or provide the master key"
                ),
                type="authentication_error",
                code="invalid_api_key",
                status_code=401,
            )

    @app.exception_handler(RouterError)
    async def router_error_handler(_: Request, exc: RouterError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=to_openai_error(exc))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        error = RouterError(
            json.dumps(exc.errors(), default=str),
            type="invalid_request_error",
            code="invalid_request",
            status_code=422,
        )
        return JSONResponse(status_code=error.status_code, content=to_openai_error(error))

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
        error = RouterError(
            message,
            type="invalid_request_error" if exc.status_code < 500 else "server_error",
            code="not_found" if exc.status_code == 404 else "http_error",
            status_code=exc.status_code,
        )
        return JSONResponse(status_code=error.status_code, content=to_openai_error(error))

    @app.exception_handler(Exception)
    async def unexpected_error_handler(_: Request, __: Exception) -> JSONResponse:
        error = RouterError(
            "internal server error",
            type="server_error",
            code="internal_error",
            status_code=500,
        )
        return JSONResponse(status_code=500, content=to_openai_error(error))

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/models")
    async def models(_: None = Depends(require_auth)) -> dict:
        now = int(time.time())
        return {
            "object": "list",
            "data": [
                {
                    "id": name,
                    "object": "model",
                    "created": now,
                    "owned_by": "llm-router",
                }
                for name in registry.names()
                if not is_policy_disabled(registry.resolve(name))
            ],
        }

    @app.post("/v1/files")
    async def upload_file(
        file: Annotated[UploadFile, File()],
        purpose: Annotated[str, Form()],
        _: None = Depends(require_auth),
    ) -> dict[str, object]:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        uploaded = active_uploaded_files.add(
            data,
            filename=file.filename or "upload",
            mime_type=file.content_type or "application/octet-stream",
            purpose=purpose,
        )
        return uploaded.metadata()

    @app.get("/v1/files/{file_id}")
    async def file_metadata(
        file_id: str,
        _: None = Depends(require_auth),
    ) -> dict[str, object]:
        uploaded = active_uploaded_files.get(file_id)
        if uploaded is None:
            raise RouterError(
                "uploaded file not found or expired",
                type="invalid_request_error",
                code="file_not_found",
                status_code=404,
            )
        return uploaded.metadata()

    @app.delete("/v1/files/{file_id}")
    async def delete_file(
        file_id: str,
        _: None = Depends(require_auth),
    ) -> dict[str, object]:
        deleted = active_uploaded_files.delete(file_id)
        return {"id": file_id, "object": "file", "deleted": deleted}

    @app.post("/v1/chat/completions", response_model=None)
    async def chat(
        request: ChatCompletionRequest,
        _: None = Depends(require_auth),
    ) -> dict | StreamingResponse:
        profile = registry.resolve(request.model)
        if is_policy_disabled(profile):
            raise anthropic_oauth_disabled_error()
        active_client = await get_client()
        adapter = build_adapter(
            profile,
            active_client,
            openai_store=active_openai_store,
            opencode_runtime=active_opencode_runtime,
            file_resolver=active_uploaded_files.resolve,
        )
        record = recorder.start(profile, request)

        if request.stream:

            async def generate() -> AsyncIterator[str]:
                error: RouterError | None = None
                try:
                    async for line in adapter.stream(request, profile):
                        yield line
                except RouterError as exc:
                    error = exc
                except httpx.HTTPStatusError as exc:
                    error = _upstream_status_error(exc)
                except httpx.RequestError as exc:
                    error = _upstream_connection_error(exc)
                except Exception:  # noqa: BLE001 - response started; emit an SSE error
                    error = RouterError(
                        "streaming failed",
                        type="server_error",
                        code="stream_error",
                        status_code=500,
                    )
                if error is not None:
                    yield f"data: {json.dumps(to_openai_error(error))}\n\n"
                    yield "data: [DONE]\n\n"
                await recorder.finish(record, adapter=adapter, error=error)

            return StreamingResponse(generate(), media_type="text/event-stream")

        try:
            response = await adapter.complete(request, profile)
        except RouterError as exc:
            await recorder.finish(record, adapter=adapter, error=exc)
            raise
        except httpx.HTTPStatusError as exc:
            error = _upstream_status_error(exc)
            await recorder.finish(record, adapter=adapter, error=error)
            raise error from exc
        except httpx.RequestError as exc:
            error = _upstream_connection_error(exc)
            await recorder.finish(record, adapter=adapter, error=error)
            raise error from exc
        await recorder.finish(record, adapter=adapter, response=response)
        return response

    from llm_router.control import build_control_router
    from llm_router.usage.claude_account import ClaudeAccountSource
    from llm_router.usage.openai_account import OpenAIAccountSource
    from llm_router.usage.routes import build_dashboard_router, build_usage_router

    active_token_store = token_store or TokenStore.default()
    app.include_router(
        build_usage_router(
            store,
            require_control_auth,
            claude_account_source=ClaudeAccountSource(
                store=active_token_store,
                client=client,
                client_getter=get_client,
            ),
            openai_account_source=OpenAIAccountSource(
                store=active_openai_store,
                client=client,
                client_getter=get_client,
            ),
        )
    )
    app.include_router(
        build_control_router(
            settings,
            registry,
            require_control_auth,
            get_client,
            token_store=active_token_store,
            codex_token_store=active_openai_store,
            profile_file=ProfileFile(profiles_path),
            secret_store=profile_secret_store,
            serving_manager=active_serving_manager,
            claude_login=claude_login,
            openai_login=openai_login,
            aipro_token_store=active_aipro_store,
            aipro_login=active_aipro_login,
            opencode_runtime=active_opencode_runtime,
        )
    )
    app.include_router(build_dashboard_router(dashboard_session))

    return app
