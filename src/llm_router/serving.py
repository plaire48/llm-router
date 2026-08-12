from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from llm_router.config import ProfileRegistry
from llm_router.errors import RouterError


@dataclass(slots=True)
class RunningProxy:
    port: int
    server: asyncio.AbstractServer


class ProfileServingManager:
    """Expose the main OpenAI-compatible router on profile-specific localhost ports."""

    def __init__(
        self,
        registry: ProfileRegistry,
        *,
        target_host: str,
        target_port: int,
        bind_host: str = "127.0.0.1",
    ) -> None:
        self.registry = registry
        self.target_host = "127.0.0.1" if target_host in {"0.0.0.0", "::", "[::]"} else target_host
        self.target_port = target_port
        self.bind_host = bind_host
        self._running: dict[str, RunningProxy] = {}
        self._lock = asyncio.Lock()

    def status(self, profile_name: str) -> dict[str, Any]:
        profile = self.registry.resolve(profile_name)
        running = self._running.get(profile_name)
        port = running.port if running is not None else profile.port
        return {
            "status": "running" if running is not None else "stopped",
            "port": port,
            "base_url": f"http://localhost:{port}/v1" if port is not None else None,
        }

    async def start(self, profile_name: str) -> dict[str, Any]:
        async with self._lock:
            profile = self.registry.resolve(profile_name)
            if profile_name in self._running:
                return self.status(profile_name)
            if profile.port is None:
                raise RouterError(
                    "select a localhost port before starting this profile",
                    type="configuration_error",
                    code="profile_port_required",
                    status_code=400,
                )
            if profile.port == self.target_port:
                raise RouterError(
                    "profile port must differ from the desktop app port",
                    type="configuration_error",
                    code="profile_port_conflict",
                    status_code=409,
                )
            try:
                server = await asyncio.start_server(
                    self._handle_connection,
                    host=self.bind_host,
                    port=profile.port,
                )
            except OSError as exc:
                raise RouterError(
                    f"localhost:{profile.port} is unavailable",
                    type="configuration_error",
                    code="profile_port_unavailable",
                    status_code=409,
                ) from exc
            self._running[profile_name] = RunningProxy(port=profile.port, server=server)
            return self.status(profile_name)

    async def stop(self, profile_name: str) -> dict[str, Any]:
        async with self._lock:
            running = self._running.pop(profile_name, None)
            if running is not None:
                running.server.close()
                await running.server.wait_closed()
            return self.status(profile_name)

    async def stop_all(self) -> None:
        for profile_name in list(self._running):
            await self.stop(profile_name)

    async def before_profile_change(self, profile_name: str) -> bool:
        was_running = profile_name in self._running
        if was_running:
            await self.stop(profile_name)
        return was_running

    async def _handle_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        upstream_writer: asyncio.StreamWriter | None = None
        try:
            upstream_reader, upstream_writer = await asyncio.open_connection(
                self.target_host,
                self.target_port,
            )
            await asyncio.gather(
                self._pipe(reader, upstream_writer),
                self._pipe(upstream_reader, writer),
            )
        except (ConnectionError, OSError):
            pass
        finally:
            writer.close()
            if upstream_writer is not None:
                upstream_writer.close()
            await asyncio.gather(
                writer.wait_closed(),
                *([upstream_writer.wait_closed()] if upstream_writer is not None else []),
                return_exceptions=True,
            )

    @staticmethod
    async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while chunk := await reader.read(64 * 1024):
                writer.write(chunk)
                await writer.drain()
        except (ConnectionError, OSError):
            pass
        finally:
            try:
                writer.write_eof()
            except (AttributeError, OSError):
                pass
