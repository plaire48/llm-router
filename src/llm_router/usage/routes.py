from __future__ import annotations

from collections.abc import Callable
from importlib import resources
from typing import Any

from fastapi import APIRouter, Depends, Query
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


def build_usage_router(store: Any | None, auth_dependency: Callable[..., Any]) -> APIRouter:
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

    return router


def build_dashboard_router() -> APIRouter:
    router = APIRouter()

    @router.get("/dashboard", response_class=HTMLResponse)
    async def dashboard() -> HTMLResponse:
        html = resources.files("llm_router.usage").joinpath("dashboard.html").read_text("utf-8")
        return HTMLResponse(html)

    return router
