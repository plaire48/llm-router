import React from 'react';
export function MessageTimestamp({at,role='user'}){
  if(!at||!Number.isFinite(Date.parse(at)))return null;
  const date=new Date(at),full=date.toLocaleString();
  return <time className="nubi-message-timestamp" dateTime={date.toISOString()} title={full} aria-label={`${role==='user'?'보낸':'받은'} 시각 ${full}`}>{date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time>;
}
