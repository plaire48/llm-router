// Expand declared spans from an already sanitized native table. Values remain
// source text; repeated cells are the same merged cell, never inferred data.
export function tableGrid(rows, maxColumns = 64) {
  if (rows.length > 500) return null;
  const grid = rows.map(() => []);
  for (let r = 0; r < rows.length; r++) {
    let column = 0;
    for (const cell of rows[r].cells) {
      while (grid[r][column] !== undefined) column++;
      const width = cell.colSpan || 1;
      let groupEnd = r + 1;
      while (groupEnd < rows.length && rows[groupEnd].group === rows[r].group) groupEnd++;
      const height = cell.rowSpan === 0 ? groupEnd - r : Math.min(cell.rowSpan || 1, groupEnd - r);
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || column + width > maxColumns) return null;
      for (let y = r; y < r + height; y++) for (let x = column; x < column + width; x++) {
        if (grid[y][x] !== undefined) return null; // Invalid overlapping markup.
        grid[y][x] = cell.text;
      }
      column += width;
    }
  }
  const width = Math.max(0, ...grid.map(row => row.length));
  return grid.map(row => Array.from({length: width}, (_, i) => row[i] ?? ''));
}

export function tableMarkdown(table) {
  const rows = [...table.rows].map(row => ({group: row.parentElement, cells: [...row.cells].map(cell => ({
    text: cell.textContent.trim(), rowSpan: cell.rowSpan, colSpan: cell.colSpan,
  }))}));
  const grid = table.querySelector('table') ? null : tableGrid(rows);
  if (!grid) return '[Complex table requires browser_snapshot; no flattened column associations supplied]';
  const escaped = grid.map(row => row.map(text => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')));
  return escaped.map(row => '| ' + row.join(' | ') + ' |').join('\n') +
    '\n[Source table rows; merged cells repeated across their declared span. The first row is not necessarily a header.]';
}
