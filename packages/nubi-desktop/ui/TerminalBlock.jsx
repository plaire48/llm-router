import {DriftLabel} from './DriftLabel.jsx';
import React from 'react';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {TerminalMark} from './marks.jsx';

// The prompt a command reads with in its own shell: PowerShell PS C:\dir>, cmd C:\dir>, the others $.
export function promptFor(profile = '', workspace = '') {
  const id = String(profile).toLowerCase();
  return /powershell|pwsh/.test(id) ? `PS ${workspace}>` : /^cmd/.test(id) ? `${workspace}>` : '$';
}

// A command as it reads in a terminal (user decision 2026-09-30, like Codex): a title bar with the shell and the folder,
// the prompt and the command, and the output below when there is one. The prompt is decoration, not part of the command.
export function TerminalBlock({profile, workspace, command, output, label = '명령', status, copyOutput = true}) {
  const lines = command ? String(command).split('\n') : [], powershell = /powershell|pwsh/i.test(profile || '');
  return <figure className="nubi-terminal" aria-label={label}>
    <figcaption className="nubi-terminal-bar"><span className="nubi-terminal-shell"><TerminalMark size={14}/>{profile}</span>{workspace && <DriftLabel className="nubi-terminal-cwd" title={workspace}>{workspace}</DriftLabel>}{status && <span className="nubi-terminal-status">{status}</span>}</figcaption>
    <div className="nubi-terminal-body">
      {command&&<div className="nubi-terminal-section" data-terminal-part="command"><pre><code>{lines.map((line,index)=><span key={index} className="nubi-terminal-line"><span className="nubi-terminal-prompt" aria-hidden="true">{index===0?promptFor(profile,workspace):powershell?'>>':'>'}</span> {line}{index<lines.length-1?'\n':''}</span>)}</code></pre><div className="nubi-terminal-copy"><CopyButton text={String(command)} label="명령어 복사" successMessage="명령어를 복사했습니다."/></div></div>}
      {output&&<div className="nubi-terminal-section" data-terminal-part="output"><pre><samp className="nubi-terminal-output">{output}</samp></pre>{copyOutput&&<div className="nubi-terminal-copy"><CopyButton text={String(output)} label="실행 결과 복사" successMessage="실행 결과를 복사했습니다."/></div>}</div>}
    </div>
  </figure>;
}
