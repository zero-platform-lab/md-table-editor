import * as vscode from 'vscode';
import { findAllTables, findTable, findTableByHeaders, parseTable, serializeTable, TableRange } from './tableParser';
import { getWebviewHtml } from './webview';

interface PanelState {
  panel: vscode.WebviewPanel;
  editor: vscode.TextEditor;
  range: TableRange | undefined;
  headerSig: string;
  isInsertMode: boolean;
}

const panels: Map<string, PanelState> = new Map();
let isSelfEdit = false;

function headerSig(headers: string[]): string {
  return headers.join('\x00');
}

function panelKey(uri: vscode.Uri, sig: string): string {
  return uri.toString() + '\x01' + sig;
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
  const sig = headerSig(headers);
  const key = panelKey(editor.document.uri, sig);

  const existing = panels.get(key);
  if (existing) {
    existing.panel.reveal(vscode.ViewColumn.Beside);
    existing.range = range;
    existing.panel.webview.postMessage({ type: 'load', headers, rows, alignments });
    return;
  }

  const title = headers.slice(0, 3).join(' | ');
  const panel = vscode.window.createWebviewPanel(
    'mdTableEditor',
    title || 'Table Editor',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const nonce = getNonce();
  panel.webview.html = getWebviewHtml(nonce);

  const state: PanelState = {
    panel,
    editor,
    range,
    headerSig: sig,
    isInsertMode: insertMode,
  };
  panels.set(key, state);

  panel.webview.onDidReceiveMessage(
    async (msg) => {
      if (msg.type === 'apply') {
        const newSig = headerSig(msg.headers);
        if (newSig !== state.headerSig) {
          panels.delete(key);
          state.headerSig = newSig;
          panels.set(panelKey(editor.document.uri, newSig), state);
          panel.title = msg.headers.slice(0, 3).join(' | ') || 'Table Editor';
        }
        await applyChanges(state, msg);
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(() => {
    panels.delete(panelKey(editor.document.uri, state.headerSig));
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
        if (e.document !== state.editor.document) continue;
        if (!state.range) continue;

        const lines = e.document.getText().split('\n');

        let range = findTable(lines, state.range.startLine);
        if (!range) {
          range = findTableByHeaders(lines, state.headerSig.split('\x00'));
        }
        if (!range) continue;

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

  const doc = state.editor.document;
  const edit = new vscode.WorkspaceEdit();

  if (state.isInsertMode || !state.range) {
    const pos = state.editor.selection.active;
    const lineText = doc.lineAt(pos.line).text;
    const prefix = lineText.trim().length > 0 ? '\n\n' : '';
    const suffix = '\n';
    edit.insert(doc.uri, new vscode.Position(pos.line, lineText.length), prefix + newTable + suffix);
  } else {
    const startPos = new vscode.Position(state.range.startLine, 0);
    const endLine = state.range.endLine;
    const endPos = new vscode.Position(endLine, doc.lineAt(endLine).text.length);
    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newTable);
  }

  isSelfEdit = true;
  const ok = await vscode.workspace.applyEdit(edit);
  isSelfEdit = false;

  if (ok) {
    state.isInsertMode = false;
    const newLines = doc.getText().split('\n');
    const insertLine = state.range?.startLine ?? state.editor.selection.active.line;
    const newRange = findTable(newLines, insertLine);
    if (newRange) state.range = newRange;
  }
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
