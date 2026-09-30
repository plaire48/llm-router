import React from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';

// The decision row of every approval card (user decision 2026-09-30): at the card's foot, on the right, the approval
// as the one filled button with its icon, and the refusal beside it without a frame.
export function ApprovalBar({approveLabel = '실행', approveIcon = 'play', rejectLabel = '실행 안 함', disabled, approveDisabled, onApprove, onReject, children}) {
  return <div className="nubi-approval-bar">
    {children}
    {onReject && <CxButton className="nubi-text-button" disabled={disabled} onClick={onReject}><Icon name="xClose" size={16}/>{rejectLabel}</CxButton>}
    <CxButton variant="primary" disabled={disabled || approveDisabled} onClick={onApprove}><Icon name={approveIcon} size={16}/>{approveLabel}</CxButton>
  </div>;
}
