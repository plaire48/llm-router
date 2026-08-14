from __future__ import annotations

from collections.abc import Callable
from importlib import resources
from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import HTMLResponse

from llm_router.errors import RouterError


def _require_store(store: Any | None) -> Any:
    if store is None:
        raise RouterError(
            "usage recording is disabled. Start the server with `llm-router serve`.",
            type="configuration_error",
            code="usage_disabled",
            status_code=503,
        )
    return store


def build_usage_router(
    store: Any | None,
    auth_dependency: Callable[..., Any],
    *,
    claude_account_source: Any | None = None,
    openai_account_source: Any | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/v1/usage", dependencies=[Depends(auth_dependency)])

    @router.get("/summary")
    async def summary(days: int = Query(default=7, ge=1, le=365)) -> dict:
        rows = await _require_store(store).summary(days=days)
        return {"object": "list", "days": days, "data": rows}

    @router.get("/calls")
    async def calls(
        limit: int = Query(default=50, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        profile: str | None = Query(default=None),
    ) -> dict:
        rows = await _require_store(store).calls(limit=limit, offset=offset, profile=profile)
        return {"object": "list", "data": rows}

    @router.get("/calls/{call_id}")
    async def call_detail(call_id: int) -> dict:
        row = await _require_store(store).call(call_id)
        if row is None:
            raise RouterError(
                f"call {call_id} not found",
                type="invalid_request_error",
                code="call_not_found",
                status_code=404,
            )
        return row

    @router.get("/account/claude")
    async def claude_account_usage(response: Response) -> dict:
        response.headers["Cache-Control"] = "private, no-store"
        if claude_account_source is None:
            return {
                "object": "claude_account_usage",
                "status": "not_available",
                "source": "claude_oauth_usage",
                "configured": False,
                "stale": False,
                "rate_limits": {},
            }
        return (await claude_account_source.report()).to_dict()

    @router.get("/account/openai")
    async def openai_account_usage(response: Response) -> dict:
        response.headers["Cache-Control"] = "private, no-store"
        if openai_account_source is None:
            return {
                "object": "openai_account_usage",
                "status": "not_available",
                "source": "openai_account_service",
                "configured": False,
                "stale": False,
                "rate_limits": {},
                "token_usage": {"summary": {}, "daily_usage_buckets": []},
            }
        try:
            return (await openai_account_source.report()).to_dict()
        except RouterError as exc:
            if exc.status_code < 500:
                raise
            return {
                "object": "openai_account_usage",
                "status": "temporarily_unavailable",
                "source": "openai_chatgpt_usage_api",
                "configured": True,
                "stale": False,
                "message": exc.message,
                "error_code": exc.code,
                "rate_limits": {},
                "token_usage": {"summary": {}, "daily_usage_buckets": []},
            }

    return router


def build_dashboard_router(dashboard_session: str) -> APIRouter:
    router = APIRouter()

    def issue_dashboard_session(response: Response) -> None:
        response.headers["Cache-Control"] = "private, no-store"
        response.set_cookie(
            key="llm_router_dashboard",
            value=dashboard_session,
            max_age=12 * 60 * 60,
            httponly=True,
            samesite="strict",
            path="/",
        )

    @router.get("/dashboard", response_class=HTMLResponse)
    async def dashboard() -> HTMLResponse:
        html = resources.files("llm_router.usage").joinpath("dashboard.html").read_text("utf-8")
        response = HTMLResponse(html)
        issue_dashboard_session(response)
        return response

    @router.post("/v1/dashboard/session", status_code=204)
    async def refresh_dashboard_session() -> Response:
        response = Response(status_code=204)
        issue_dashboard_session(response)
        return response

    @router.get("/favicon.svg", include_in_schema=False)
    async def favicon() -> Response:
        content = resources.files("llm_router.usage").joinpath("favicon.svg").read_bytes()
        return Response(content=content, media_type="image/svg+xml")

    return router
