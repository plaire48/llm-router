from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from llm_router.aipro import (
    AI_PRO_BASE_URL,
    AI_PRO_BROWSER_BASE_URL,
    effective_aipro_base_url,
    is_aipro_base_url,
)


class FunctionCall(BaseModel):
    name: str
    arguments: str


class ToolCall(BaseModel):
    id: str
    type: str = "function"
    function: FunctionCall


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: str
    content: str | list | None = None
    name: str | None = None
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None


class ToolDef(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str = "function"
    function: dict


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    max_completion_tokens: int | None = None
    stream: bool = False
    stream_options: dict | None = None
    tools: list[ToolDef] | None = None
    tool_choice: str | dict | None = None
    parallel_tool_calls: bool | None = None
    stop: str | list[str] | None = None
    response_format: dict | None = None


class Profile(BaseModel):
    name: str
    provider: Literal["anthropic", "openai", "aipro", "openai_compatible", "fabrix"]
    auth: Literal["oauth", "api_key", "none"]
    model: str
    api_key_env: str | None = None
    client_key_env: str | None = None
    base_url: str | None = None
    params: dict = Field(default_factory=dict)
    aliases: list[str] = Field(default_factory=list)
    port: int | None = Field(default=None, ge=1024, le=65535)

    @field_validator("name")
    @classmethod
    def _safe_name(cls, value: str) -> str:
        value = value.strip()
        if not value or any(
            character not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for character in value
        ):
            raise ValueError("name must use lowercase letters, numbers, '-' or '_'")
        return value

    @model_validator(mode="after")
    def _check_provider_fields(self) -> Profile:
        if self.provider in {"openai_compatible", "fabrix"} and not self.base_url:
            raise ValueError(f"{self.provider} requires base_url")
        if self.auth == "api_key" and not self.api_key_env:
            raise ValueError("auth=api_key requires api_key_env")
        if self.auth == "none" and self.provider != "openai_compatible":
            raise ValueError("auth=none is only supported for provider=openai_compatible")
        if self.provider == "fabrix" and not self.client_key_env:
            raise ValueError("fabrix requires client_key_env")
        if self.provider != "fabrix" and self.client_key_env:
            raise ValueError("client_key_env is only supported for provider=fabrix")
        if self.auth == "oauth" and self.provider not in ("anthropic", "openai", "aipro"):
            raise ValueError("auth=oauth is only supported for browser-login providers")
        if self.auth in {"oauth", "none"} and (self.api_key_env or self.client_key_env):
            raise ValueError(f"auth={self.auth} does not allow credential environment variables")
        if self.provider in {"anthropic", "openai"} and self.auth == "oauth" and self.base_url:
            raise ValueError("browser login profiles do not allow base_url")
        if self.provider == "aipro":
            default_url = AI_PRO_BROWSER_BASE_URL if self.auth == "oauth" else AI_PRO_BASE_URL
            self.base_url = effective_aipro_base_url(self.base_url or default_url, self.auth)
            if not self.model.strip():
                raise ValueError("aipro requires a model ID")
        elif (
            self.provider == "openai_compatible"
            and self.base_url
            and is_aipro_base_url(self.base_url)
        ):
            if self.auth == "none":
                raise ValueError("AI Pro endpoints require API key or browser authentication")
            self.base_url = effective_aipro_base_url(self.base_url, self.auth)
        return self
