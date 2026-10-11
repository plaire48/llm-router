import {DriftLabel} from './DriftLabel.jsx';
import React from 'react';
import {TerminalMark} from './marks.jsx';

// The prompt a command reads with in its own shell: PowerShell PS C:\dir>, cmd C:\dir>, the others $.
export function promptFor(profile = '', workspace = '') {
  const id = String(profile).toLowerCase();
  return /powershell|pwsh/.test(id) ? `PS ${workspace}>` : /^cmd/.test(id) ? `${workspace}>` : '$';
}

// A command as it reads in a terminal (user decision 2026-09-30, like Codex): a title bar with the shell and the folder,
// the prompt and the command, and the output below when there is one. The prompt is decoration, not part of the command.
export function TerminalBlock({profile, workspace, command, output, label = '명령', status}) {
  const lines = command ? String(command).split('\n') : [], powershell = /powershell|pwsh/i.test(profile || '');
  return <figure className="nubi-terminal" aria-label={label}>
    <figcaption className="nubi-terminal-bar"><span className="nubi-terminal-dots" aria-hidden="true"><i/><i/><i/></span><span className="nubi-terminal-shell"><TerminalMark size={14}/>{profile}</span>{workspace && <DriftLabel className="nubi-terminal-cwd" title={workspace}>{workspace}</DriftLabel>}{status && <span className="nubi-terminal-status">{status}</span>}</figcaption>
    <pre className="nubi-terminal-body"><code>{lines.map((line, index) => <span key={index} className="nubi-terminal-line"><span className="nubi-terminal-prompt" aria-hidden="true">{index === 0 ? promptFor(profile, workspace) : powershell ? '>>' : '>'}</span> {line}{index < lines.length - 1 ? '\n' : ''}</span>)}</code>{output && <samp className="nubi-terminal-output">{output}</samp>}</pre>
  </figure>;
}
