from llm_router import __version__
from llm_router.errors import RouterError, to_openai_error


def test_version_present():
    assert isinstance(__version__, str) and __version__


def test_error_serializes_to_openai_format():
    exc = RouterError("nope", type="invalid_request_error", code="bad", status_code=404)
    assert to_openai_error(exc) == {
        "error": {"message": "nope", "type": "invalid_request_error", "code": "bad"}
    }
    assert exc.status_code == 404
