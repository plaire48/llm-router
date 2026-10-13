import React from 'react';
import {DetailPanel,Icon} from '@e2e/cx-design-system';

export function OfficeDialog({title,icon='sliders',className='',children,...props}){
 return <DetailPanel {...props} variant="modal" hideHelp className={`deck-dialog office-dialog ${className}`} title={<span className="nubi-panel-title office-dialog-title"><span className="nubi-panel-title-icon office-dialog-symbol" aria-hidden="true"><Icon name={icon} size={18}/></span><span>{title}</span></span>}>
  {children}
 </DetailPanel>;
}
