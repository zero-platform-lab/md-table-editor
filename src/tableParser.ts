export interface TableData {
  headers: string[];
  rows: string[][];
  alignments: ('left' | 'center' | 'right' | 'none')[];
}

export interface TableRange {
  startLine: number;
  endLine: number;
}

const SEPARATOR_RE = /^\s*\|?\s*[:\-][\-:]+\s*(\|\s*[:\-][\-:]+\s*)*\|?\s*$/;

function parseRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map(cell => cell.trim());
}

function parseAlignment(cell: string): 'left' | 'center' | 'right' | 'none' {
  const t = cell.trim();
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return 'none';
}

export function findTable(lines: string[], cursorLine: number): TableRange | null {
  if (cursorLine < 0 || cursorLine >= lines.length) return null;

  const isTableLine = (l: string) => l.includes('|');

  if (!isTableLine(lines[cursorLine])) return null;

  let start = cursorLine;
  while (start > 0 && isTableLine(lines[start - 1])) start--;

  let end = cursorLine;
  while (end < lines.length - 1 && isTableLine(lines[end + 1])) end++;

  const block = lines.slice(start, end + 1);
  const sepIdx = block.findIndex(l => SEPARATOR_RE.test(l));
  if (sepIdx < 0 || sepIdx !== 1) return null;

  if (end - start < 1) return null;

  return { startLine: start, endLine: end };
}

export function findAllTables(lines: string[]): TableRange[] {
  const results: TableRange[] = [];
  let i = 0;
  while (i < lines.length - 1) {
    if (lines[i].includes('|') && SEPARATOR_RE.test(lines[i + 1])) {
      const range = findTable(lines, i);
      if (range) {
        results.push(range);
        i = range.endLine + 1;
        continue;
      }
    }
    i++;
  }
  return results;
}

export function findTableByHeaders(lines: string[], targetHeaders: string[]): TableRange | null {
  const sig = targetHeaders.join('\x00');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes('|')) continue;
    if (!SEPARATOR_RE.test(lines[i + 1])) continue;
    const headers = parseRow(lines[i]);
    if (headers.join('\x00') === sig) {
      const range = findTable(lines, i);
      if (range) return range;
    }
  }
  return null;
}

export function parseTable(lines: string[], range: TableRange): TableData {
  const block = lines.slice(range.startLine, range.endLine + 1);
  const headers = parseRow(block[0]);
  const sepCells = parseRow(block[1]);
  const alignments = sepCells.map(parseAlignment);
  const rows = block.slice(2).map(parseRow);

  const colCount = headers.length;
  const normalizedRows = rows.map(r => {
    while (r.length < colCount) r.push('');
    return r.slice(0, colCount);
  });
  while (alignments.length < colCount) alignments.push('none');

  return { headers, rows: normalizedRows, alignments: alignments.slice(0, colCount) };
}

export function serializeTable(data: TableData): string {
  const colCount = data.headers.length;

  const colWidths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = byteLength(data.headers[c]);
    for (const row of data.rows) {
      max = Math.max(max, byteLength(row[c] || ''));
    }
    colWidths.push(Math.max(max, 3));
  }

  const padCell = (text: string, width: number) => {
    const pad = width - byteLength(text);
    return text + ' '.repeat(Math.max(0, pad));
  };

  const headerLine = '| ' + data.headers.map((h, i) => padCell(h, colWidths[i])).join(' | ') + ' |';

  const sepLine = '| ' + data.alignments.map((a, i) => {
    const w = colWidths[i];
    switch (a) {
      case 'left': return ':' + '-'.repeat(w - 1);
      case 'right': return '-'.repeat(w - 1) + ':';
      case 'center': return ':' + '-'.repeat(w - 2) + ':';
      default: return '-'.repeat(w);
    }
  }).join(' | ') + ' |';

  const rowLines = data.rows.map(row =>
    '| ' + row.map((cell, i) => padCell(cell || '', colWidths[i])).join(' | ') + ' |'
  );

  return [headerLine, sepLine, ...rowLines].join('\n');
}

function byteLength(s: string): number {
  let len = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    len += code > 0x7f ? 2 : 1;
  }
  return len;
}
