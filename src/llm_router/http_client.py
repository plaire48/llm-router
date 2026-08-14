from __future__ import annotations

import hashlib
import os
import ssl
import stat
import tempfile
from pathlib import Path

import certifi
import httpx
import truststore
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
            f" Configured path: {configured_path}. A .crt file may contain either a PEM "
            "certificate bundle or one DER-encoded X.509 certificate."
        )
    return RouterError(
        f"Could not load the TLS CA certificates configured by {variable}: {exc}.{hint}",
        type="configuration_error",
        code="tls_ca_bundle_invalid",
        status_code=500,
    )


def _cached_pem_path(payload: bytes) -> Path:
    digest = hashlib.sha256(payload).hexdigest()
    return Path(tempfile.gettempdir()) / "llm-router" / "ca-certificates" / f"{digest}.pem"


def _write_cached_pem(payload: bytes, pem: str) -> str:
    destination = _cached_pem_path(payload)
    if destination.is_file():
        return str(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
    )
    temporary = Path(temporary_name)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(descriptor, "w", encoding="ascii", newline="\n") as handle:
            handle.write(pem)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    except Exception:
        try:
            os.close(descriptor)
        except OSError:
            pass
        temporary.unlink(missing_ok=True)
        raise
    return str(destination)


def prepare_extra_ca_file(variable: str, configured_path: str) -> str:
    """Return a PEM CA path, converting a binary DER CRT into a private cache."""
    try:
        payload = Path(configured_path).read_bytes()
    except OSError as exc:
        raise _tls_configuration_error(
            variable,
            exc,
            configured_path=configured_path,
        ) from exc
    if b"-----BEGIN CERTIFICATE-----" in payload:
        return configured_path
    try:
        pem = ssl.DER_cert_to_PEM_cert(payload)
        validation_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        validation_context.load_verify_locations(cadata=pem)
        return _write_cached_pem(payload, pem)
    except (OSError, ValueError, ssl.SSLError) as exc:
        raise _tls_configuration_error(
            variable,
            ValueError("the file is neither a PEM bundle nor a DER X.509 certificate"),
            configured_path=configured_path,
        ) from exc


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
            # Use the platform-native verifier. On Windows this delegates chain
            # building to CryptoAPI, so enterprise roots and intermediates from the
            # Windows certificate stores behave the same way as browsers and the
            # bundled OpenCode runtime. Add certifi as a supplement for public roots.
            context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
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
        effective_ca_file = prepare_extra_ca_file(variable, extra_ca_file)
        # OpenCode changes its working directory before starting and Node/Bun
        # only accepts PEM through NODE_EXTRA_CA_CERTS. Preserve the resolved
        # original path or the automatically converted DER cache path.
        os.environ[variable] = effective_ca_file
        if effective_ca_file == ssl_cert_file or effective_ca_file in loaded:
            continue
        try:
            context.load_verify_locations(cafile=effective_ca_file)
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
        loaded.add(effective_ca_file)
    return context


def create_async_client(*, timeout: httpx.Timeout | float) -> httpx.AsyncClient:
    # Corporate HTTP_PROXY/ALL_PROXY settings must never intercept the
    # router-managed OpenCode health and inference requests on loopback.
    # Explicit mounts override environment proxy mounts for these hosts while
    # preserving normal proxy behavior for external upstream requests.
    loopback_mounts = {
        "http://127.0.0.1": httpx.AsyncHTTPTransport(),
        "http://localhost": httpx.AsyncHTTPTransport(),
        "http://[::1]": httpx.AsyncHTTPTransport(),
    }
    return httpx.AsyncClient(
        timeout=timeout,
        verify=create_ssl_context(),
        mounts=loopback_mounts,
    )
