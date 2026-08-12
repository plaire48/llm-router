from __future__ import annotations

import asyncio
import json
import shutil
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx

from llm_router.adapters.anthropic import AnthropicAdapter
from llm_router.credentials.anthropic_oauth import AnthropicOAuth, TokenStore
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile


class ClaudeCodeAdapter:
    """Serve the official Claude Code browser-login session as Chat Completions."""

    def __init__(self, *, binary_finder: Callable[[str], str | None] = shutil.which) -> None:
        self.binary_finder = binary_finder
        self.observed_usage: dict[str, int] | None = None

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict[str, Any]:
        self._validate(request)
        process = await self._spawn(request, profile, stream=False)
        stdout, stderr = await process.communicate(self._prompt(request).encode())
        if process.returncode != 0:
            raise self._process_error(stderr or stdout)
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise self._invalid_response("result is not valid JSON") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("result"), str):
            raise self._invalid_response("result text is missing")
        self._observe_usage(payload.get("usage"))
        completion_id = f"chatcmpl-claude-{int(time.time() * 1000)}"
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": int(time.time()),
            "model": profile.name,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": payload["result"]},
                    "finish_reason": "stop",
                }
            ],
            "usage": self.observed_usage
            or {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        }

    async def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]:
        self._validate(request)
        process = await self._spawn(request, profile, stream=True)
        if process.stdin is None or process.stdout is None:
            raise self._invalid_response("Claude Code stdio is unavailable")
        process.stdin.write(self._prompt(request).encode())
        await process.stdin.drain()
        process.stdin.close()
        completion_id = f"chatcmpl-claude-{int(time.time() * 1000)}"
        yield self._chunk(completion_id, profile.name, {"role": "assistant"})
        stderr_task = asyncio.create_task(process.stderr.read()) if process.stderr else None
        async for raw_line in process.stdout:
            try:
                event = json.loads(raw_line)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict):
                continue
            if event.get("type") == "stream_event":
                stream_event = event.get("event")
                if not isinstance(stream_event, dict):
                    continue
                delta = stream_event.get("delta")
                if isinstance(delta, dict) and delta.get("type") == "text_delta":
                    text = delta.get("text")
                    if isinstance(text, str) and text:
                        yield self._chunk(completion_id, profile.name, {"content": text})
            if event.get("type") == "result":
                self._observe_usage(event.get("usage"))
        return_code = await process.wait()
        stderr = await stderr_task if stderr_task is not None else b""
        if return_code != 0:
            raise self._process_error(stderr)
        yield self._chunk(completion_id, profile.name, {}, finish_reason="stop")
        yield "data: [DONE]\n\n"

    async def _spawn(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
        *,
        stream: bool,
    ) -> asyncio.subprocess.Process:
        binary = self.binary_finder("claude")
        if binary is None:
            raise RouterError(
                "Claude Code CLI is required for Claude browser-login serving.",
                type="configuration_error",
                code="claude_cli_required",
                status_code=503,
            )
        command = [
            binary,
            "-p",
            "--safe-mode",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--tools",
            "",
            "--model",
            profile.model,
            "--output-format",
            "stream-json" if stream else "json",
        ]
        if stream:
            command.append("--include-partial-messages")
        system = self._system_prompt(request) or "You are a helpful assistant."
        command.extend(["--system-prompt", system])
        try:
            return await asyncio.create_subprocess_exec(
                *command,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except OSError as exc:
            raise RouterError(
                f"Could not start Claude Code: {exc}",
                type="upstream_error",
                code="claude_cli_unavailable",
                status_code=503,
            ) from exc

    @staticmethod
    def _validate(request: ChatCompletionRequest) -> None:
        if request.tools:
            raise RouterError(
                "Claude Code browser-login profiles do not yet support OpenAI tool calls.",
                type="invalid_request_error",
                code="tools_not_supported",
                status_code=400,
            )

    @staticmethod
    def _content_text(content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    text = item.get("text")
                    if isinstance(text, str):
                        parts.append(text)
            return "\n".join(parts)
        return ""

    @classmethod
    def _system_prompt(cls, request: ChatCompletionRequest) -> str:
        return "\n\n".join(
            cls._content_text(message.content)
            for message in request.messages
            if message.role == "system" and cls._content_text(message.content)
        )

    @classmethod
    def _prompt(cls, request: ChatCompletionRequest) -> str:
        lines: list[str] = []
        for message in request.messages:
            if message.role == "system":
                continue
            text = cls._content_text(message.content)
            if message.role == "user":
                lines.append(f"User: {text}")
            elif message.role == "assistant":
                lines.append(f"Assistant: {text}")
            elif message.role == "tool":
                lines.append(f"Tool result: {text}")
        lines.append("Assistant:")
        return "\n\n".join(lines)

    def _observe_usage(self, usage: Any) -> None:
        if not isinstance(usage, dict):
            return
        prompt = sum(
            int(usage.get(key) or 0)
            for key in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
        )
        completion = int(usage.get("output_tokens") or 0)
        self.observed_usage = {
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": prompt + completion,
        }

    @staticmethod
    def _chunk(
        completion_id: str,
        model: str,
        delta: dict[str, Any],
        *,
        finish_reason: str | None = None,
    ) -> str:
        payload = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }
        return f"data: {json.dumps(payload)}\n\n"

    @staticmethod
    def _process_error(output: bytes) -> RouterError:
        detail = output.decode("utf-8", errors="replace").strip()[-500:]
        return RouterError(
            detail or "Claude Code request failed. Run Claude login again.",
            type="authentication_error",
            code="claude_cli_request_failed",
            status_code=401,
        )

    @staticmethod
    def _invalid_response(detail: str) -> RouterError:
        return RouterError(
            f"Claude Code returned an invalid response: {detail}",
            type="upstream_error",
            code="invalid_claude_code_response",
            status_code=502,
        )


class ClaudeOAuthAdapter:
    """Use an existing router OAuth login, falling back to the official Claude CLI session."""

    def __init__(self, client: httpx.AsyncClient, *, store: TokenStore | None = None) -> None:
        self.client = client
        self.store = store or TokenStore.default()
        self.observed_usage: dict[str, int] | None = None

    async def _delegate(self) -> AnthropicAdapter | ClaudeCodeAdapter:
        binary = shutil.which("claude")
        if binary is not None:
            try:
                process = await asyncio.create_subprocess_exec(
                    binary,
                    "auth",
                    "status",
                    "--json",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                stdout, _ = await asyncio.wait_for(process.communicate(), timeout=5)
                status = json.loads(stdout) if process.returncode == 0 else {}
            except (OSError, TimeoutError, json.JSONDecodeError):
                status = {}
            if status.get("loggedIn") is True:
                return ClaudeCodeAdapter()
        try:
            tokens = self.store.load()
        except RouterError:
            tokens = None
        if tokens:
            return AnthropicAdapter(self.client, AnthropicOAuth(self.store, self.client))
        return ClaudeCodeAdapter()

    async def complete(self, request: ChatCompletionRequest, profile: Profile) -> dict[str, Any]:
        delegate = await self._delegate()
        result = await delegate.complete(request, profile)
        self.observed_usage = delegate.observed_usage
        return result

    async def stream(
        self,
        request: ChatCompletionRequest,
        profile: Profile,
    ) -> AsyncIterator[str]:
        delegate = await self._delegate()
        async for chunk in delegate.stream(request, profile):
            yield chunk
        self.observed_usage = delegate.observed_usage
