from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import ssl
import stat
import tarfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import certifi

OPENCODE_VERSION = "1.18.18"
RELEASE_BASE_URL = f"https://github.com/anomalyco/opencode/releases/download/v{OPENCODE_VERSION}"


@dataclass(frozen=True, slots=True)
class OpenCodeAsset:
    filename: str
    archive_sha256: str
    wheel_platform: str
    executable: str

    @property
    def url(self) -> str:
        return f"{RELEASE_BASE_URL}/{self.filename}"


_ASSETS: dict[tuple[str, str, bool], OpenCodeAsset] = {
    ("darwin", "arm64", False): OpenCodeAsset(
        "opencode-darwin-arm64.zip",
        "7d668bf26496fec8686d4e51ebb1ac2bd2e393f0c1620aa696c4c242a9e5806a",
        "macosx_11_0_arm64",
        "opencode",
    ),
    ("darwin", "x64", False): OpenCodeAsset(
        "opencode-darwin-x64-baseline.zip",
        "c029941795f9cf55cfdbc5b0e105db4300413718d489e8e47c950d1a2e126eed",
        "macosx_11_0_x86_64",
        "opencode",
    ),
    ("linux", "arm64", False): OpenCodeAsset(
        "opencode-linux-arm64.tar.gz",
        "dcb1b5ec5687b43f87749560021f9203f3809e0ce5ae44ff9be8ae17083fe4ba",
        "linux_aarch64",
        "opencode",
    ),
    ("linux", "arm64", True): OpenCodeAsset(
        "opencode-linux-arm64-musl.tar.gz",
        "38a7504dab35007c70d2cdf89870b4be63faa60667318a90338798d34f53eab1",
        "linux_aarch64",
        "opencode",
    ),
    ("linux", "x64", False): OpenCodeAsset(
        "opencode-linux-x64-baseline.tar.gz",
        "05914655854c1dab48f0d52a8af8f74967e4e26daf87dfe6534f57e799a853d7",
        "linux_x86_64",
        "opencode",
    ),
    ("linux", "x64", True): OpenCodeAsset(
        "opencode-linux-x64-baseline-musl.tar.gz",
        "f5fe814ac3f94daa4374b7e882b9f0dabe492f63e6b3bbbe7d1e23c95c149a2b",
        "linux_x86_64",
        "opencode",
    ),
    ("windows", "arm64", False): OpenCodeAsset(
        "opencode-windows-arm64.zip",
        "0d34d837ea3b5e10349d8550318083040a8b4c061d3faaa4eabd339984aa49b0",
        "win_arm64",
        "opencode.exe",
    ),
    ("windows", "x64", False): OpenCodeAsset(
        "opencode-windows-x64-baseline.zip",
        "66ad3d31bdc48d7cf16e212da21449bdfe34656cf83a56f682a211c8b78d30ba",
        "win_amd64",
        "opencode.exe",
    ),
}

_BUILD_TARGETS: dict[str, tuple[str, str, bool]] = {
    "macos-arm64": ("darwin", "arm64", False),
    "macos-x64": ("darwin", "x64", False),
    "linux-arm64": ("linux", "arm64", False),
    "linux-x64": ("linux", "x64", False),
    "linux-musl-arm64": ("linux", "arm64", True),
    "linux-musl-x64": ("linux", "x64", True),
    "windows-arm64": ("windows", "arm64", False),
    "windows-x64": ("windows", "x64", False),
}


def _normalized_machine(machine: str) -> str:
    normalized = machine.strip().lower()
    if normalized in {"amd64", "x86_64"}:
        return "x64"
    if normalized in {"aarch64", "arm64"}:
        return "arm64"
    return normalized


def _uses_musl() -> bool:
    libc_name, _ = platform.libc_ver()
    return libc_name.lower() == "musl" or Path("/etc/alpine-release").is_file()


def asset_for_platform(
    *,
    system: str | None = None,
    machine: str | None = None,
    musl: bool | None = None,
) -> OpenCodeAsset:
    normalized_system = (system or platform.system()).strip().lower()
    normalized_machine = _normalized_machine(machine or platform.machine())
    uses_musl = (
        (musl if musl is not None else _uses_musl()) if normalized_system == "linux" else False
    )
    try:
        return _ASSETS[(normalized_system, normalized_machine, uses_musl)]
    except KeyError as exc:
        raise RuntimeError(
            "OpenCode bundling is unsupported for "
            f"{normalized_system}/{normalized_machine}{'/musl' if uses_musl else ''}"
        ) from exc


def asset_for_build_target(target: str | None = None) -> OpenCodeAsset:
    """Select a release asset explicitly for cross-platform wheel packaging."""
    selected = (target or os.environ.get("LLM_ROUTER_BUILD_TARGET", "")).strip().lower()
    if not selected:
        return asset_for_platform()
    try:
        system, machine, musl = _BUILD_TARGETS[selected]
    except KeyError as exc:
        supported = ", ".join(sorted(_BUILD_TARGETS))
        raise RuntimeError(
            f"Unsupported LLM_ROUTER_BUILD_TARGET '{selected}'. Supported: {supported}"
        ) from exc
    return asset_for_platform(system=system, machine=machine, musl=musl)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_ssl_context() -> ssl.SSLContext:
    configured = os.environ.get("SSL_CERT_FILE", "").strip()
    context = ssl.create_default_context(cafile=configured or certifi.where())
    loaded: set[Path] = set()
    for name in ("CODEX_CA_CERTIFICATE", "NODE_EXTRA_CA_CERTS"):
        value = os.environ.get(name, "").strip()
        if not value:
            continue
        path = Path(value).expanduser().resolve()
        if path in loaded or str(path) == configured:
            continue
        context.load_verify_locations(cafile=path)
        loaded.add(path)
    return context


def download_asset(asset: OpenCodeAsset, destination: Path) -> None:
    request = urllib.request.Request(
        asset.url,
        headers={"User-Agent": f"llm-router-build/{OPENCODE_VERSION}"},
    )
    with (
        urllib.request.urlopen(
            request,
            timeout=120,
            context=_download_ssl_context(),
        ) as response,
        destination.open("wb") as handle,
    ):
        shutil.copyfileobj(response, handle)
    actual = _sha256(destination)
    if actual != asset.archive_sha256:
        destination.unlink(missing_ok=True)
        raise RuntimeError(
            f"OpenCode archive checksum mismatch for {asset.filename}: "
            f"expected {asset.archive_sha256}, got {actual}"
        )


def _zip_binary(archive: Path, executable: str) -> bytes:
    with zipfile.ZipFile(archive) as bundle:
        candidates = [
            item
            for item in bundle.infolist()
            if not item.is_dir() and PurePosixPath(item.filename).name == executable
        ]
        if len(candidates) != 1:
            raise RuntimeError(f"Expected one {executable} in {archive.name}")
        return bundle.read(candidates[0])


def _tar_binary(archive: Path, executable: str) -> bytes:
    with tarfile.open(archive, "r:gz") as bundle:
        candidates = [
            item
            for item in bundle.getmembers()
            if item.isfile() and PurePosixPath(item.name).name == executable
        ]
        if len(candidates) != 1:
            raise RuntimeError(f"Expected one {executable} in {archive.name}")
        source = bundle.extractfile(candidates[0])
        if source is None:
            raise RuntimeError(f"Could not read {executable} from {archive.name}")
        return source.read()


def extract_binary(archive: Path, asset: OpenCodeAsset, destination: Path) -> str:
    if asset.filename.endswith(".zip"):
        payload = _zip_binary(archive, asset.executable)
    elif asset.filename.endswith(".tar.gz"):
        payload = _tar_binary(archive, asset.executable)
    else:
        raise RuntimeError(f"Unsupported OpenCode archive: {asset.filename}")

    destination.write_bytes(payload)
    if asset.executable != "opencode.exe":
        destination.chmod(
            stat.S_IRUSR
            | stat.S_IWUSR
            | stat.S_IXUSR
            | stat.S_IRGRP
            | stat.S_IXGRP
            | stat.S_IROTH
            | stat.S_IXOTH
        )
    return _sha256(destination)


def prepare_bundle(directory: Path, asset: OpenCodeAsset | None = None) -> tuple[Path, Path]:
    selected = asset or asset_for_platform()
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / selected.filename
    executable = directory / selected.executable
    metadata = directory / "bundle.json"
    download_asset(selected, archive)
    binary_sha256 = extract_binary(archive, selected, executable)
    archive.unlink()
    metadata.write_text(
        json.dumps(
            {
                "version": OPENCODE_VERSION,
                "source": selected.url,
                "archive_sha256": selected.archive_sha256,
                "binary_sha256": binary_sha256,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return executable, metadata


if __name__ == "__main__":
    target = Path(os.environ.get("LLM_ROUTER_OPENCODE_BUNDLE_DIR", "dist/opencode-bundle"))
    binary, manifest = prepare_bundle(target)
    print(binary)
    print(manifest)
