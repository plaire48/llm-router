# Nubi VS Code host

- This is an explicitly authorized adapter for `../nubi-desktop`, not a second agent implementation. Reuse its Workbench, runtime, OpenWiki-SDS, skill tools and approval flows.
- Support trusted local file workspaces. Refuse remote/virtual roots and do not interpret WSL/SSH paths as local Windows paths. Ask the user to choose one folder in multi-root workspaces.
- Run the shared runtime in the bundled checksum-verified Node sidecar. Never use the workspace's Node executable, settings or startup hooks. Keep provider credentials in sidecar memory and state in VS Code global storage.
- All webview RPCs pass the host allowlist and trust check. Native file pickers alone supply external file paths. Preserve dirty editor buffers, version/hash checks, VS Code undo and post-save readback. Never replay an uncertain edit or process request.
- Keep the supplied HTML identity and concise Korean copy. Reuse Desktop's design checks and public CX components. A2A remains deferred.
- Distinguish contract tests, actual VS Code extension-host/editor checks, webview UI, target-platform packaging, Windows GUI and real provider tests. Do not describe a development extension or a macOS VSIX as a verified Windows release.

- Readability and meaning take precedence over reducing character count. Lead with the key sentence and retain its decision-relevant details. Use bold for a few important phrases, deep brand blue for the leading conclusion, and text/icon labels alongside status colors. Prefer verified result images and unambiguous named icon actions; never remove approval scope or recovery instructions.
