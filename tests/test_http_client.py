import asyncio
import os
import ssl
from pathlib import Path

import certifi
import pytest

from llm_router.errors import RouterError
from llm_router.http_client import create_async_client, create_ssl_context

PEM_MARKER = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n"


class FakeSSLContext:
    def __init__(self) -> None:
        self.loaded: list[str] = []
        self.verify_flags = 0

    def load_verify_locations(self, *, cafile: str) -> None:
        self.loaded.append(cafile)


def test_node_extra_ca_is_added_to_default_certifi_store(tmp_path, monkeypatch):
    extra_ca = tmp_path / "company.pem"
    extra_ca.write_text(PEM_MARKER, encoding="utf-8")
    context = FakeSSLContext()
    created = {}

    def fake_create_default_context(**kwargs):
        created.update(kwargs)
        return context

    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(extra_ca))
    monkeypatch.setattr(
        "llm_router.http_client.truststore.SSLContext",
        lambda protocol: fake_create_default_context(protocol=protocol),
    )

    assert create_ssl_context() is context
    assert created == {"protocol": ssl.PROTOCOL_TLS_CLIENT}
    assert context.loaded == [certifi.where(), str(extra_ca)]
    assert context.verify_flags & ssl.VERIFY_X509_PARTIAL_CHAIN


def test_official_codex_ca_is_added_to_default_certifi_store(tmp_path, monkeypatch):
    extra_ca = tmp_path / "company.pem"
    extra_ca.write_text(PEM_MARKER, encoding="utf-8")
    context = FakeSSLContext()

    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.delenv("NODE_EXTRA_CA_CERTS", raising=False)
    monkeypatch.setenv("CODEX_CA_CERTIFICATE", str(extra_ca))
    monkeypatch.setattr("llm_router.http_client.truststore.SSLContext", lambda _: context)

    assert create_ssl_context() is context
    assert context.loaded == [certifi.where(), str(extra_ca)]


def test_node_extra_ca_can_be_loaded_from_dotenv(tmp_path, monkeypatch):
    extra_ca = tmp_path / "sds.crt"
    extra_ca.write_text(PEM_MARKER, encoding="utf-8")
    (tmp_path / ".env").write_text(
        "NODE_EXTRA_CA_CERTS=sds.crt\n",
        encoding="utf-8",
    )
    context = FakeSSLContext()

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setattr("llm_router.http_client.truststore.SSLContext", lambda _: context)

    previous = os.environ.pop("NODE_EXTRA_CA_CERTS", None)
    try:
        assert create_ssl_context() is context
        assert context.loaded == [certifi.where(), str(extra_ca.resolve())]
        assert os.environ["NODE_EXTRA_CA_CERTS"] == str(extra_ca.resolve())
    finally:
        if previous is None:
            os.environ.pop("NODE_EXTRA_CA_CERTS", None)
        else:
            os.environ["NODE_EXTRA_CA_CERTS"] = previous


def test_ssl_cert_file_remains_the_base_and_node_ca_is_added(tmp_path, monkeypatch):
    base_ca = tmp_path / "base.pem"
    extra_ca = tmp_path / "company.pem"
    extra_ca.write_text(PEM_MARKER, encoding="utf-8")
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
        "llm_router.http_client.truststore.SSLContext",
        lambda protocol: fake_create_default_context(protocol=protocol),
    )

    assert create_ssl_context() is context
    assert created == {"protocol": ssl.PROTOCOL_TLS_CLIENT}
    assert context.loaded == [certifi.where()]


def test_invalid_node_extra_ca_has_actionable_error(tmp_path, monkeypatch):
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(tmp_path / "missing.pem"))

    with pytest.raises(RouterError) as error:
        create_ssl_context()

    assert error.value.code == "tls_ca_bundle_invalid"
    assert "NODE_EXTRA_CA_CERTS" in error.value.message
    assert "DER-encoded X.509" in error.value.message


def test_binary_der_crt_is_automatically_converted_for_python_and_node(tmp_path, monkeypatch):
    certificate = tmp_path / "sds.crt"
    certifi_bundle = Path(certifi.where()).read_text(encoding="ascii")
    first_pem = (
        "-----BEGIN CERTIFICATE-----"
        + certifi_bundle.split("-----BEGIN CERTIFICATE-----", 1)[1].split(
            "-----END CERTIFICATE-----", 1
        )[0]
    )
    first_pem += "-----END CERTIFICATE-----\n"
    certificate.write_bytes(ssl.PEM_cert_to_DER_cert(first_pem))
    context = FakeSSLContext()
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(certificate))
    monkeypatch.setattr("llm_router.http_client.tempfile.gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr("llm_router.http_client.truststore.SSLContext", lambda _: context)

    assert create_ssl_context() is context

    converted = Path(os.environ["NODE_EXTRA_CA_CERTS"])
    assert converted != certificate
    assert converted.suffix == ".pem"
    assert converted.read_text(encoding="ascii").startswith("-----BEGIN CERTIFICATE-----")
    assert context.loaded == [certifi.where(), str(converted)]


def test_invalid_binary_crt_has_an_actionable_error(tmp_path, monkeypatch):
    certificate = tmp_path / "sds.crt"
    certificate.write_bytes(b"not-an-x509-certificate")
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)
    monkeypatch.setenv("NODE_EXTRA_CA_CERTS", str(certificate))

    with pytest.raises(RouterError) as error:
        create_ssl_context()

    assert error.value.code == "tls_ca_bundle_invalid"
    assert "neither a PEM bundle nor a DER X.509 certificate" in error.value.message
    assert str(certificate) in error.value.message


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
    assert captured["timeout"] == 30.0
    assert captured["verify"] is ssl_context
    assert set(captured["mounts"]) == {
        "http://127.0.0.1",
        "http://localhost",
        "http://[::1]",
    }


async def test_async_client_bypasses_environment_proxy_for_loopback(monkeypatch):
    async def respond(reader, writer):
        await reader.read(4096)
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
            b'Content-Length: 16\r\nConnection: close\r\n\r\n{"healthy":true}'
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        monkeypatch.setenv(name, "http://127.0.0.1:1")
    for name in ("NO_PROXY", "no_proxy"):
        monkeypatch.delenv(name, raising=False)

    server = await asyncio.start_server(respond, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        async with create_async_client(timeout=2.0) as client:
            response = await client.get(f"http://127.0.0.1:{port}/global/health")
    finally:
        server.close()
        await server.wait_closed()

    assert response.json() == {"healthy": True}
