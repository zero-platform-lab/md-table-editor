export function getWebviewHtml(nonce: string): string {
  return /*html*/`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root {
  --bg: var(--vscode-editor-background);
  --fg: var(--vscode-editor-foreground);
  --border: var(--vscode-panel-border, #444);
  --cell-bg: var(--vscode-input-background);
  --header-bg: var(--vscode-editorGroupHeader-tabsBackground);
  --btn-bg: var(--vscode-button-background);
  --btn-fg: var(--vscode-button-foreground);
  --btn-hover: var(--vscode-button-hoverBackground);
  --focus: var(--vscode-focusBorder);
  --handle: var(--vscode-button-background);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; color: var(--fg); background: var(--bg); padding: 12px; }

.toolbar { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
.toolbar button {
  background: var(--btn-bg); color: var(--btn-fg); border: none;
  padding: 4px 10px; cursor: pointer; border-radius: 3px; font-size: 12px;
}
.toolbar button:hover { background: var(--btn-hover); }
.toolbar button.align-active { outline: 2px solid var(--focus); outline-offset: -2px; }

.grid-wrap { overflow: auto; max-height: calc(100vh - 120px); position: relative; }
.table-container { position: relative; display: inline-block; }
table { border-collapse: collapse; }
th, td {
  border: 1px solid var(--border);
  padding: 3px 6px;
  min-width: 60px;
  white-space: pre-wrap;
  vertical-align: top;
}
th { background: var(--header-bg); font-weight: bold; }
td { background: var(--cell-bg); }
td:focus, th:focus {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.row-num {
  background: var(--header-bg);
  text-align: center;
  min-width: 32px;
  width: 32px;
  color: var(--fg);
  opacity: 0.6;
  user-select: none;
  cursor: grab;
}
.row-num:active { cursor: grabbing; }

th[data-col] { cursor: grab; }
th[data-col]:active { cursor: grabbing; }

.selected { outline: 2px solid var(--focus); outline-offset: -2px; }

.drop-indicator-row {
  position: absolute;
  left: 0;
  height: 3px;
  background: var(--focus);
  pointer-events: none;
  z-index: 50;
  border-radius: 2px;
}
.drop-indicator-col {
  position: absolute;
  top: 0;
  width: 3px;
  background: var(--focus);
  pointer-events: none;
  z-index: 50;
  border-radius: 2px;
}
.dragging-row { opacity: 0.4; }
.dragging-col { opacity: 0.4; }

.handle-right, .handle-bottom, .handle-corner {
  position: absolute;
  background: var(--handle);
  opacity: 0.4;
  transition: opacity 0.15s;
  z-index: 10;
}
.handle-right:hover, .handle-bottom:hover, .handle-corner:hover {
  opacity: 0.8;
}
.handle-right {
  right: -10px; top: 0; width: 8px; height: 100%;
  cursor: e-resize;
  border-radius: 0 3px 3px 0;
}
.handle-bottom {
  bottom: -10px; left: 0; width: 100%; height: 8px;
  cursor: s-resize;
  border-radius: 0 0 3px 3px;
}
.handle-corner {
  right: -10px; bottom: -10px; width: 8px; height: 8px;
  cursor: se-resize;
  border-radius: 0 0 3px 0;
}

.drag-indicator {
  position: fixed;
  background: var(--focus);
  opacity: 0.3;
  pointer-events: none;
  z-index: 100;
}
</style>
</head>
<body>
<div class="toolbar">
  <button id="addRowAbove" title="上に行追加">+ 行↑</button>
  <button id="addRowBelow" title="下に行追加">+ 行↓</button>
  <button id="deleteRow" title="行削除">− 行</button>
  <button id="addColLeft" title="左に列追加">+ 列←</button>
  <button id="addColRight" title="右に列追加">+ 列→</button>
  <button id="deleteCol" title="列削除">− 列</button>
  <span style="border-left:1px solid var(--border);margin:0 2px"></span>
  <button id="alignLeft" title="左揃え" class="align-btn">&#9776;&#8592;</button>
  <button id="alignCenter" title="中央揃え" class="align-btn">&#9776;</button>
  <button id="alignRight" title="右揃え" class="align-btn">&#9776;&#8594;</button>
  <span style="flex:1"></span>
  <button id="applyBtn" style="display:none" title="Markdownに適用">&#10003; Apply</button>
</div>
<div class="grid-wrap">
  <div class="table-container" id="tableContainer">
    <table id="grid"></table>
    <div class="handle-right" id="handleRight" title="← → ドラッグで列追加"></div>
    <div class="handle-bottom" id="handleBottom" title="↑ ↓ ドラッグで行追加"></div>
    <div class="handle-corner" id="handleCorner" title="ドラッグで行列追加"></div>
  </div>
</div>
<div class="toolbar" style="margin-top:16px;margin-bottom:0;">
  <button id="undo" title="Ctrl+Z">↩ Undo</button>
  <button id="redo" title="Ctrl+Y">↪ Redo</button>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
let headers = [];
let rows = [];
let alignments = [];
let focusedRow = -1;
let focusedCol = -1;
let debounceMs = 300;
let syncMode = 'auto';

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.type === 'load') {
    headers = msg.headers;
    rows = msg.rows;
    alignments = msg.alignments;
    if (msg.debounceMs != null) debounceMs = msg.debounceMs;
    if (msg.syncMode) syncMode = msg.syncMode;
    document.getElementById('applyBtn').style.display = syncMode === 'manual' ? '' : 'none';
    render();
    snapshot();
  }
  if (msg.type === 'tableDeleted') {
    const table = document.getElementById('grid');
    table.innerHTML = '<tr><td style="padding:20px;opacity:0.5;">テーブルが削除されました</td></tr>';
    return;
  }
  if (msg.type === 'update') {
    headers = msg.headers;
    rows = msg.rows;
    alignments = msg.alignments;
    const fr = focusedRow;
    const fc = focusedCol;
    const hadFocus = document.hasFocus();
    render();
    if (hadFocus && fr >= -1 && fc >= 0) {
      moveFocus(fr, fc);
    }
  }
});

function render() {
  const table = document.getElementById('grid');
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'row-num';
  hr.appendChild(corner);
  headers.forEach((h, ci) => {
    const th = document.createElement('th');
    th.contentEditable = 'true';
    th.textContent = h;
    th.dataset.row = '-1';
    th.dataset.col = String(ci);
    const align = alignments[ci];
    if (align === 'left') th.style.textAlign = 'left';
    else if (align === 'center') th.style.textAlign = 'center';
    else if (align === 'right') th.style.textAlign = 'right';
    th.addEventListener('focus', () => { focusedRow = -1; focusedCol = ci; updateAlignButtons(); });
    th.addEventListener('input', () => { headers[ci] = th.textContent || ''; sync(); });
    th.addEventListener('keydown', handleKeydown);
    th.addEventListener('contextmenu', e => {
      e.preventDefault();
      const cycle = { none: 'left', left: 'center', center: 'right', right: 'none' };
      alignments[ci] = cycle[alignments[ci]] || 'left';
      focusedCol = ci;
      updateAlignButtons();
      render(); syncNow();
    });
    setupColDrag(th, ci);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, ri) => {
    const tr = document.createElement('tr');
    const num = document.createElement('td');
    num.className = 'row-num';
    num.textContent = String(ri + 1);
    num.addEventListener('click', () => selectRow(ri));
    setupRowDrag(num, ri);
    tr.appendChild(num);
    row.forEach((cell, ci) => {
      const td = document.createElement('td');
      td.contentEditable = 'true';
      td.textContent = cell;
      td.dataset.row = String(ri);
      td.dataset.col = String(ci);
      const align = alignments[ci];
      if (align === 'left') td.style.textAlign = 'left';
      else if (align === 'center') td.style.textAlign = 'center';
      else if (align === 'right') td.style.textAlign = 'right';
      td.addEventListener('focus', () => { focusedRow = ri; focusedCol = ci; updateAlignButtons(); });
      td.addEventListener('input', () => { rows[ri][ci] = td.textContent || ''; sync(); });
      td.addEventListener('keydown', handleKeydown);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
}

function handleKeydown(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const r = parseInt(e.target.dataset.row);
    const c = parseInt(e.target.dataset.col);
    if (e.shiftKey) {
      moveFocus(r, c - 1);
    } else {
      moveFocus(r, c + 1);
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const r = parseInt(e.target.dataset.row);
    const c = parseInt(e.target.dataset.col);
    moveFocus(r + 1, c);
  }
}

function moveFocus(r, c) {
  const colCount = headers.length;
  if (c >= colCount) { c = 0; r++; }
  if (c < 0) { c = colCount - 1; r--; }
  if (r < -1) return;
  if (r >= rows.length) return;

  const selector = r === -1 ? 'th' : 'td';
  const cells = document.querySelectorAll('#grid ' + selector + '[data-col="' + c + '"]');
  for (const cell of cells) {
    if (parseInt(cell.dataset.row) === r) {
      cell.focus();
      break;
    }
  }
}

function selectRow(ri) {
  focusedRow = ri;
  document.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
  const tds = document.querySelectorAll('td[data-row="' + ri + '"]');
  tds.forEach(td => td.classList.add('selected'));
}

function emptyRow() { return new Array(headers.length).fill(''); }

let syncTimer = null;
function sync() {
  if (syncMode === 'manual') return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    snapshot();
    vscode.postMessage({ type: 'apply', headers, rows, alignments });
    syncTimer = null;
  }, debounceMs);
}
function syncNow() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
  snapshot();
  vscode.postMessage({ type: 'apply', headers, rows, alignments });
}

document.getElementById('addRowAbove').addEventListener('click', () => {
  const idx = Math.max(0, focusedRow);
  rows.splice(idx, 0, emptyRow());
  render(); syncNow();
});
document.getElementById('addRowBelow').addEventListener('click', () => {
  const idx = focusedRow < 0 ? 0 : focusedRow + 1;
  rows.splice(idx, 0, emptyRow());
  render(); syncNow();
});
document.getElementById('deleteRow').addEventListener('click', () => {
  if (focusedRow >= 0 && rows.length > 1) {
    rows.splice(focusedRow, 1);
    if (focusedRow >= rows.length) focusedRow = rows.length - 1;
    render(); syncNow();
  }
});
document.getElementById('addColLeft').addEventListener('click', () => {
  const idx = Math.max(0, focusedCol);
  headers.splice(idx, 0, '');
  alignments.splice(idx, 0, 'none');
  rows.forEach(r => r.splice(idx, 0, ''));
  render(); syncNow();
});
document.getElementById('addColRight').addEventListener('click', () => {
  const idx = focusedCol < 0 ? headers.length : focusedCol + 1;
  headers.splice(idx, 0, '');
  alignments.splice(idx, 0, 'none');
  rows.forEach(r => r.splice(idx, 0, ''));
  render(); syncNow();
});
document.getElementById('deleteCol').addEventListener('click', () => {
  if (focusedCol >= 0 && headers.length > 1) {
    headers.splice(focusedCol, 1);
    alignments.splice(focusedCol, 1);
    rows.forEach(r => r.splice(focusedCol, 1));
    if (focusedCol >= headers.length) focusedCol = headers.length - 1;
    render(); syncNow();
  }
});

// --- Alignment ---

function setAlignment(align) {
  if (focusedCol < 0) return;
  alignments[focusedCol] = alignments[focusedCol] === align ? 'none' : align;
  updateAlignButtons();
  render(); syncNow();
}

function updateAlignButtons() {
  const cur = focusedCol >= 0 ? alignments[focusedCol] : 'none';
  document.getElementById('alignLeft').classList.toggle('align-active', cur === 'left');
  document.getElementById('alignCenter').classList.toggle('align-active', cur === 'center');
  document.getElementById('alignRight').classList.toggle('align-active', cur === 'right');
}

document.getElementById('applyBtn').addEventListener('click', () => syncNow());

document.getElementById('alignLeft').addEventListener('click', () => setAlignment('left'));
document.getElementById('alignCenter').addEventListener('click', () => setAlignment('center'));
document.getElementById('alignRight').addEventListener('click', () => setAlignment('right'));

// --- Undo / Redo ---

const history = [];
let historyIdx = -1;
let skipSnapshot = false;

function snapshot() {
  if (skipSnapshot) return;
  const state = JSON.stringify({ headers, rows, alignments });
  if (historyIdx >= 0 && history[historyIdx] === state) return;
  history.splice(historyIdx + 1);
  history.push(state);
  if (history.length > 200) history.shift();
  historyIdx = history.length - 1;
}

function restore(idx) {
  if (idx < 0 || idx >= history.length) return;
  historyIdx = idx;
  const s = JSON.parse(history[idx]);
  headers = s.headers;
  rows = s.rows;
  alignments = s.alignments;
  skipSnapshot = true;
  render();
  syncNow();
  skipSnapshot = false;
}

document.getElementById('undo').addEventListener('click', () => {
  restore(historyIdx - 1);
});
document.getElementById('redo').addEventListener('click', () => {
  restore(historyIdx + 1);
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    restore(historyIdx - 1);
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    restore(historyIdx + 1);
  }
});

// --- Row reorder by dragging row numbers ---

let dragRowIdx = -1;
let rowIndicator = null;

function setupRowDrag(numCell, ri) {
  numCell.addEventListener('mousedown', e => {
    e.preventDefault();
    dragRowIdx = ri;
    const table = document.getElementById('grid');
    const container = document.getElementById('tableContainer');

    const allRows = table.querySelectorAll('tbody tr');
    allRows[ri]?.classList.add('dragging-row');

    rowIndicator = document.createElement('div');
    rowIndicator.className = 'drop-indicator-row';
    container.appendChild(rowIndicator);

    function getDropIndex(ey) {
      let best = 0;
      let bestDist = Infinity;
      allRows.forEach((tr, i) => {
        const rect = tr.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        const dist = Math.abs(ey - mid);
        if (dist < bestDist) { bestDist = dist; best = i; }
        if (ey > mid) best = i + 1;
      });
      return Math.min(best, rows.length);
    }

    function onMove(ev) {
      const dropIdx = getDropIndex(ev.clientY);
      const allTrs = table.querySelectorAll('tbody tr');
      if (allTrs.length === 0) return;
      const tableRect = container.getBoundingClientRect();
      let indicatorY;
      if (dropIdx < allTrs.length) {
        indicatorY = allTrs[dropIdx].getBoundingClientRect().top - tableRect.top;
      } else {
        const last = allTrs[allTrs.length - 1].getBoundingClientRect();
        indicatorY = last.bottom - tableRect.top;
      }
      rowIndicator.style.top = indicatorY + 'px';
      rowIndicator.style.width = table.getBoundingClientRect().width + 'px';
    }

    function onUp(ev) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (rowIndicator) { rowIndicator.remove(); rowIndicator = null; }

      const dropIdx = getDropIndex(ev.clientY);
      if (dropIdx !== dragRowIdx && dropIdx !== dragRowIdx + 1) {
        const [moved] = rows.splice(dragRowIdx, 1);
        const insertAt = dropIdx > dragRowIdx ? dropIdx - 1 : dropIdx;
        rows.splice(insertAt, 0, moved);
      }
      dragRowIdx = -1;
      render(); syncNow();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// --- Column reorder by dragging headers ---

let dragColIdx = -1;
let colIndicator = null;

function setupColDrag(thCell, ci) {
  let isDragging = false;
  let startX = 0;

  thCell.addEventListener('mousedown', e => {
    startX = e.clientX;
    isDragging = false;

    function onFirstMove(ev) {
      if (Math.abs(ev.clientX - startX) > 5) {
        isDragging = true;
        document.removeEventListener('mousemove', onFirstMove);
        startDrag(ev);
      }
    }

    function startDrag(ev) {
      e.preventDefault();
      dragColIdx = ci;
      const table = document.getElementById('grid');
      const container = document.getElementById('tableContainer');

      const allThs = table.querySelectorAll('thead th[data-col]');
      allThs[ci]?.classList.add('dragging-col');
      const allTds = table.querySelectorAll('td[data-col="' + ci + '"]');
      allTds.forEach(td => td.classList.add('dragging-col'));

      colIndicator = document.createElement('div');
      colIndicator.className = 'drop-indicator-col';
      container.appendChild(colIndicator);

      function getDropCol(ex) {
        let best = 0;
        let bestDist = Infinity;
        allThs.forEach((th, i) => {
          const rect = th.getBoundingClientRect();
          const mid = rect.left + rect.width / 2;
          const dist = Math.abs(ex - mid);
          if (dist < bestDist) { bestDist = dist; best = i; }
          if (ex > mid) best = i + 1;
        });
        return Math.min(best, headers.length);
      }

      function onMove2(ev2) {
        const dropCol = getDropCol(ev2.clientX);
        const tableRect = container.getBoundingClientRect();
        let indicatorX;
        if (dropCol < allThs.length) {
          indicatorX = allThs[dropCol].getBoundingClientRect().left - tableRect.left;
        } else {
          const last = allThs[allThs.length - 1].getBoundingClientRect();
          indicatorX = last.right - tableRect.left;
        }
        colIndicator.style.left = indicatorX + 'px';
        colIndicator.style.height = table.getBoundingClientRect().height + 'px';
      }

      function onUp2(ev2) {
        document.removeEventListener('mousemove', onMove2);
        document.removeEventListener('mouseup', onUp2);
        if (colIndicator) { colIndicator.remove(); colIndicator = null; }

        const dropCol = getDropCol(ev2.clientX);
        if (dropCol !== dragColIdx && dropCol !== dragColIdx + 1) {
          const insertAt = dropCol > dragColIdx ? dropCol - 1 : dropCol;
          const [h] = headers.splice(dragColIdx, 1);
          headers.splice(insertAt, 0, h);
          const [a] = alignments.splice(dragColIdx, 1);
          alignments.splice(insertAt, 0, a);
          rows.forEach(row => {
            const [c] = row.splice(dragColIdx, 1);
            row.splice(insertAt, 0, c);
          });
        }
        dragColIdx = -1;
        render(); syncNow();
      }

      document.addEventListener('mousemove', onMove2);
      document.addEventListener('mouseup', onUp2);
      onMove2(ev);
    }

    function onUpEarly() {
      document.removeEventListener('mousemove', onFirstMove);
      document.removeEventListener('mouseup', onUpEarly);
    }

    document.addEventListener('mousemove', onFirstMove);
    document.addEventListener('mouseup', onUpEarly);
  });
}

// --- Drag handles to expand table ---

function setupDragHandle(handleEl, mode) {
  let startX, startY, startW, startH, cellW, cellH;

  handleEl.addEventListener('mousedown', e => {
    e.preventDefault();
    const table = document.getElementById('grid');
    const rect = table.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startW = rect.width;
    startH = rect.height;

    const firstDataCell = table.querySelector('td[data-col="0"][data-row="0"]');
    if (firstDataCell) {
      const cr = firstDataCell.getBoundingClientRect();
      cellW = cr.width;
      cellH = cr.height;
    } else {
      cellW = 80;
      cellH = 28;
    }

    let delta = 0;
    const startColCount = headers.length;
    const startRowCount = rows.length;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      if (mode === 'right' || mode === 'corner') {
        const targetDelta = Math.round(dx / cellW);
        const targetCols = Math.max(1, startColCount + targetDelta);
        while (headers.length < targetCols) {
          headers.push('');
          alignments.push('none');
          rows.forEach(r => r.push(''));
        }
        while (headers.length > targetCols && headers.length > 1) {
          headers.pop();
          alignments.pop();
          rows.forEach(r => r.pop());
        }
        render();
      }
      if (mode === 'bottom' || mode === 'corner') {
        const targetDelta = Math.round(dy / cellH);
        const targetRows = Math.max(1, startRowCount + targetDelta);
        while (rows.length < targetRows) {
          rows.push(emptyRow());
        }
        while (rows.length > targetRows && rows.length > 1) {
          rows.pop();
        }
        render();
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      syncNow();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

setupDragHandle(document.getElementById('handleRight'), 'right');
setupDragHandle(document.getElementById('handleBottom'), 'bottom');
setupDragHandle(document.getElementById('handleCorner'), 'corner');
</script>
</body>
</html>`;
}
