import React from 'react';
import {CxTabs} from '@e2e/cx-design-system';

// Shared tab surface; CX retains keyboard navigation, roles and focus behavior.
export function AgentTabs({items, active, provider = false, containerRef, ...props}) {
  const index = Math.max(0, items.findIndex(item => item.key === active));
  return <div ref={containerRef} id={provider ? 'model-provider-tabs' : undefined}
    className={`agent-tabs${provider ? ' provider-switcher' : ''}`} data-provider={provider ? active : undefined}
    style={{'--tab-index': index, '--tab-count': items.length}}>
    <span className={`agent-tab-highlight${provider ? ' provider-tab-highlight' : ''}`} aria-hidden="true">
      {provider && items.map(item => <i key={item.key} data-provider={item.key}/>)}
    </span>
    <CxTabs {...props} className={`agent-tab-controls${provider ? ' provider-tabs' : ''}`} items={items} active={active}/>
  </div>;
}
