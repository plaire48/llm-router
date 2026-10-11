import React from 'react';
import {sessionDate} from './session-navigation.mjs';
export function ConversationTime({task}) {
  const date = sessionDate(task);
  return date ? <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(date)}</time> : null;
}
