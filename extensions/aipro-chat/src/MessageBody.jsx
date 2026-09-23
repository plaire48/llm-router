import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {CodeBlock} from './CodeBlock.jsx';

const markdownComponents = {
  pre: CodeBlock,
  a: ({href, children}) => /^https?:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  img: ({alt}) => alt ? <span>{alt}</span> : null,
  table: ({children}) => <div className="aipro-table"><table>{children}</table></div>,
};
export function MessageBody({content, role, compact = false}) {
  return role === 'user' ? <div className="message-body user-text">{content}</div> : <div className={`message-body${compact ? ' progress-markdown' : ''}`}><Markdown remarkPlugins={[remarkGfm]} skipHtml components={markdownComponents}>{content}</Markdown></div>;
}
export function InlineMarkdown({content}) {
  return <span className="message-body progress-inline"><Markdown remarkPlugins={[remarkGfm]} skipHtml unwrapDisallowed allowedElements={['strong', 'em', 'del', 'code', 'a', 'br']} components={markdownComponents}>{content}</Markdown></span>;
}
