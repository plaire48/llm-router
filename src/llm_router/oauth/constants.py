from __future__ import annotations

ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"

AUTHORIZE_URL = "https://claude.com/cai/oauth/authorize"
TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
DEFAULT_CALLBACK_PORT = 54545
REDIRECT_URI = f"http://localhost:{DEFAULT_CALLBACK_PORT}/callback"
SCOPES = [
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
    "user:file_upload",
]
OAUTH_BETA_HEADER: str | None = "oauth-2025-04-20"


def callback_uri(port: int = DEFAULT_CALLBACK_PORT) -> str:
    return f"http://localhost:{port}/callback"


def auth_headers(access_token: str) -> dict[str, str]:
    headers = {
        "authorization": f"Bearer {access_token}",
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    if OAUTH_BETA_HEADER:
        headers["anthropic-beta"] = OAUTH_BETA_HEADER
    return headers
