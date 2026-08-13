from __future__ import annotations

import webbrowser
from collections.abc import Callable

from llm_router.openai_runtime import OpenAIAccountClient


async def login(
    *,
    timeout: float = 300.0,
    browser_opener: Callable[[str], object] = webbrowser.open,
    account_client: OpenAIAccountClient | None = None,
) -> None:
    """Open the managed ChatGPT browser login with OpenAI branding."""
    client = account_client or OpenAIAccountClient()
    await client.login(browser_opener=browser_opener, timeout=timeout)
