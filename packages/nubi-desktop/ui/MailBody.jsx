import React from 'react';
import {Icon} from '@e2e/cx-design-system';
import {MailMatchText} from './MailMatchText.jsx';
import {mailBodyParts} from '../runtime/mail-preview.mjs';

// Render text and explicit HTTP links only. Never render mail HTML or load images.
export function MailBody({text,query}) {
 return <div className="nubi-mail-reader-text">{mailBodyParts(text).map((part,index)=>part.href?
  <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" title={part.href}><MailMatchText text={part.label} query={query}/><Icon name="link" size={14}/></a>:
  <MailMatchText key={index} text={part.text} query={query}/>)}</div>;
}
