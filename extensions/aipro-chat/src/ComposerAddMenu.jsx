import React, {useId, useRef} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';

// A disclosure of ordinary actions, not an ARIA menu with custom tab behavior.
// Native popovers provide light dismissal, Escape and top-layer positioning.
export function ComposerAddMenu({children}) {
  const id = useId(), panel = useRef(null), trigger = useRef(null);
  return <div className="composer-add">
    <CxButton ref={trigger} className="composer-icon composer-add-trigger" aria-label="추가" title="추가" popoverTarget={id} aria-controls={id}><Icon name="plus" size={20}/></CxButton>
    <div id={id} ref={panel} popover="auto" className="composer-add-popover" role="group" aria-label="추가 기능" onClickCapture={event => {
      const button = event.target.closest('button');
      if (!button || button.disabled || !event.currentTarget.contains(button)) return;
      // Restore before an action opens a dialog so its focus return target is
      // the visible + button, not a control in the now-hidden popover.
      panel.current.hidePopover(); trigger.current?.focus({preventScroll: true});
    }}>
      {children}
    </div>
  </div>;
}
