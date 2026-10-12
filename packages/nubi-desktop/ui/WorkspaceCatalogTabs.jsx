import React from 'react';
import {AgentTabs} from '../../../extensions/aipro-chat/src/AgentTabs.jsx';
import './workspace-catalog.css';

// Skills and shared Wiki use one tab geometry, including keyboard navigation.
export function WorkspaceCatalogTabs(props){
  return <div className="nubi-catalog-tabs"><AgentTabs {...props}/></div>;
}
