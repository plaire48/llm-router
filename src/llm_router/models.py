from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
    stream: bool = False
    tools: list[ToolDef] | None = None
    tool_choice: str | dict | None = None
    stop: str | list[str] | None = None


class Profile(BaseModel):
    name: str
    provider: Literal["anthropic", "openai", "aipro", "openai_compatible", "fabrix"]
    auth: Literal["oauth", "api_key"]
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
        if self.provider == "fabrix" and not self.client_key_env:
            raise ValueError("fabrix requires client_key_env")
        if self.provider != "fabrix" and self.client_key_env:
            raise ValueError("client_key_env is only supported for provider=fabrix")
        if self.auth == "oauth" and self.provider not in ("anthropic", "openai", "aipro"):
            raise ValueError(
                "auth=oauth is only supported for provider in {anthropic, openai, aipro}"
            )
        if self.auth == "oauth" and (self.api_key_env or self.client_key_env):
            raise ValueError("auth=oauth does not allow credential environment variables")
        if (
            self.provider in {"anthropic", "openai", "aipro"}
            and self.auth == "oauth"
            and self.base_url
        ):
            raise ValueError("browser login profiles do not allow base_url")
        if self.provider == "aipro" and self.auth != "oauth":
            raise ValueError("aipro requires browser OAuth")
        if self.provider == "aipro":
            provider_id, separator, model_id = self.model.strip().partition("/")
            if not separator or not provider_id or not model_id:
                raise ValueError("aipro model must use the OpenCode provider/model form")
        return self
