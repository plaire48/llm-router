import {useLayoutEffect} from 'react';

const controlsIn = node => [...node.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
  .filter(control => control.tabIndex >= 0 && !control.closest('[inert],[hidden]') && control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden');

// Match CX DetailPanel's inert layer for small, anchored Desktop dialogs.
// Keep each ancestor on the path to the dialog active, including inline menus.
export function useAnchoredModal(dialog, trigger, enabled, initialFocus, allowTrigger = false) {
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!enabled || !node) return;
    const restore = trigger.current, owned = [];
    const previousTabIndex = node.getAttribute('tabindex');
    node.tabIndex = -1;
    const activeBranches = new Set();
    for (const leaf of [node, ...(allowTrigger && restore ? [restore] : [])]) {
      let branch = leaf;
      while (branch && branch !== document.body) { activeBranches.add(branch); branch = branch.parentElement; }
    }
    for (const branch of activeBranches) {
      const parent = branch.parentElement;
      if (!parent) continue;
      for (const sibling of parent.children) {
        if (activeBranches.has(sibling) || !(sibling instanceof HTMLElement) || sibling.inert) continue;
        sibling.inert = true;
        owned.push(sibling);
      }
    }
    const first = () => controlsIn(node)[0] || node;
    const preferred = node.querySelector(initialFocus || 'button:not(:disabled)');
    let lastFocus = controlsIn(node).includes(preferred) ? preferred : first();
    lastFocus.focus({preventScroll:true});
    const containFocus = event => {
      if (allowTrigger && restore?.contains(event.target)) return;
      if (node.contains(event.target)) { lastFocus = event.target; return; }
      const target = lastFocus === node || controlsIn(node).includes(lastFocus) ? lastFocus : first();
      target.focus({preventScroll:true});
    };
    const tab = event => {
      if (event.key !== 'Tab') return;
      const items = [...controlsIn(node), ...(allowTrigger && restore && !restore.disabled ? [restore] : [])], index = items.indexOf(document.activeElement);
      if (!items.length || index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === items.length - 1) {
        event.preventDefault(); event.stopPropagation();
        ((event.shiftKey ? items.at(-1) : items[0]) || node).focus({preventScroll:true});
      }
    };
    const keepOpen = event => {
      if (node.contains(event.target) || allowTrigger && restore?.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    document.addEventListener('focusin', containFocus, true);
    document.addEventListener('keydown', tab, true);
    document.addEventListener('pointerdown', keepOpen, true);
    document.addEventListener('click', keepOpen, true);
    return () => {
      document.removeEventListener('focusin', containFocus, true);
      document.removeEventListener('keydown', tab, true);
      document.removeEventListener('pointerdown', keepOpen, true);
      document.removeEventListener('click', keepOpen, true);
      for (const sibling of owned) sibling.inert = false;
      if (previousTabIndex === null) node.removeAttribute('tabindex'); else node.setAttribute('tabindex', previousTabIndex);
      queueMicrotask(() => {
        const another = [...document.querySelectorAll('[aria-modal="true"]')].some(item => item !== node && item.getClientRects().length && !item.closest('[inert],[hidden]'));
        if (!another && restore?.isConnected && !restore.closest('[inert]')) restore.focus({preventScroll:true});
      });
    };
  }, [dialog, trigger, enabled, initialFocus, allowTrigger]);
}
