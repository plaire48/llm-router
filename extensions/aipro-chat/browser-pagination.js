// Read only an explicit visible page counter. A count is a view identity hint,
// never proof that all pages/rows were read or that the underlying data is fixed.
export function paginationView(nodes) {
  const visible = node => !node.closest('[hidden],[inert],[aria-hidden="true"],input,textarea,select,[contenteditable]:not([contenteditable="false"])') &&
    node.getClientRects().length > 0 && !['hidden', 'collapse'].includes(getComputedStyle(node).visibility);
  const controls = nodes.filter(node => node.matches('button,a,[role="button"]'));
  const label = node => (node.getAttribute('aria-label') || node.textContent || '').trim();
  if (!controls.some(node => /^(?:이전(?:\s*페이지)?|previous(?:\s*page)?|prev)$/i.test(label(node)) && visible(node)) ||
      !controls.some(node => /^(?:다음(?:\s*페이지)?|next(?:\s*page)?)$/i.test(label(node)) && visible(node))) return undefined;
  const counters = [];
  for (const node of nodes) {
    if (node.children.length) continue;
    const text = node.textContent.trim();
    const match = text.match(/^(?:page\s+)?(\d{1,6})\s*(?:\/|of)\s*(\d{1,6})\s*(?:쪽|페이지|pages?)$/i) ||
      text.match(/^page\s+(\d{1,6})\s*(?:\/|of)\s*(\d{1,6})$/i);
    if (!match || !visible(node)) continue;
    const current = Number(match[1]), total = Number(match[2]);
    if (current > 0 && current <= total && total > 1) counters.push({current, total});
  }
  return counters.length === 1 ? counters[0] : undefined;
}
