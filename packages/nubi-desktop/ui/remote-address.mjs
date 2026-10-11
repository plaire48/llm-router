// A Git remote the host may clone: https://host/path, ssh://host/path or user@host:path.
// An address that carries a password is refused. The VS Code host checks the same rule
// (packages/nubi-vscode/src/host.cjs); tests keep the two in step.
export const remoteAddress = text => {
  const value = String(text || '').trim();
  if (!value || value.length > 2000 || /\s/.test(value)) return false;
  if (/^[\w.-]+@[\w.-]+:[^:\s][^\s]*$/.test(value)) return true;
  try { const url = new URL(value); return ['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) && Boolean(url.hostname) && !url.password; }
  catch { return false; }
};
