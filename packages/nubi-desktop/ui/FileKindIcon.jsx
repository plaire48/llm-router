import React from 'react';
import {Icon} from '@e2e/cx-design-system';
import {FolderMark} from './marks.jsx';

export function FileKindIcon({name='',directory=false,size=16}) {
 const extension=String(name||'').split('.').at(-1).toLowerCase();
 const badge=({js:'JS',jsx:'JS',mjs:'JS',cjs:'JS',ts:'TS',tsx:'TS',json:'{}',jsonc:'{}',md:'MD',py:'PY',pdf:'PDF'})[extension];
 const kind=directory?'folder':extension==='pdf'?'pdf':/^(docx?|docm|dotx?|odt|rtf|hwp|hwpx|txt)$/.test(extension)?'document':/^(csv|tsv|xlsx?|xlsm|xlsb|ods)$/.test(extension)?'table':/^(pptx?|pptm|ppsx?|odp)$/.test(extension)?'presentation':/^(zip|7z|rar|tar|gz|tgz|bz2|xz)$/.test(extension)?'archive':/^(png|jpe?g|gif|webp|svg|ico|bmp|tiff?|heic|avif)$/.test(extension)?'image':/^(mp4|mov|avi|mkv|webm|m4v)$/.test(extension)?'video':/^(mp3|wav|m4a|aac|flac|ogg)$/.test(extension)?'audio':/^(js|jsx|mjs|cjs|ts|tsx|py|cs|cpp|c|h|java|go|rs|php|rb|sh|ps1|bat|cmd|html|css|scss|sql)$/.test(extension)?'code':'file';
 const icon=({document:'report',archive:'package',audio:'play',pdf:'file'})[kind]||kind;
 return <span className="desktop-file-icon" data-kind={kind} aria-hidden="true">{directory?<FolderMark size={size}/>:badge?<span className="nubi-file-kind" data-kind={badge}>{badge}</span>:<Icon name={icon} size={size}/>}</span>;
}
