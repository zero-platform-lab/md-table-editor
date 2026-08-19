import * as vscode from 'vscode';
import { findTable, parseTable, serializeTable, TableRange } from './tableParser';
import { getWebviewHtml } from './webview';

let currentPanel: vscode.WebviewPanel | undefined;
let currentEditor: vscode.TextEditor | undefined;
let currentRange: TableRange | undefined;
let isInsertMode = false;

function openPanel(
  context: vscode.ExtensionContext,
  editor: vscode.TextEditor,
  headers: string[],
  rows: string[][],
  alignments: string[],
  range: TableRange | undefined,
  insertMode: boolean
) {
  currentEditor = editor;
  currentRange = range;
  isInsertMode = insertMode;

  if (currentPanel) {
    currentPanel.reveal(vscode.ViewColumn.Beside);
  } else {
    currentPanel = vscode.window.createWebviewPanel(
      'mdTableEditor',
      'Table Editor',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const nonce = getNonce();
    currentPanel.webview.html = getWebviewHtml(nonce);

    currentPanel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.type === 'apply') {
          await applyChanges(msg);
        }
      },
      undefined,
      context.subscriptions
    );

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
      currentEditor = undefined;
      currentRange = undefined;
      isInsertMode = false;
    }, null, context.subscriptions);
  }

  setTimeout(() => {
    currentPanel?.webview.postMessage({ type: 'load', headers, rows, alignments });
  }, 100);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mdTableEditor.editTable', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('エディタが開かれていません');
        return;
      }

      const doc = editor.document;
      const lines = doc.getText().split('\n');
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
    })
  );
}

async function applyChanges(msg: { headers: string[]; rows: string[][]; alignments: string[] }) {
  if (!currentEditor) return;

  const newTable = serializeTable({
    headers: msg.headers,
    rows: msg.rows,
    alignments: msg.alignments as any,
  });

  const doc = currentEditor.document;
  const edit = new vscode.WorkspaceEdit();

  if (isInsertMode || !currentRange) {
    const pos = currentEditor.selection.active;
    const lineText = doc.lineAt(pos.line).text;
    const prefix = lineText.trim().length > 0 ? '\n\n' : '';
    const suffix = '\n';
    edit.insert(doc.uri, new vscode.Position(pos.line, lineText.length), prefix + newTable + suffix);
  } else {
    const startPos = new vscode.Position(currentRange.startLine, 0);
    const endLine = currentRange.endLine;
    const endPos = new vscode.Position(endLine, doc.lineAt(endLine).text.length);
    edit.replace(doc.uri, new vscode.Range(startPos, endPos), newTable);
  }

  const ok = await vscode.workspace.applyEdit(edit);

  if (ok) {
    isInsertMode = false;
    const newLines = doc.getText().split('\n');
    const insertLine = currentRange?.startLine ?? currentEditor.selection.active.line;
    const newRange = findTable(newLines, insertLine);
    if (newRange) currentRange = newRange;
    vscode.window.showInformationMessage('テーブルを更新しました');
  } else {
    vscode.window.showErrorMessage('テーブルの更新に失敗しました');
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
