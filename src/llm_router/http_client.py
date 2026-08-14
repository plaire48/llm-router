from __future__ import annotations

import os
import ssl
from pathlib import Path

import certifi
import httpx
from dotenv import load_dotenv

from llm_router.errors import RouterError


def resolve_environment_path(name: str, *, base_dir: Path | None = None) -> str | None:
    """Resolve a configured file path before child processes change directory."""
    value = os.environ.get(name, "").strip()
    if not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = (base_dir or Path.cwd()) / path
    return str(path.resolve(strict=False))


def _tls_configuration_error(
    variable: str,
    exc: BaseException,
    *,
    configured_path: str | None = None,
) -> RouterError:
    hint = ""
    if variable in {"CODEX_CA_CERTIFICATE", "NODE_EXTRA_CA_CERTS"}:
        hint = (
            f" Configured path: {configured_path}. The file must contain PEM certificates "
            "with -----BEGIN CERTIFICATE-----. Convert a binary CRT with "
            "'certutil -encode sds.crt sds.pem' if necessary."
        )
    return RouterError(
        f"Could not load the TLS CA certificates configured by {variable}: {exc}.{hint}",
        type="configuration_error",
        code="tls_ca_bundle_invalid",
        status_code=500,
    )


def _validate_extra_ca_file(variable: str, configured_path: str) -> None:
    try:
        payload = Path(configured_path).read_bytes()
    except OSError as exc:
        raise _tls_configuration_error(
            variable,
            exc,
            configured_path=configured_path,
        ) from exc
    if b"-----BEGIN CERTIFICATE-----" not in payload:
        raise _tls_configuration_error(
            variable,
            ValueError("the certificate file is not PEM encoded"),
            configured_path=configured_path,
        )


def create_ssl_context() -> ssl.SSLContext:
    """Build the shared TLS trust store, including configured corporate CAs."""
    dotenv_path = Path.cwd() / ".env"
    load_dotenv(dotenv_path=dotenv_path, override=False)
    ssl_cert_file = resolve_environment_path("SSL_CERT_FILE", base_dir=dotenv_path.parent)
    ssl_cert_dir = resolve_environment_path("SSL_CERT_DIR", base_dir=dotenv_path.parent)

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
        if (path := resolve_environment_path(name, base_dir=dotenv_path.parent))
    ]
    loaded: set[str] = set()
    for variable, extra_ca_file in extra_ca_files:
        if extra_ca_file == ssl_cert_file or extra_ca_file in loaded:
            continue
        _validate_extra_ca_file(variable, extra_ca_file)
        try:
            context.load_verify_locations(cafile=extra_ca_file)
        except (OSError, ssl.SSLError) as exc:
            raise _tls_configuration_error(
                variable,
                exc,
                configured_path=extra_ca_file,
            ) from exc
        # Corporate bundles sometimes contain the issuing intermediate rather
        # than a self-signed root. Treat only the explicitly configured bundle
        # as a valid trust-chain endpoint while keeping certificate and hostname
        # verification enabled.
        if hasattr(ssl, "VERIFY_X509_PARTIAL_CHAIN"):
            context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
        # OpenCode changes its working directory before starting. Preserve the
        # already-resolved CA location so Node/Bun reads the same certificate.
        os.environ[variable] = extra_ca_file
        loaded.add(extra_ca_file)
    return context


def create_async_client(*, timeout: httpx.Timeout | float) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout, verify=create_ssl_context())
