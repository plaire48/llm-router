import hashlib
import io
import tarfile
import zipfile

import pytest
from opencode_build import (
    OpenCodeAsset,
    asset_for_build_target,
    asset_for_platform,
    extract_binary,
)


def _asset(filename: str, executable: str = "opencode") -> OpenCodeAsset:
    return OpenCodeAsset(filename, "unused", "test_platform", executable)


def test_asset_selection_uses_baseline_x64_and_native_arm64():
    assert asset_for_platform(system="Darwin", machine="arm64").filename == (
        "opencode-darwin-arm64.zip"
    )
    assert asset_for_platform(system="Windows", machine="AMD64").filename == (
        "opencode-windows-x64-baseline.zip"
    )
    assert asset_for_platform(system="Linux", machine="x86_64", musl=True).filename == (
        "opencode-linux-x64-baseline-musl.tar.gz"
    )


def test_asset_selection_rejects_unsupported_platform():
    with pytest.raises(RuntimeError, match="unsupported"):
        asset_for_platform(system="Plan9", machine="mips")


def test_explicit_windows_x64_build_target_selects_the_windows_wheel_asset():
    asset = asset_for_build_target("windows-x64")

    assert asset.filename == "opencode-windows-x64-baseline.zip"
    assert asset.wheel_platform == "win_amd64"
    assert asset.executable == "opencode.exe"


def test_build_target_can_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("LLM_ROUTER_BUILD_TARGET", "windows-x64")

    assert asset_for_build_target().wheel_platform == "win_amd64"


def test_build_target_rejects_unknown_values():
    with pytest.raises(RuntimeError, match="Unsupported LLM_ROUTER_BUILD_TARGET"):
        asset_for_build_target("windows-itanium")


def test_extract_binary_from_zip(tmp_path):
    archive = tmp_path / "opencode-test.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("nested/opencode", b"zip-binary")
    destination = tmp_path / "opencode"

    digest = extract_binary(archive, _asset(archive.name), destination)

    assert destination.read_bytes() == b"zip-binary"
    assert digest == hashlib.sha256(b"zip-binary").hexdigest()
    assert destination.stat().st_mode & 0o111


def test_extract_binary_from_tar_gz(tmp_path):
    archive = tmp_path / "opencode-test.tar.gz"
    payload = b"tar-binary"
    with tarfile.open(archive, "w:gz") as bundle:
        info = tarfile.TarInfo("opencode")
        info.size = len(payload)
        bundle.addfile(info, io.BytesIO(payload))
    destination = tmp_path / "opencode"

    extract_binary(archive, _asset(archive.name), destination)

    assert destination.read_bytes() == payload
