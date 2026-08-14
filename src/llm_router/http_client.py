from __future__ import annotations

import os
import ssl
from pathlib import Path

import certifi
import httpx
from dotenv import load_dotenv

from llm_router.errors import RouterError


def _environment_path(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return str(Path(value).expanduser()) if value else None


def _tls_configuration_error(variable: str, exc: BaseException) -> RouterError:
    return RouterError(
        f"Could not load the TLS CA certificates configured by {variable}: {exc}",
        type="configuration_error",
        code="tls_ca_bundle_invalid",
        status_code=500,
    )


def create_ssl_context() -> ssl.SSLContext:
    """Build the shared TLS trust store, including configured corporate CAs."""
    load_dotenv(dotenv_path=Path.cwd() / ".env", override=False)
    ssl_cert_file = _environment_path("SSL_CERT_FILE")
    ssl_cert_dir = _environment_path("SSL_CERT_DIR")

    try:
        if ssl_cert_file:
            context = ssl.create_default_context(cafile=ssl_cert_file)
        elif ssl_cert_dir:
            context = ssl.create_default_context(capath=ssl_cert_dir)
        else:
            # Keep the operating system trust store so corporate roots installed in
            # Windows Certificate Manager remain available. Add certifi as a
            # supplement for public roots instead of replacing the system store.
            context = ssl.create_default_context()
            context.load_verify_locations(cafile=certifi.where())
    except (OSError, ssl.SSLError) as exc:
        variable = (
            "SSL_CERT_FILE" if ssl_cert_file else "SSL_CERT_DIR" if ssl_cert_dir else "certifi"
        )
        raise _tls_configuration_error(variable, exc) from exc

    extra_ca_files = [
        (name, path)
        for name in ("CODEX_CA_CERTIFICATE", "NODE_EXTRA_CA_CERTS")
        if (path := _environment_path(name))
    ]
    loaded: set[str] = set()
    for variable, extra_ca_file in extra_ca_files:
        if extra_ca_file == ssl_cert_file or extra_ca_file in loaded:
            continue
        try:
            context.load_verify_locations(cafile=extra_ca_file)
        except (OSError, ssl.SSLError) as exc:
            raise _tls_configuration_error(variable, exc) from exc
        loaded.add(extra_ca_file)
    return context


def create_async_client(*, timeout: httpx.Timeout | float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, verify=create_ssl_context())
