from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    provider: Literal["anthropic", "openai", "openai_compatible"]
    auth: Literal["oauth", "api_key"]
    model: str
    api_key_env: str | None = None
    base_url: str | None = None
    params: dict = Field(default_factory=dict)
    aliases: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_provider_fields(self) -> Profile:
        if self.provider == "openai_compatible" and not self.base_url:
            raise ValueError("openai_compatible requires base_url")
        if self.auth == "api_key" and not self.api_key_env:
            raise ValueError("auth=api_key requires api_key_env")
        if self.auth == "oauth" and self.provider not in ("anthropic", "openai"):
            raise ValueError("auth=oauth is only supported for provider in {anthropic, openai}")
        if self.auth == "oauth" and self.api_key_env:
            raise ValueError("auth=oauth does not allow api_key_env")
        return self
