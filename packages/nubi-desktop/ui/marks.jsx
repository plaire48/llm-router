import React from 'react';

// Marks the design system has no glyph for, drawn like its icons (24 grid, round 2px stroke).
const Mark = ({size = 22, children}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
export const FolderMark = ({size}) => <Mark size={size}><path d="M3.5 7.5a2 2 0 0 1 2-2h3.7l2 2.2h7.3a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></Mark>;
export const BranchMark = ({size}) => <Mark size={size}><circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8" r="2"/><path d="M6.5 7.5v9M17.5 10c0 4-4.5 4.2-9.6 6.9"/></Mark>;
export const TerminalMark = ({size}) => <Mark size={size}><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7.5 10 3 2.5-3 2.5M12.5 15h4"/></Mark>;
export const WindowMark = ({size}) => <Mark size={size}><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01"/></Mark>;
export const PointerMark = ({size}) => <Mark size={size}><path d="M5.5 3.5 18 10.2l-5.6 1.6-2.3 5.6z"/><path d="m12.6 12 5 5"/></Mark>;
