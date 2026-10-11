import React, {useMemo, useState} from 'react';
import {CxButton, CxInput, Icon} from '@e2e/cx-design-system';
import {DriftLabel} from './DriftLabel.jsx';

function treeOf(items) {
  const root = {folders:new Map(), files:[]};
  for (const item of items) {
    const parts = item.path.split('/');
    let node = root, path = '';
    for (const name of parts.slice(0,-1)) {
      path = path ? `${path}/${name}` : name;
      if (!node.folders.has(name)) node.folders.set(name, {name, path, folders:new Map(), files:[]});
      node = node.folders.get(name);
    }
    node.files.push({...item, name:parts.at(-1)});
  }
  return root;
}
const compare = (a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'});
const fileKind = name => ({js:'JS',mjs:'JS',cjs:'JS',jsx:'JS',ts:'TS',tsx:'TS',json:'{}',md:'MD',py:'PY',css:'CSS'})[name.split('.').at(-1).toLowerCase()];

// The same folder hierarchy serves browsing and commit review. Diff counts are
// supplied only by the commit view, never inferred for ordinary source files.
export function ProjectFileTree({items, selected, onSelect, disabled=false, renderTrailing, label='프로젝트 파일', defaultFilter=''}) {
  const [query, setQuery] = useState(defaultFilter), [collapsed, setCollapsed] = useState(new Set()), [limit, setLimit] = useState(500);
  const matches = useMemo(() => items.filter(item => item.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [items,query]);
  const root = useMemo(() => treeOf(matches.slice(0,limit)), [matches,limit]);
  const toggle = path => setCollapsed(current => {const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next;});
  function children(node) {
    return <ul className="nubi-file-tree-level">
      {[...node.folders.values()].sort((a,b) => compare(a.name,b.name)).map(folder => {
        let group = folder, name = folder.name;
        while (!group.files.length && group.folders.size === 1) {group = [...group.folders.values()][0]; name += `/${group.name}`;}
        const expanded = !collapsed.has(group.path);
        return <li key={folder.path} className="nubi-file-tree-folder"><CxButton className="nubi-file-tree-row" aria-expanded={expanded} aria-label={`${group.path} ${expanded?'접기':'펼치기'}`} onClick={() => toggle(group.path)} disabled={disabled}>
          <Icon name="chevronDown" size={12}/><DriftLabel>{name}</DriftLabel>
        </CxButton>{expanded && children(group)}</li>;
      })}
      {[...node.files].sort((a,b) => compare(a.name,b.name)).map(item => <li key={item.path}><CxButton className="nubi-file-tree-row nubi-file-tree-file" aria-current={selected === item.path ? 'true' : undefined} title={item.path} onClick={() => onSelect(item)} disabled={disabled}>
        {fileKind(item.name) ? <span className="nubi-file-kind" data-kind={fileKind(item.name)} aria-hidden="true">{fileKind(item.name)}</span> : <Icon name="file" size={14}/>}
        <DriftLabel>{item.name}</DriftLabel>{renderTrailing?.(item)}
      </CxButton></li>)}
    </ul>;
  }
  return <section className="nubi-file-tree" aria-label={label}>
    <div className="nubi-file-tree-filter"><Icon name="search" size={14}/><CxInput aria-label="파일 필터링" placeholder="파일 필터링…" value={query} onChange={event => {setQuery(event.target.value); setLimit(500); setCollapsed(new Set());}}/></div>
    <nav className="nubi-file-tree-scroll" aria-label={`${label} 폴더 구조`}>{children(root)}
      {!matches.length && <p className="nubi-file-tree-empty">{query ? '일치하는 파일이 없어요.' : '표시할 파일이 없어요.'}</p>}
      {matches.length > limit && <CxButton className="nubi-file-tree-more" onClick={() => setLimit(value => value + 500)}><Icon name="chevronDown" size={16}/>파일 {Math.min(500,matches.length-limit)}개 더보기</CxButton>}
    </nav>
  </section>;
}
