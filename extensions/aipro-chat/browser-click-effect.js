// A bounded, ephemeral change detector for popup waiting. It never declares
// success, supplies model evidence, or returns field values/page text.
// Serialized into the observed node's frame without external closures.
export function clickEffect(node) {
  node ||= document.body;
  if (!node) return null;
  let hash = 2166136261;
  const text = (document.body?.innerText || '').slice(0, 48000);
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  const controls = String(node.getAttribute('aria-controls') || '').split(/\s+/).slice(0, 8).map(id => {
    const element = node.getRootNode().getElementById?.(id);
    return !!element?.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  });
  // A menu or a panel opened by a class name (html.nav-open, body.menu-active, the
  // button's own "on") often shows text that was already in innerText, hidden by
  // opacity or position. Its class names and the open dialogs still change.
  const classes = [document.documentElement, document.body, node, node.parentElement].map(element => String(element?.className?.baseVal ?? element?.className ?? '').slice(0, 200));
  const dialogs = document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]').length;
  return JSON.stringify([hash, text.length, node.isConnected, !!node.getClientRects().length,
    node.checked, ...['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected'].map(key => node.getAttribute(key)), controls, classes, dialogs]);
}
