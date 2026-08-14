from __future__ import annotations

import asyncio
import json
import os
import shutil
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TextIO

from llm_router.errors import RouterError
from llm_router.models import ChatMessage, ToolDef

MCP_PROTOCOL_VERSION = "2025-06-18"
DEFAULT_TOOL_TIMEOUT_SECONDS = 30 * 60


def _atomic_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _sanitize_tool_name(value: str) -> str:
    return "".join(
        character if character.isalnum() or character in "_-" else "_" for character in value
    )


def _tool_payload(tool: ToolDef) -> dict[str, Any]:
    if tool.type != "function":
        raise RouterError(
            f"OpenCode supports function tools only, not {tool.type!r}.",
            type="invalid_request_error",
            code="invalid_tools",
            status_code=422,
        )
    function = tool.function
    name = function.get("name")
    if not isinstance(name, str) or not name.strip():
        raise RouterError(
            "OpenCode tool definitions require a function name.",
            type="invalid_request_error",
            code="invalid_tools",
            status_code=422,
        )
    parameters = function.get("parameters")
    if not isinstance(parameters, dict):
        parameters = {"type": "object", "properties": {}}
    result: dict[str, Any] = {"name": name, "inputSchema": parameters}
    description = function.get("description")
    if isinstance(description, str) and description:
        result["description"] = description
    return result


@dataclass
class BridgeCall:
    id: str
    name: str
    arguments: dict[str, Any]
    file_key: str


@dataclass
class BridgeContext:
    id: str
    mcp_name: str
    session_id: str
    profile_name: str
    directory: Path
    tool_names: tuple[str, ...]
    created_at: float = field(default_factory=time.monotonic)
    returned_call_ids: set[str] = field(default_factory=set)
    pending_call_ids: set[str] = field(default_factory=set)
    result_paths: dict[str, Path] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def opencode_tool_ids(self) -> tuple[str, ...]:
        return tuple(
            f"{_sanitize_tool_name(self.mcp_name)}_{_sanitize_tool_name(name)}"
            for name in self.tool_names
        )

    def expired(self, timeout: float) -> bool:
        return time.monotonic() - self.created_at >= timeout


class OpenCodeToolBridge:
    """Coordinate caller-owned tools with a router-managed OpenCode MCP process."""

    def __init__(
        self,
        directory: str | Path,
        *,
        tool_timeout: float = DEFAULT_TOOL_TIMEOUT_SECONDS,
    ) -> None:
        instance = f"{os.getpid()}-{uuid.uuid4().hex}"
        self.root = Path(directory).expanduser() / "tool-bridge" / instance
        self.tool_timeout = tool_timeout
        self._contexts: dict[str, BridgeContext] = {}
        self._calls: dict[str, BridgeContext] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        tools: list[ToolDef],
        *,
        session_id: str,
        profile_name: str,
    ) -> BridgeContext:
        definitions = [_tool_payload(tool) for tool in tools]
        names = [str(item["name"]) for item in definitions]
        sanitized = [_sanitize_tool_name(name) for name in names]
        if len(set(names)) != len(names) or len(set(sanitized)) != len(sanitized):
            raise RouterError(
                "OpenCode tool names must be unique after replacing unsupported characters.",
                type="invalid_request_error",
                code="invalid_tools",
                status_code=422,
            )
        bridge_id = uuid.uuid4().hex
        context = BridgeContext(
            id=bridge_id,
            mcp_name=f"llmrouter_{bridge_id[:16]}",
            session_id=session_id,
            profile_name=profile_name,
            directory=self.root / bridge_id,
            tool_names=tuple(names),
        )
        await asyncio.to_thread(
            _atomic_json, context.directory / "tools.json", {"tools": definitions}
        )
        async with self._lock:
            self._contexts[context.id] = context
        return context

    def mcp_config(self, context: BridgeContext) -> dict[str, Any]:
        return {
            "type": "local",
            "command": [sys.executable, "-m", "llm_router.opencode_tool_bridge", "--stdio"],
            "environment": {
                "LLM_ROUTER_TOOL_BRIDGE_DIR": str(context.directory),
                "LLM_ROUTER_TOOL_TIMEOUT": str(self.tool_timeout),
            },
            "enabled": True,
            "timeout": max(1, int(self.tool_timeout * 1000)),
        }

    async def new_calls(self, context: BridgeContext) -> list[BridgeCall]:
        records = await asyncio.to_thread(self._call_records, context)
        new = [call for call in records if call.id not in context.returned_call_ids]
        if not new:
            return []
        # Tool calls from one model step arrive very close together. Let parallel
        # calls reach the bridge before returning the OpenAI response.
        await asyncio.sleep(0.05)
        records = await asyncio.to_thread(self._call_records, context)
        new = [call for call in records if call.id not in context.returned_call_ids]
        async with self._lock:
            for call in new:
                context.returned_call_ids.add(call.id)
                context.pending_call_ids.add(call.id)
                context.result_paths[call.id] = (
                    context.directory / "results" / f"{call.file_key}.json"
                )
                self._calls[call.id] = context
        return new

    async def context_for_results(
        self,
        messages: list[ChatMessage],
        *,
        profile_name: str,
    ) -> tuple[BridgeContext, list[ChatMessage]]:
        trailing: list[ChatMessage] = []
        for message in reversed(messages):
            if message.role != "tool":
                break
            trailing.append(message)
        trailing.reverse()
        if not trailing or any(not message.tool_call_id for message in trailing):
            raise RouterError(
                "Tool results require tool_call_id.",
                type="invalid_request_error",
                code="invalid_tool_results",
                status_code=422,
            )
        async with self._lock:
            contexts = [self._calls.get(str(message.tool_call_id)) for message in trailing]
        if any(context is None for context in contexts) or any(
            context is not contexts[0] for context in contexts[1:]
        ):
            raise RouterError(
                "The OpenCode tool session expired or the tool_call_id is unknown.",
                type="invalid_request_error",
                code="opencode_tool_session_expired",
                status_code=409,
            )
        context = contexts[0]
        assert context is not None
        if context.profile_name != profile_name:
            raise RouterError(
                "Tool results must use the same model profile as the original call.",
                type="invalid_request_error",
                code="opencode_tool_profile_mismatch",
                status_code=409,
            )
        provided = {str(message.tool_call_id) for message in trailing}
        if provided != context.pending_call_ids:
            missing = sorted(context.pending_call_ids - provided)
            unknown = sorted(provided - context.pending_call_ids)
            detail = []
            if missing:
                detail.append(f"missing: {', '.join(missing)}")
            if unknown:
                detail.append(f"unexpected: {', '.join(unknown)}")
            raise RouterError(
                "All tool results from the current OpenCode step are required ("
                + "; ".join(detail)
                + ").",
                type="invalid_request_error",
                code="incomplete_tool_results",
                status_code=422,
            )
        return context, trailing

    async def submit_results(
        self,
        context: BridgeContext,
        messages: list[ChatMessage],
    ) -> None:
        async with context.lock:
            for message in messages:
                call_id = str(message.tool_call_id)
                result_path = context.result_paths[call_id]
                await asyncio.to_thread(
                    _atomic_json,
                    result_path,
                    {"content": message.content, "is_error": False},
                )
            async with self._lock:
                for message in messages:
                    call_id = str(message.tool_call_id)
                    context.pending_call_ids.discard(call_id)
                    self._calls.pop(call_id, None)

    async def discard(self, context: BridgeContext) -> None:
        async with self._lock:
            self._contexts.pop(context.id, None)
            for call_id in tuple(context.returned_call_ids):
                self._calls.pop(call_id, None)
        await asyncio.to_thread(shutil.rmtree, context.directory, True)

    async def close(self) -> None:
        async with self._lock:
            contexts = list(self._contexts.values())
            self._contexts.clear()
            self._calls.clear()
        for context in contexts:
            await asyncio.to_thread(shutil.rmtree, context.directory, True)
        await asyncio.to_thread(shutil.rmtree, self.root, True)

    @staticmethod
    def _call_records(context: BridgeContext) -> list[BridgeCall]:
        calls: list[tuple[float, BridgeCall]] = []
        for path in (context.directory / "calls").glob("*.json"):
            payload = _read_json(path)
            if payload is None:
                continue
            call_id = payload.get("id")
            name = payload.get("name")
            arguments = payload.get("arguments")
            created_at = payload.get("created_at")
            if not isinstance(call_id, str) or not isinstance(name, str):
                continue
            if not isinstance(arguments, dict):
                arguments = {"value": arguments}
            order = (
                float(created_at) if isinstance(created_at, (int, float)) else path.stat().st_mtime
            )
            calls.append(
                (
                    order,
                    BridgeCall(
                        id=call_id,
                        name=name,
                        arguments=arguments,
                        file_key=path.stem,
                    ),
                )
            )
        calls.sort(key=lambda item: item[0])
        return [call for _, call in calls]


def _result_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = [
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") in {"text", "input_text", "output_text"}
        ]
        if texts:
            return "".join(texts)
    return json.dumps(content, ensure_ascii=False)


class _StdioMcpServer:
    def __init__(self, directory: Path, stdin: TextIO, stdout: TextIO) -> None:
        self.directory = directory
        self.stdin = stdin
        self.stdout = stdout
        self.tools = (_read_json(directory / "tools.json") or {}).get("tools", [])
        self.timeout = float(
            os.environ.get("LLM_ROUTER_TOOL_TIMEOUT", DEFAULT_TOOL_TIMEOUT_SECONDS)
        )
        self._write_lock = threading.Lock()

    def run(self) -> None:
        for line in self.stdin:
            try:
                request = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(request, dict):
                continue
            method = request.get("method")
            request_id = request.get("id")
            if request_id is None:
                continue
            if method == "tools/call":
                threading.Thread(target=self._call_tool, args=(request,), daemon=True).start()
                continue
            self._handle(request)

    def _handle(self, request: dict[str, Any]) -> None:
        method = request.get("method")
        request_id = request.get("id")
        if method == "initialize":
            params = request.get("params")
            requested = params.get("protocolVersion") if isinstance(params, dict) else None
            self._respond(
                request_id,
                {
                    "protocolVersion": requested
                    if isinstance(requested, str)
                    else MCP_PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": "llm-router-tool-bridge", "version": "1.0.0"},
                },
            )
        elif method == "tools/list":
            self._respond(request_id, {"tools": self.tools if isinstance(self.tools, list) else []})
        elif method == "ping":
            self._respond(request_id, {})
        else:
            self._error(request_id, -32601, f"Method not found: {method}")

    def _call_tool(self, request: dict[str, Any]) -> None:
        request_id = request.get("id")
        params = request.get("params")
        if not isinstance(params, dict) or not isinstance(params.get("name"), str):
            self._error(request_id, -32602, "Invalid tools/call parameters")
            return
        name = params["name"]
        allowed = {
            item.get("name")
            for item in self.tools
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
        if name not in allowed:
            self._error(request_id, -32602, f"Unknown tool: {name}")
            return
        arguments = params.get("arguments")
        if not isinstance(arguments, dict):
            arguments = {"value": arguments}
        call_id = f"call_{uuid.uuid4().hex}"
        file_key = uuid.uuid4().hex
        call_path = self.directory / "calls" / f"{file_key}.json"
        result_path = self.directory / "results" / f"{file_key}.json"
        _atomic_json(
            call_path,
            {
                "id": call_id,
                "name": name,
                "arguments": arguments,
                "created_at": time.time_ns(),
            },
        )
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            result = _read_json(result_path)
            if result is not None:
                self._respond(
                    request_id,
                    {
                        "content": [{"type": "text", "text": _result_text(result.get("content"))}],
                        "isError": result.get("is_error") is True,
                    },
                )
                return
            time.sleep(0.05)
        self._respond(
            request_id,
            {
                "content": [{"type": "text", "text": "Tool result timed out."}],
                "isError": True,
            },
        )

    def _respond(self, request_id: object, result: object) -> None:
        self._write({"jsonrpc": "2.0", "id": request_id, "result": result})

    def _error(self, request_id: object, code: int, message: str) -> None:
        self._write(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
        )

    def _write(self, payload: dict[str, Any]) -> None:
        with self._write_lock:
            self.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
            self.stdout.flush()


def _stdio_main() -> int:
    value = os.environ.get("LLM_ROUTER_TOOL_BRIDGE_DIR")
    if not value:
        return 2
    _StdioMcpServer(Path(value), sys.stdin, sys.stdout).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(_stdio_main() if "--stdio" in sys.argv else 2)
