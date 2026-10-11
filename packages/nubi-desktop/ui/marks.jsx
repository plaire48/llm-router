import React from 'react';

// Marks the design system has no glyph for, drawn like its icons (24 grid, round 1.8px stroke).
const Mark = ({size = 22, children}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
export const FolderMark = ({size}) => <Mark size={size}><path d="M3.5 7.5a2 2 0 0 1 2-2h3.7l2 2.2h7.3a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></Mark>;
export const FolderOpenMark = ({size}) => <Mark size={size}><path d="M3.5 8a2 2 0 0 1 2-2h3.7l2 2.2h6.7a2 2 0 0 1 1.8 2.9l-1.8 6.1a2 2 0 0 1-1.9 1.4H5a2 2 0 0 1-1.9-2.6l1.2-5.1a2 2 0 0 1 1.9-1.5h15"/></Mark>;
export const BranchMark = ({size}) => <Mark size={size}><circle cx="6.5" cy="5.5" r="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="8" r="2"/><path d="M6.5 7.5v9M17.5 10c0 4-4.5 4.2-9.6 6.9"/></Mark>;
export const TerminalMark = ({size}) => <Mark size={size}><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="m7.5 10 3 2.5-3 2.5M12.5 15h4"/></Mark>;
export const WindowMark = ({size}) => <Mark size={size}><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 9h18M6.5 6.8h.01M9 6.8h.01"/></Mark>;
export const BrowserMark = ({size}) => <Mark size={size}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18M12 3c5 5 5 13 0 18"/></Mark>;
export const StopMark = ({size}) => <Mark size={size}><rect x="6" y="6" width="12" height="12" rx="2"/></Mark>;
export const PointerMark = ({size}) => <Mark size={size}><path d="M5.5 3.5 18 10.2l-5.6 1.6-2.3 5.6z"/><path d="m12.6 12 5 5"/></Mark>;
export const KeyboardMark = ({size}) => <Mark size={size}><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14.5h8"/></Mark>;

export const HomeMark = ({size}) => <Mark size={size}><path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9"/></Mark>;
export const PersonMark = ({size}) => <Mark size={size}><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></Mark>;
export const CompanyMark = ({size}) => <Mark size={size}><path d="M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 21v-3h4v3"/></Mark>;
export const SignpostMark = ({size}) => <Mark size={size}><path d="M12 3v18M5 5h12l4 3-4 3H5zM19 14H7l-4 3 4 3h12z"/></Mark>;
export function RecoveryStatus() {
  return <span className="nubi-recovery-status" role="status" aria-label="복구 대기" title="복구 대기"><SignpostMark size={14}/></span>;
}
