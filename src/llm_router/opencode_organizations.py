from __future__ import annotations

from urllib.parse import urlsplit

AI_PRO_ORIGIN = "https://aipro.sdsdev.co.kr"


def normalize_organization_origin(value: str) -> str:
    """Normalize an OpenCode organization login origin without accepting URL paths."""
    parsed = urlsplit(value.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("OpenCode organization login requires an HTTPS origin")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("OpenCode organization login URL must not contain a path")
    host = parsed.hostname.lower()
    port = f":{parsed.port}" if parsed.port is not None else ""
    return f"https://{host}{port}"
