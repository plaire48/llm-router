from __future__ import annotations

import os
from typing import Literal

from llm_router.errors import RouterError
from llm_router.oauth.constants import ANTHROPIC_VERSION


class EnvApiKey:
    def __init__(self, env_var: str, style: Literal["bearer", "x-api-key"]) -> None:
        self.env_var = env_var
        self.style = style

    async def headers(self) -> dict[str, str]:
        key = os.environ.get(self.env_var, "").strip()
        if not key:
            raise RouterError(
                f"missing credential: set {self.env_var} in .env",
                type="authentication_error",
                code="missing_credential",
                status_code=401,
            )
        if self.style == "bearer":
            return {"authorization": f"Bearer {key}"}
        return {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
