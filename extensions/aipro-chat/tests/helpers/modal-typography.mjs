import assert from 'node:assert/strict';

// Inspect rendered text, including expanded details and nested confirmation portals.
export async function assertModalTypography(dialog) {
  const samples = await dialog.evaluate(root => {
    const metadata = '.wiki-document-date, .history-meta, .settings-version, .capture-time, .capture-facts, .attachment-facts, .capture-count, .usage-metadata, .usage-scope, .context-source, .usage-total > span';
    return [...root.querySelectorAll('*')].filter(el => {
      if (!el.checkVisibility() || el.closest('svg, .visually-hidden, [aria-hidden="true"]')) return false;
      return ['INPUT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'checkbox' || [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
    }).map(el => {
      const style = getComputedStyle(el);
      const heading = el.closest('.cx-panel-heading h2, .message-body :is(h1,h2,h3,h4,h5,h6)');
      // Only real Markdown/CodeBlock content receives the code exception.
      // Copy controls and errors in the toolbar still follow the body scale.
      const sourceCode = el.closest('.code-block > pre > code.code-source');
      const inlineCode = el.closest('.message-body :not(pre) > code:not(.code-source)');
      const toolbarLabel = el.closest('.code-block > .code-toolbar > span:not(.copy-control)');
      const kind = sourceCode ? 'sourceCode' : inlineCode ? heading ? 'headingCode' : 'inlineCode' : toolbarLabel ? 'codeMetadata'
        : heading ? 'title' : el.closest('.context-total strong') ? 'value' : el.closest(metadata) ? 'metadata' : 'body';
      return {text: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 65), kind, font: style.fontFamily, size: style.fontSize, line: style.lineHeight, weight: style.fontWeight};
    });
  });
  const sizes = {title: '16px', body: '14px', metadata: '12px', value: '24px', inlineCode:'14px', headingCode:'16px', sourceCode:'13px', codeMetadata:'13px'};
  const lines = {title: '24px', body: '22px', metadata: '16px', inlineCode:'22px', headingCode:'24px', sourceCode:'22.75px', codeMetadata:'22px'};
  const codeKinds = new Set(['inlineCode','headingCode','sourceCode']);
  const issues = samples.filter(sample => !(codeKinds.has(sample.kind) ? sample.font.includes('monospace') && !sample.font.includes('Noto Sans KR') : sample.font.includes('Noto Sans KR'))
    || sample.size !== sizes[sample.kind] || (lines[sample.kind] && sample.line !== lines[sample.kind]) || !['400', '500', '600'].includes(sample.weight));
  assert.deepEqual(issues, [], 'Modal text must use the shared type scale');
  const documentColors=await dialog.locator('.deck-disclosure-body > .message-body:not(.progress-markdown)').evaluateAll(els=>els.filter(el=>el.checkVisibility()).map(el=>getComputedStyle(el).color));
  assert(documentColors.every(color=>color==='rgb(25, 31, 40)'), 'Nested documents must retain HTML body ink rather than inherit guidance color');
  assert(samples.filter(sample => sample.kind === 'title').every(sample => sample.line === '24px'));
  const plainDisclosures = await dialog.locator('.integration-content details:not(.deck-subsection):not(.deck-disclosure)').count();
  assert.equal(plainDisclosures, 0, 'Nested integration sections must use shared disclosure styling');
  const guidance = await dialog.locator('.deck-guidance').evaluateAll(elements => elements.filter(el => el.checkVisibility()).map(el => {
    const lead = el.querySelector('.deck-guidance-lead'), detail = el.querySelector('.deck-guidance-detail');
    return {leadColor: getComputedStyle(lead).color, detailColor: detail ? getComputedStyle(detail).color : null,
      emphasis: [...el.querySelectorAll('strong')].map(node => ({color: getComputedStyle(node).color, weight: getComputedStyle(node).fontWeight, text: node.textContent.trim()})),
      iconHidden: !el.querySelector('.deck-guidance-icon') || el.querySelector('.deck-guidance-icon').getAttribute('aria-hidden') === 'true'};
  }));
  assert(guidance.every(item => item.leadColor === 'rgb(25, 31, 40)' && (!item.detailColor || item.detailColor === 'rgb(78, 89, 104)')
    && item.iconHidden && item.emphasis.every(text => text.color === 'rgb(27, 100, 218)' && text.weight === '600' && text.text)),
  'Guidance must distinguish key phrases with deep blue/bold, keep readable detail, and avoid duplicate icon announcements');
  const controls = await dialog.evaluate(root => ({
    icons: [...root.querySelectorAll('.cx-action-button[data-icon-only="true"]')].filter(el => el.checkVisibility()).map(el => ({name: el.getAttribute('aria-label'), tooltip: el.getAttribute('title'), visibleText: [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent.trim()).join('')})),
    disclosures: [...root.querySelectorAll('.deck-subsection > summary')].filter(el => el.checkVisibility()).map(el => {const s=getComputedStyle(el), arrow=getComputedStyle(el,'::after');return {font:s.fontFamily,size:s.fontSize,line:s.lineHeight,color:s.color,marker:s.listStyleType,arrow:arrow.content,transition:arrow.transitionDuration};}),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  assert(controls.icons.every(button => button.name && button.tooltip && !button.visibleText), 'Icon controls must retain names/tooltips without redundant visible labels');
  assert(controls.disclosures.every(item => item.font.includes('Noto Sans KR') && item.size==='14px' && item.line==='22px' && item.color==='rgb(25, 31, 40)' && item.marker==='none' && item.arrow==='""'), 'Nested details must share the HTML type, ink and disclosure affordance');
  if(controls.reduced) assert(controls.disclosures.every(item => parseFloat(item.transition)<=.001), 'Reduced motion must also disable nested disclosure transitions');
  return samples;
}
