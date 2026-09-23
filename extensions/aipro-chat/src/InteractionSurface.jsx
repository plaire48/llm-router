import React from 'react';
import {Icon} from '@e2e/cx-design-system';
import './interaction-forms.css';
import './approval.css';

// Presentational only: each host retains its own answers, approvals and receipts.
export function InteractionSurface({className = '', title, titleId, icon = 'message', headingClassName = '', headingAction, children, ...props}) {
  return <section className={`interaction-card ${className}`} {...props}>
    <div className={`interaction-heading ${headingClassName}`}>
      <span className="interaction-symbol"><Icon name={icon} size={18}/></span>
      <p id={titleId}>{title}</p>{headingAction}
    </div>
    {children}
  </section>;
}

export function ApprovalPreview({title = '내용 확인', label = '실행할 내용', children}) {
  return <details className="approval-preview" onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open) event.currentTarget.closest('section')?.scrollIntoView({block:'nearest'});
  }}>
    <summary>{title}<Icon name="chevronDown" size={14}/></summary>
    <div className="approval-preview-body" tabIndex={0} aria-label={label}>{children}</div>
  </details>;
}
