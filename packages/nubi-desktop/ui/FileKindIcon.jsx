import React from 'react';
import {Icon} from '@e2e/cx-design-system';
import {FolderMark} from './marks.jsx';

export function FileKindIcon({name,directory=false}) {
 const extension=name.split('.').at(-1).toLowerCase();
 const badge=({js:'JS',jsx:'JS',mjs:'JS',cjs:'JS',ts:'TS',tsx:'TS',json:'{}',jsonc:'{}',md:'MD',py:'PY'})[extension];
 const kind=/^(js|jsx|mjs|cjs|ts|tsx|py|cs|cpp|c|h|java|go|rs|php|rb|sh|ps1|bat|cmd|html|css|scss|sql)$/.test(extension)?'code':/^(png|jpg|jpeg|gif|webp|svg|ico)$/.test(extension)?'image':/^(csv|xlsx|xls)$/.test(extension)?'table':'file';
 return <span className="desktop-file-icon" data-kind={kind} aria-hidden="true">{directory?<FolderMark size={16}/>:badge?<span className="nubi-file-kind" data-kind={badge}>{badge}</span>:<Icon name={kind} size={16}/>}</span>;
}
