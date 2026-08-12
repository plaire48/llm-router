from __future__ import annotations

from typing import Protocol


class Credential(Protocol):
    async def headers(self) -> dict[str, str]: ...
