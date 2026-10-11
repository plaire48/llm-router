import React, {useMemo} from 'react';
import {CopyButton} from './CopyButton.jsx';
import {highlightCode} from './code-highlight.js';
import './code.css';

export function CodeBlock({children, showToolbar = true}) {
  const code = React.Children.toArray(children).find(React.isValidElement);
  const language = /language-([^\s]+)/.exec(code?.props.className || '')?.[1] || '';
  const text = String(code?.props.children || '').replace(/\n$/, '');
  const highlighted = useMemo(() => highlightCode(text, language), [text, language]);
  return <div className="code-block">
    {showToolbar && <div className="code-toolbar"><span>{highlighted.label}</span><CopyButton text={text} label="코드 복사" successMessage="코드를 복사했습니다."/></div>}
    <pre tabIndex={0} role="region" aria-label={`${highlighted.label} 코드`}>
      <code className={`code-source${highlighted.lines ? '' : ' code-plain'}`} style={{'--code-digits': String(highlighted.lines?.length || 1).length}}>
        {highlighted.lines ? highlighted.lines.map((tokens, index) => <span className="code-line" key={index}>
          <span className="code-line-number" data-line={index + 1} aria-hidden="true"/>
          {tokens.map((token, i) => token.className ? <span className={token.className} key={i}>{token.text}</span> : token.text)}
          {index < highlighted.lines.length - 1 ? '\n' : null}
        </span>) : text}
      </code>
    </pre>
  </div>;
}
