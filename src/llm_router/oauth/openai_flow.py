from __future__ import annotations

import webbrowser
from collections.abc import Callable

import httpx

from llm_router.config import Settings
from llm_router.http_client import create_async_client
from llm_router.opencode_runtime import OpenCodeRuntime


async def login(
    *,
    timeout: float = 300.0,
    browser_opener: Callable[[str], object] = webbrowser.open,
    runtime: OpenCodeRuntime | None = None,
    client: httpx.AsyncClient | None = None,
) -> None:
    """Open the ChatGPT browser login owned by the bundled OpenCode runtime."""
    if runtime is None:
        settings = Settings()
        active_runtime = OpenCodeRuntime(
            base_url=settings.opencode_url,
            binary=settings.opencode_binary,
            directory=settings.opencode_directory,
            auto_start=settings.opencode_auto_start,
            startup_timeout=settings.opencode_startup_timeout,
        )
    else:
        active_runtime = runtime
    active_client = client or create_async_client(timeout=httpx.Timeout(timeout + 10))
    try:
        await active_runtime.login_openai(
            active_client,
            browser_opener=browser_opener,
            timeout=timeout,
        )
    finally:
        if runtime is None:
            await active_runtime.close()
        if client is None:
            await active_client.aclose()
