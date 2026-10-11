import React from 'react';
import {ActionButton} from '@e2e/cx-design-system';

const names={add:'추가',read:'열기',edit:'수정',delete:'삭제',refresh:'새로고침',copy:'복사',save:'저장',login:'연결',logout:'로그아웃',download:'다운로드',help:'정보',more:'더보기',clearSearch:'해제',back:'돌아가기',undo:'복원',openExternal:'열기',cancel:'취소',search:'검색'};
const familiar=new Set(['copy','refresh','delete','edit','search','clearSearch','back','more','help','close','previousMedia','nextMedia','download']);
// Familiar utility icons need a tooltip, while ambiguous and committing actions keep their names.
export function WorkspaceAction({action,label,title,visibleLabel,iconOnly,className='',...props}){
 const compact=iconOnly??(!visibleLabel&&familiar.has(action));
 return <ActionButton {...props} action={action} label={visibleLabel||names[action]||label} aria-label={props['aria-label']||label} title={title||label} iconOnly={compact} className={`${compact?'nubi-utility-action':'nubi-labelled-action'} ${className}`.trim()}/>;
}
