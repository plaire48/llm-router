import React from 'react';
import {createRoot} from 'react-dom/client';
import '@e2e/cx-design-system/styles.css';
import '../design/agent-deck.css';
import './app.css';
import './surfaces.css';
import App from './App';
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
