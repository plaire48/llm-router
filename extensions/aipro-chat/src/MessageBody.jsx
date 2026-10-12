import React,{memo,useMemo,useRef} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, {defaultSchema} from 'rehype-sanitize';
import {CodeBlock} from './CodeBlock.jsx';

const markdownComponents = {
  pre: CodeBlock,
  a: ({href, children}) => /^https?:\/\//i.test(href || '') ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  img: ({alt}) => alt ? <span>{alt}</span> : null,
  table: ({children}) => <div className="aipro-table"><table>{children}</table></div>,
};
// HTML that a model writes (a table, line breaks, a folded section) is shown with
// its format, not dropped: it used to be skipped, and a table written in HTML
// vanished from the answer. It is parsed, then only these elements and
// attributes pass. This page holds extension privileges, so no script, style,
// event handler, form, frame or id survives; links are http(s) or mail only and
// images show their alt text, as for markdown.
const htmlSchema = {...defaultSchema,
  tagNames: ['p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup', 'small', 'code', 'kbd', 'pre', 'blockquote', 'ul', 'ol', 'li',
    'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'details', 'summary', 'span', 'div', 'a', 'img', 'input'],
  attributes: {a: ['href', 'title'], img: ['alt'], th: ['colSpan', 'rowSpan', 'align', 'scope'], td: ['colSpan', 'rowSpan', 'align'], ol: ['start', 'reversed'], li: ['value'],
    details: ['open'], code: [['className', /^language-[\w-]+$/]], input: [['type', 'checkbox'], ['disabled', true], 'checked']},
  protocols: {href: ['http', 'https', 'mailto']},
  strip: ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'form', 'select', 'textarea', 'button'],
  clobberPrefix: 'user-content-', clobber: ['name', 'id']};
const htmlPlugins = [rehypeRaw, [rehypeSanitize, htmlSchema]];
export const MessageBody=memo(function MessageBody({content, role, compact = false, sourceReferences = [], onSource}) {
  const sources=useRef(null),open=useRef(onSource);sources.current=new Map(sourceReferences.map(source=>[source.href,source]));open.current=onSource;
  const interactive=!!onSource;
  const components=useMemo(()=>interactive?{...markdownComponents,a:({href,children})=>{
    if(href?.startsWith('#nubi-cite-')) {
      const source=sources.current.get(href);
      return source?<button type="button" className="nubi-inline-citation" title={source.filename||source.title} aria-label={`출처 ${source.number}: ${source.filename||source.title}`} onClick={()=>open.current?.(source)}>{source.number}</button>:null;
    }
    return markdownComponents.a({href,children});
  }}:markdownComponents,[interactive]);
  const sourceKey=JSON.stringify(sourceReferences);
  return useMemo(()=>role === 'user' ? <div className="message-body user-text">{content}</div> : <div className={`message-body${compact ? ' progress-markdown' : ''}`}><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={htmlPlugins} components={components}>{content}</Markdown></div>,[content,role,compact,components,sourceKey]);
});
export function InlineMarkdown({content}) {
  return <span className="message-body progress-inline"><Markdown remarkPlugins={[remarkGfm]} skipHtml unwrapDisallowed allowedElements={['strong', 'em', 'del', 'code', 'a', 'br']} components={markdownComponents}>{content}</Markdown></span>;
}
