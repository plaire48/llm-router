from __future__ import annotations


class RouterError(Exception):
    def __init__(
        self,
        message: str,
        *,
        type: str = "invalid_request_error",
        code: str | None = None,
        status_code: int = 400,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.type = type
        self.code = code
        self.status_code = status_code


def to_openai_error(exc: RouterError) -> dict:
    return {"error": {"message": exc.message, "type": exc.type, "code": exc.code}}
