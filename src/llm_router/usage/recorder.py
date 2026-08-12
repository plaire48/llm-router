from __future__ import annotations

import json
import time
from typing import Any

from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.usage.store import CallRecord


def _dump(value: Any) -> str | None:
    try:
        return json.dumps(value, default=str)
    except (TypeError, ValueError):
        return None


class UsageRecorder:
    def __init__(self, store: Any | None, log_bodies: bool) -> None:
        self.store = store
        self.log_bodies = log_bodies

    def start(self, profile: Profile, request: ChatCompletionRequest) -> CallRecord:
        record = CallRecord(
            started_at=time.time(),
            profile=profile.name,
            provider=profile.provider,
            upstream_model=profile.model,
            stream=request.stream,
        )
        if self.log_bodies:
            record.request_body = _dump(request.model_dump(exclude_none=True, mode="json"))
        return record

    async def finish(
        self,
        record: CallRecord,
        *,
        adapter: Any | None = None,
        response: dict | None = None,
        error: RouterError | None = None,
    ) -> None:
        if self.store is None:
            return
        try:
            record.duration_ms = int((time.time() - record.started_at) * 1000)
            usage = getattr(adapter, "observed_usage", None)
            if isinstance(usage, dict):
                record.prompt_tokens = usage.get("prompt_tokens")
                record.completion_tokens = usage.get("completion_tokens")
                record.total_tokens = usage.get("total_tokens")
            if error is not None:
                record.ok = False
                record.status = error.status_code
                record.error_code = error.code
                record.error_message = error.message
            else:
                record.ok = True
                record.status = 200
                if self.log_bodies and response is not None:
                    record.response_body = _dump(response)
            await self.store.record(record)
        except Exception:  # noqa: BLE001 - logging must never break a request
            return
