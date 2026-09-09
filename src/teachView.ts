import * as vscode from "vscode";
import { highlightLine, escapeHtml } from "./syntaxHighlight";

/**
 * A reusable webview panel that shows the comprehension ("teach") note for the
 * step the user just finished. Code inside the note is syntax-highlighted with a
 * VS Code–style palette, but the panel itself is styled to read like a plain
 * message window.
 */
export class TeachView {
    private panel: vscode.WebviewPanel | null = null;

    /** Show/refresh the teach note. Reuses a single panel so tabs don't pile up. */
    show(title: string, teach: string): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                "bbbTeach",
                "BBB — What you just wrote",
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                { enableScripts: false, retainContextWhenHidden: true },
            );
            this.panel.onDidDispose(() => {
                this.panel = null;
            });
        }
        this.panel.webview.html = renderHtml(title, teach);
        this.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    dispose(): void {
        this.panel?.dispose();
        this.panel = null;
    }
}

// ── code-line detection ────────────────────────────────────────────────────────

/** True if a line looks like code rather than prose (indented, non-bullet). */
function isCodeLine(line: string): boolean {
    if (/^\s*[-•]/.test(line)) {
        return false; // bullet
    }
    return /^\s{2,}\S/.test(line);
}

function renderBody(teach: string): string {
    const lines = teach.replace(/\r\n/g, "\n").split("\n");
    const html: string[] = [];
    let inFence = false;
    let codeBuffer: string[] = [];

    const flushCode = () => {
        if (codeBuffer.length) {
            html.push(`<pre class="code">${codeBuffer.map(highlightLine).join("\n")}</pre>`);
            codeBuffer = [];
        }
    };

    for (const raw of lines) {
        const line = raw;
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            if (!inFence) {
                flushCode();
            }
            continue;
        }
        if (inFence) {
            codeBuffer.push(line);
            continue;
        }
        if (isCodeLine(line)) {
            codeBuffer.push(line);
            continue;
        }
        flushCode();
        const trimmed = line.trim();
        if (trimmed === "") {
            html.push('<div class="gap"></div>');
        } else if (/:$/.test(trimmed) && !/^[-•]/.test(trimmed)) {
            html.push(`<div class="section">${escapeHtml(trimmed)}</div>`);
        } else if (/^[-•]/.test(trimmed)) {
            html.push(`<div class="bullet">${escapeHtml(trimmed)}</div>`);
        } else {
            html.push(`<div class="prose">${escapeHtml(trimmed)}</div>`);
        }
    }
    flushCode();
    return html.join("\n");
}

function renderHtml(title: string, teach: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body {
    margin: 0;
    padding: 18px;
    background: #0f1419;
    color: #b6f2c9;
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  .card {
    background: #161d26;
    border: 1px solid #263241;
    border-radius: 8px;
    padding: 18px 20px;
    max-width: 720px;
  }
  .title {
    color: #4aa8ff;
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .section { color: #4aa8ff; font-weight: 600; margin: 10px 0 4px; }
  .bullet { color: #b6f2c9; margin: 3px 0 3px 6px; }
  .prose { color: #b6f2c9; margin: 4px 0; }
  .gap { height: 8px; }
  pre.code {
    background: #0f1419;
    border: 1px solid #263241;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 8px 0;
    overflow-x: auto;
    font-family: "Cascadia Code", "Consolas", "Courier New", monospace;
    font-size: 13px;
    color: #f2f5f8;
    white-space: pre-wrap;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="title">✓ ${escapeHtml(title || "What you just wrote")}</div>
    ${renderBody(teach)}
  </div>
</body>
</html>`;
}
