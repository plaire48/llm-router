from llm_router.oauth import constants


def test_anthropic_oauth_headers_include_required_beta():
    assert constants.auth_headers("token") == {
        "authorization": "Bearer token",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-beta": "oauth-2025-04-20",
    }


def test_callback_uri_uses_requested_loopback_port():
    assert constants.callback_uri(54321) == "http://localhost:54321/callback"
