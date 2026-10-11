import React from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';

// The decision row of every approval card (user decision 2026-09-30): at the card's foot, on the right, the approval
// as the one filled button with its icon, and the refusal beside it without a frame.
// onAlways: "always allow", approve this command and let the same one run by itself from now on (2026-09-30).
export function ApprovalBar({approveLabel = '실행', approveIcon = 'play', rejectLabel = '실행 안 함', disabled, approveDisabled, onApprove, onReject, onAlways, children}) {
  return <div className="nubi-approval-bar">
    {children}
    {onReject && <CxButton className="nubi-text-button" disabled={disabled} onClick={onReject}><Icon name="xClose" size={16}/>{rejectLabel}</CxButton>}
    {onAlways && <CxButton className="nubi-text-button" disabled={disabled || approveDisabled} title="같은 명령은 다음부터 확인 없이 실행해요" onClick={onAlways}><Icon name="check" size={16}/>항상 허용</CxButton>}
    <CxButton variant="primary" disabled={disabled || approveDisabled} onClick={onApprove}><Icon name={approveIcon} size={16}/>{approveLabel}</CxButton>
  </div>;
}
