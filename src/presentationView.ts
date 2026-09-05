import * as vscode from "vscode";

/**
 * "Presentation mode" panel: a persistent webview showing the full,
 * untruncated instructions for the active step. Meant to be dragged out to
 * a second monitor (VS Code lets any tab be detached into its own OS window),
 * so the editor and the instructions can be viewed side by side. Content is
 * re-rendered in place each time the step changes — the panel itself never
 * needs to be recreated once the user has moved it.
 */
export class PresentationView {
    private panel: vscode.WebviewPanel | null = null;

    /** Show the full instructions for the step currently active. */
    showStep(position: string, description: string, promptText: string): void {
        this.render(
            `BBB ${position}`,
            `<h2>${escapeHtml(description)}</h2>
             <pre>${escapeHtml(promptText)}</pre>`,
        );
    }

    /** Show why the current step's verification is failing. */
    showCannotAdvance(reason: string, detail?: string): void {
        this.render(
            "BBB — Cannot advance",
            `<h2 class="warn">${escapeHtml(reason)}</h2>
             ${detail ? `<pre>${escapeHtml(detail)}</pre>` : ""}`,
        );
    }

    /** Show the "lesson complete / waiting for more steps" state. */
    showFinished(tooltip: string): void {
        this.render("BBB — Lesson complete", `<p>${escapeHtml(tooltip)}</p>`);
    }

    private render(title: string, bodyHtml: string): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                "bbbPresentation",
                "BBB — Instructions",
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                { enableScripts: false, retainContextWhenHidden: true },
            );
            this.panel.onDidDispose(() => {
                this.panel = null;
            });
        }
        this.panel.webview.html = renderHtml(title, bodyHtml);
        this.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    dispose(): void {
        this.panel?.dispose();
        this.panel = null;
    }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderHtml(title: string, bodyHtml: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: var(--vscode-font-family);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    padding: 32px;
    font-size: 1.4em;
    line-height: 1.5;
  }
  h1 { font-size: 0.8em; opacity: 0.65; margin: 0 0 1.2em 0; }
  h2 { font-size: 1.1em; margin: 0 0 0.6em 0; }
  h2.warn { color: var(--vscode-errorForeground); }
  pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 16px;
    border-radius: 6px;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.9em;
  }
  .hint { opacity: 0.6; font-size: 0.55em; margin-top: 3em; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${bodyHtml}
  <p class="hint">Drag this tab to a second monitor to detach it into its own window. Ctrl+Alt+. to advance.</p>
</body>
</html>`;
}
