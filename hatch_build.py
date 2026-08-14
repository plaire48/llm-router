from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface

_HELPER_PATH = Path(__file__).with_name("opencode_build.py")
_HELPER_SPEC = importlib.util.spec_from_file_location("llm_router_opencode_build", _HELPER_PATH)
if _HELPER_SPEC is None or _HELPER_SPEC.loader is None:
    raise RuntimeError(f"Could not load OpenCode build helper from {_HELPER_PATH}")
_HELPER = importlib.util.module_from_spec(_HELPER_SPEC)
sys.modules[_HELPER_SPEC.name] = _HELPER
_HELPER_SPEC.loader.exec_module(_HELPER)


class CustomBuildHook(BuildHookInterface):
    def initialize(self, version: str, build_data: dict) -> None:
        if version == "editable":
            return

        asset = _HELPER.asset_for_build_target()
        temporary = Path(tempfile.mkdtemp(prefix="llm-router-opencode-build-"))
        self._temporary = temporary
        try:
            executable, metadata = _HELPER.prepare_bundle(temporary, asset)
        except Exception:
            shutil.rmtree(temporary, ignore_errors=True)
            raise
        destination = "llm_router/_vendor/opencode"
        build_data["force_include"][str(executable)] = f"{destination}/{asset.executable}"
        build_data["force_include"][str(metadata)] = f"{destination}/bundle.json"
        build_data["pure_python"] = False
        build_data["tag"] = f"py3-none-{asset.wheel_platform}"

    def finalize(self, version: str, build_data: dict, artifact_path: str) -> None:
        temporary = getattr(self, "_temporary", None)
        if temporary is not None:
            shutil.rmtree(temporary, ignore_errors=True)
