from __future__ import annotations

from typing import Protocol


class Credential(Protocol):
    async def headers(self) -> dict[str, str]: ...


class NoAuthCredential:
    """Send no authentication header to a trusted keyless upstream."""

    async def headers(self) -> dict[str, str]:
        return {}
