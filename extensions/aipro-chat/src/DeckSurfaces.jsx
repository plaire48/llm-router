import React, {useEffect, useId, useState} from 'react';
import {ActionButton, CxButton, CxField, DetailPanel, Icon} from '@e2e/cx-design-system';
import './deck-surfaces.css';

// Small surface primitives derived from the user's HTML: tile, pill,
// list-card and approve-box. Host data and operations stay in the caller.
export function DeckSectionLabel({icon, tone='blue', children}) {
  return <span className="deck-section-label"><span className="deck-section-icon" data-tone={tone} aria-hidden="true"><Icon name={icon} size={18}/></span><span>{children}</span></span>;
}

// Add a semantic field cue without replacing the accessible text label or
// changing CX's input, validation and description wiring.
export function DeckField({icon='pencil', label, ...props}) {
  return <CxField {...props} label={<span className="deck-field-label"><span aria-hidden="true"><Icon name={icon} size={16}/></span><span>{label}</span></span>}/>;
}

export function DeckStatus({tone='neutral',icon,children}) {
  return <span className="deck-status" data-tone={tone}>{icon && <Icon name={icon} size={14}/>}<span>{children}</span></span>;
}

// Keep a decision's key condition distinct from its supporting detail.
// Callers mark only meaningful words with strong; icons supplement that meaning.
export function DeckGuidance({icon,lead,children}) {
  return <div className="deck-guidance">
    {icon && <span className="deck-guidance-icon" aria-hidden="true"><Icon name={icon} size={18}/></span>}
    <div className="deck-guidance-copy"><p className="deck-guidance-lead">{lead}</p>
      {children && <div className="deck-guidance-detail">{children}</div>}
    </div>
  </div>;
}

// Compose public CX controls so confirmations use the same button typography
// as other dialogs, including busy/error states and initial cancel focus.
// showActionLabels adds visible labels beside icons without changing other hosts.
export function DeckConfirmation({title, message, confirmLabel, cancelLabel='취소', busy=false, onConfirm, onCancel, children, headerCancelOnly=false, confirmIcon, showActionLabels=false}) {
  const descriptionId = useId();
  return <DetailPanel title={title} className="deck-dialog deck-confirmation" variant="confirmation" role="alertdialog" describedBy={descriptionId} initialFocus={headerCancelOnly ? '.cx-panel-header-actions [data-action="close"]' : '[data-cancel-confirmation]'} busy={busy} onClose={onCancel} footer={<>
    {!headerCancelOnly && <ActionButton action="cancel" iconOnly={!showActionLabels} label={cancelLabel} title={cancelLabel} data-cancel-confirmation disabled={busy} onClick={onCancel}/>}
    <CxButton variant="primary" busy={busy} disabled={busy} onClick={onConfirm} {...(confirmIcon ? {'aria-label': confirmLabel, title: confirmLabel} : {})}>{confirmIcon && <Icon name={confirmIcon} size={18}/>} {(!confirmIcon || showActionLabels) && confirmLabel}</CxButton>
  </>}>
    <div className="deck-confirmation-content"><span className="deck-symbol" aria-hidden="true"><Icon name="alertCircle" size={24}/></span><p id={descriptionId}>{message}</p></div>
    {children}
  </DetailPanel>;
}

export function DeckEmpty({icon='message',title,description,loading=false,children}) {
  return <div className="deck-empty" role={loading ? 'status' : undefined}>
    <span className="deck-symbol" aria-hidden="true">{loading ? <span className="status-spinner"/> : <Icon name={icon} size={24}/>}</span>
    <strong>{title}</strong>{description && <p>{description}</p>}{children}
  </div>;
}

export function DeckDisclosure({title,icon='list',attention=false,children}) {
  const [expanded,setExpanded]=useState(attention);
  useEffect(()=>{if(attention)setExpanded(true);},[attention]);
  return <details className="deck-disclosure" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary><Icon name={icon} size={16}/><span>{title}</span><Icon name="chevronDown" size={16}/></summary>
    <div className="deck-disclosure-body">{children}</div>
  </details>;
}
