from __future__ import annotations

import asyncio
import json
import secrets
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from llm_router.adapters import build_adapter
from llm_router.config import ProfileRegistry, Settings
from llm_router.errors import RouterError, to_openai_error
from llm_router.models import ChatCompletionRequest


def _upstream_status_error(exc: httpx.HTTPStatusError) -> RouterError:
    return RouterError(
        f"upstream error: {exc.response.text}",
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
) -> FastAPI:
    owns_client = client is None

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        yield
        active_client = application.state.client
        if owns_client and active_client is not None:
            await active_client.aclose()

    app = FastAPI(lifespan=lifespan)
    app.state.client = client
    app.state.client_lock = asyncio.Lock()

    async def get_client() -> httpx.AsyncClient:
        if app.state.client is None:
            async with app.state.client_lock:
                if app.state.client is None:
                    app.state.client = httpx.AsyncClient(timeout=httpx.Timeout(600.0))
        return app.state.client

    def require_auth(authorization: str | None = Header(default=None)) -> None:
        expected = f"Bearer {settings.master_key}"
        if authorization is None or not secrets.compare_digest(authorization, expected):
            raise RouterError(
                "invalid master key",
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
            ],
        }

    @app.post("/v1/chat/completions", response_model=None)
    async def chat(
        request: ChatCompletionRequest,
        _: None = Depends(require_auth),
    ) -> dict | StreamingResponse:
        profile = registry.resolve(request.model)
        active_client = await get_client()
        adapter = build_adapter(profile, active_client)
        if request.stream:

            async def generate() -> AsyncIterator[str]:
                try:
                    async for line in adapter.stream(request, profile):
                        yield line
                except RouterError as exc:
                    yield f"data: {json.dumps(to_openai_error(exc))}\n\n"
                    yield "data: [DONE]\n\n"
                except httpx.HTTPStatusError as exc:
                    error = _upstream_status_error(exc)
                    yield f"data: {json.dumps(to_openai_error(error))}\n\n"
                    yield "data: [DONE]\n\n"
                except httpx.RequestError as exc:
                    error = _upstream_connection_error(exc)
                    yield f"data: {json.dumps(to_openai_error(error))}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception:  # noqa: BLE001 - response has started; emit an SSE error
                    error = RouterError(
                        "streaming failed",
                        type="server_error",
                        code="stream_error",
                        status_code=500,
                    )
                    yield f"data: {json.dumps(to_openai_error(error))}\n\n"
                    yield "data: [DONE]\n\n"

            return StreamingResponse(generate(), media_type="text/event-stream")

        try:
            return await adapter.complete(request, profile)
        except RouterError:
            raise
        except httpx.HTTPStatusError as exc:
            raise _upstream_status_error(exc) from exc
        except httpx.RequestError as exc:
            raise _upstream_connection_error(exc) from exc

    return app
