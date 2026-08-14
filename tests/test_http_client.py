import os

import certifi
import pytest

from llm_router.errors import RouterError
from llm_router.http_client import create_async_client, create_ssl_context


class FakeSSLContext:
    def __init__(self) -> None:
        self.loaded: list[str] = []

    def load_verify_locations(self, *, cafile: str) -> None:
        self.loaded.append(cafile)


def test_node_extra_ca_is_added_to_default_certifi_store(tmp_path, monkeypatch):
    extra_ca = tmp_path / "company.pem"
    extra_ca.write_text("test certificate", encoding="utf-8")
    context = FakeSSLContext()
    created = {}

    def fake_create_default_context(**kwargs):
        created.update(kwargs)
        return context

    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(extra_ca))
    monkeypatch.setattr(
        "llm_router.http_client.ssl.create_default_context", fake_create_default_context
    )

    assert create_ssl_context() is context
    assert created == {}
    assert context.loaded == [certifi.where(), str(extra_ca)]


def test_official_codex_ca_is_added_to_default_certifi_store(tmp_path, monkeypatch):
    extra_ca = tmp_path / "company.pem"
    extra_ca.write_text("test certificate", encoding="utf-8")
    context = FakeSSLContext()

    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.delenv("NODE_EXTRA_CA_CERTS", raising=False)
    monkeypatch.setenv("CODEX_CA_CERTIFICATE", str(extra_ca))
    monkeypatch.setattr("llm_router.http_client.ssl.create_default_context", lambda **_: context)

    assert create_ssl_context() is context
    assert context.loaded == [certifi.where(), str(extra_ca)]


def test_node_extra_ca_can_be_loaded_from_dotenv(tmp_path, monkeypatch):
    extra_ca = tmp_path / "company.pem"
    extra_ca.write_text("test certificate", encoding="utf-8")
    (tmp_path / ".env").write_text(
        f"NODE_EXTRA_CA_CERTS={extra_ca}\n",
        encoding="utf-8",
    )
    context = FakeSSLContext()

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setattr("llm_router.http_client.ssl.create_default_context", lambda **_: context)

    previous = os.environ.pop("NODE_EXTRA_CA_CERTS", None)
    try:
        assert create_ssl_context() is context
        assert context.loaded == [certifi.where(), str(extra_ca)]
    finally:
        if previous is None:
            os.environ.pop("NODE_EXTRA_CA_CERTS", None)
        else:
            os.environ["NODE_EXTRA_CA_CERTS"] = previous


def test_ssl_cert_file_remains_the_base_and_node_ca_is_added(tmp_path, monkeypatch):
    base_ca = tmp_path / "base.pem"
    extra_ca = tmp_path / "company.pem"
    context = FakeSSLContext()
    created = {}

    def fake_create_default_context(*, cafile=None, capath=None):
        created.update(cafile=cafile, capath=capath)
        return context

    monkeypatch.setenv("SSL_CERT_FILE", str(base_ca))
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(extra_ca))
    monkeypatch.setattr(
        "llm_router.http_client.ssl.create_default_context", fake_create_default_context
    )

    assert create_ssl_context() is context
    assert created == {"cafile": str(base_ca), "capath": None}
    assert context.loaded == [str(extra_ca)]


def test_default_tls_context_keeps_system_store_and_adds_certifi(monkeypatch):
    context = FakeSSLContext()
    created = {}

    def fake_create_default_context(**kwargs):
        created.update(kwargs)
        return context

    for variable in (
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "CODEX_CA_CERTIFICATE",
        "NODE_EXTRA_CA_CERTS",
    ):
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.setattr(
        "llm_router.http_client.ssl.create_default_context", fake_create_default_context
    )

    assert create_ssl_context() is context
    assert created == {}
    assert context.loaded == [certifi.where()]


def test_invalid_node_extra_ca_has_actionable_error(tmp_path, monkeypatch):
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(tmp_path / "missing.pem"))

    with pytest.raises(RouterError) as error:
        create_ssl_context()

    assert error.value.code == "tls_ca_bundle_invalid"
    assert "NODE_EXTRA_CA_CERTS" in error.value.message


def test_async_client_uses_shared_ssl_context(monkeypatch):
    ssl_context = object()
    captured = {}

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr("llm_router.http_client.create_ssl_context", lambda: ssl_context)
    monkeypatch.setattr("llm_router.http_client.httpx.AsyncClient", FakeAsyncClient)

    client = create_async_client(timeout=30.0)

    assert isinstance(client, FakeAsyncClient)
    assert captured == {"timeout": 30.0, "verify": ssl_context}
