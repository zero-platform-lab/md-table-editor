import * as vscode from 'vscode';
import { findAllTables, findTable, findTableByHeaders, parseTable, serializeTable, TableRange } from './tableParser';
import { getWebviewHtml } from './webview';

interface PanelState {
  panel: vscode.WebviewPanel;
  docUri: vscode.Uri;
  range: TableRange | undefined;
  headerSig: string;
  isInsertMode: boolean;
  id: string;
}

const panels: Map<string, PanelState> = new Map();
let isSelfEdit = false;
let panelIdCounter = 0;

function headerSig(headers: string[]): string {
  return headers.join('\x00');
}

function getEditor(uri: vscode.Uri): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
}

function getDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
}

function findExistingPanel(uri: vscode.Uri, range: TableRange | undefined): PanelState | undefined {
  if (!range) return undefined;
  for (const state of panels.values()) {
    if (state.docUri.toString() !== uri.toString()) continue;
    if (state.range && state.range.startLine === range.startLine) return state;
  }
  return undefined;
}

function openPanel(
  context: vscode.ExtensionContext,
  editor: vscode.TextEditor,
  headers: string[],
  rows: string[][],
  alignments: string[],
  range: TableRange | undefined,
  insertMode: boolean
) {
  const existing = findExistingPanel(editor.document.uri, range);
  if (existing) {
    existing.panel.reveal(vscode.ViewColumn.Beside);
    existing.range = range;
    existing.headerSig = headerSig(headers);
    existing.panel.webview.postMessage({ type: 'load', headers, rows, alignments });
    return;
  }

  const id = 'panel_' + (++panelIdCounter);
  const tableIndex = insertMode ? 'New' : String(getTableIndex(editor.document, range));
  const title = 'Table ' + tableIndex;
  const panel = vscode.window.createWebviewPanel(
    'mdTableEditor',
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = getNonce();
  panel.webview.html = getWebviewHtml(nonce);

  const state: PanelState = {
    panel,
    docUri: editor.document.uri,
    range,
    headerSig: headerSig(headers),
    isInsertMode: insertMode,
    id,
  };
  panels.set(id, state);

  panel.webview.onDidReceiveMessage(
    async (msg) => {
      if (msg.type === 'apply') {
        state.headerSig = headerSig(msg.headers);
        await applyChanges(state, msg);
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(() => {
    panels.delete(id);
  }, null, context.subscriptions);

  setTimeout(() => {
    panel.webview.postMessage({ type: 'load', headers, rows, alignments });
  }, 100);
}

class TableCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== 'markdown') return [];
    const lines = document.getText().split('\n');
    const tables = findAllTables(lines);
    return tables.map(range => {
      const codeLens = new vscode.CodeLens(
        new vscode.Range(range.startLine, 0, range.startLine, 0)
      );
      codeLens.command = {
        title: '$(edit) Edit Table',
        command: 'mdTableEditor.editTableAt',
        arguments: [document.uri, range.startLine],
      };
      return codeLens;
    });
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { language: 'markdown' },
      new TableCodeLensProvider()
    ),

    vscode.commands.registerCommand('mdTableEditor.editTableAt', (uri: vscode.Uri, line: number) => {
      const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
        ?? vscode.window.activeTextEditor;
      if (!editor) return;

      const lines = editor.document.getText().split('\n');
      const range = findTable(lines, line);
      if (!range) return;

      const tableData = parseTable(lines, range);
      openPanel(context, editor, tableData.headers, tableData.rows, tableData.alignments, range, false);
    }),

    vscode.commands.registerCommand('mdTableEditor.editTable', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('エディタが開かれていません');
        return;
      }

      const lines = editor.document.getText().split('\n');
      const cursorLine = editor.selection.active.line;

      const range = findTable(lines, cursorLine);
      if (!range) {
        vscode.window.showWarningMessage('カーソル位置にMarkdownテーブルが見つかりません。新規作成は「New Table」を使ってください。');
        return;
      }

      const tableData = parseTable(lines, range);
      openPanel(context, editor, tableData.headers, tableData.rows, tableData.alignments, range, false);
    }),

    vscode.commands.registerCommand('mdTableEditor.newTable', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('エディタが開かれていません');
        return;
      }

      const headers = ['列1', '列2', '列3'];
      const rows = [['', '', '']];
      const alignments = ['none', 'none', 'none'];

      openPanel(context, editor, headers, rows, alignments, undefined, true);
    }),

    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isSelfEdit) return;

      for (const state of panels.values()) {
        if (e.document.uri.toString() !== state.docUri.toString()) continue;
        if (!state.range) continue;

        const lines = e.document.getText().split('\n');

        let range = findTable(lines, state.range.startLine);
        if (!range) {
          range = findTableByHeaders(lines, state.headerSig.split('\x00'));
        }
        if (!range) {
          state.panel.webview.postMessage({ type: 'tableDeleted' });
          continue;
        }

        state.range = range;
        const tableData = parseTable(lines, range);
        state.panel.webview.postMessage({
          type: 'update',
          headers: tableData.headers,
          rows: tableData.rows,
          alignments: tableData.alignments,
        });
      }
    })
  );
}

async function applyChanges(state: PanelState, msg: { headers: string[]; rows: string[][]; alignments: string[] }) {
  const newTable = serializeTable({
    headers: msg.headers,
    rows: msg.rows,
    alignments: msg.alignments as any,
  });

  const doc = getDocument(state.docUri);
  if (!doc) return;
  const editor = getEditor(state.docUri);
  const edit = new vscode.WorkspaceEdit();

  if (state.isInsertMode || !state.range) {
    if (!editor) return;
    const pos = editor.selection.active;
    const lineText = doc.lineAt(pos.line).text;
    const prefix = lineText.trim().length > 0 ? '\n\n' : '';
    const suffix = '\n';
    edit.insert(state.docUri, new vscode.Position(pos.line, lineText.length), prefix + newTable + suffix);
  } else {
    const lines = doc.getText().split('\n');
    let range = findTable(lines, state.range.startLine);
    if (!range) {
      range = findTableByHeaders(lines, state.headerSig.split('\x00'));
    }
    if (!range) return;
    state.range = range;

    const startPos = new vscode.Position(range.startLine, 0);
    const endPos = new vscode.Position(range.endLine, doc.lineAt(range.endLine).text.length);
    edit.replace(state.docUri, new vscode.Range(startPos, endPos), newTable);
  }

  isSelfEdit = true;
  const ok = await vscode.workspace.applyEdit(edit);
  isSelfEdit = false;

  if (ok) {
    state.isInsertMode = false;
    const newLines = doc.getText().split('\n');
    const insertLine = state.range?.startLine ?? (editor?.selection.active.line ?? 0);
    const newRange = findTable(newLines, insertLine);
    if (newRange) state.range = newRange;

    refreshAllRanges(doc);
  }
}

function refreshAllRanges(doc: vscode.TextDocument) {
  const lines = doc.getText().split('\n');
  for (const state of panels.values()) {
    if (state.docUri.toString() !== doc.uri.toString()) continue;
    if (!state.range || state.isInsertMode) continue;

    let range = findTable(lines, state.range.startLine);
    if (!range) {
      range = findTableByHeaders(lines, state.headerSig.split('\x00'));
    }
    if (range) state.range = range;
  }
}

function getTableIndex(doc: vscode.TextDocument, range: TableRange | undefined): number {
  if (!range) return 0;
  const lines = doc.getText().split('\n');
  const tables = findAllTables(lines);
  for (let i = 0; i < tables.length; i++) {
    if (tables[i].startLine === range.startLine) return i + 1;
  }
  return 0;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function deactivate() {}
