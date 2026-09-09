import * as vscode from "vscode";
import { highlightBlock, colorLegendHtml, escapeHtml } from "./syntaxHighlight";

/**
 * "Presentation mode" panel: a persistent webview showing the full,
 * untruncated instructions for the active step. Meant to be dragged out to
 * a second monitor (VS Code lets any tab be detached into its own OS window),
 * so the editor and the instructions can be viewed side by side. Content is
 * re-rendered in place each time the step changes — the panel itself never
 * needs to be recreated once the user has moved it.
 *
 * The panel is split into two halves: the top half shows the current step
 * (or cannot-advance / finished state), and the bottom half persistently
 * shows the step's "why" explanation and any code-breakdown ("teach") note.
 */
export class PresentationView {
    private panel: vscode.WebviewPanel | null = null;
    private topHtml = "";
    private explainHtml = "";
    private teachHtml = "";

    /**
     * Show the full instructions for the step currently active. `code`, when
     * given, is rendered as syntax-highlighted monospace text (with a color
     * legend) instead of being folded into the plain instruction text.
     */
    showStep(position: string, description: string, instruction: string, code?: string): void {
        this.topHtml = `<h1>BBB ${position}</h1>
            <h2>${escapeHtml(description)}</h2>
            <p class="instruction">${escapeHtml(instruction)}</p>
            ${code ? `<pre class="code">${highlightBlock(code)}</pre>${colorLegendHtml()}` : ""}`;
        this.render();
    }

    /** Show why the current step's verification is failing. */
    showCannotAdvance(reason: string, detail?: string): void {
        this.topHtml = `<h1>BBB — Cannot advance</h1>
            <h2 class="warn">${escapeHtml(reason)}</h2>
            ${detail ? `<pre class="detail">${escapeHtml(detail)}</pre>` : ""}`;
        this.render();
    }

    /** Show the "lesson complete / waiting for more steps" state. */
    showFinished(tooltip: string): void {
        this.topHtml = `<h1>BBB — Lesson complete</h1><p>${escapeHtml(tooltip)}</p>`;
        this.explainHtml = "";
        this.teachHtml = "";
        this.render();
    }

    /** Update the persistent "why" section in the lower half for the current step. */
    showExplain(why: string): void {
        this.explainHtml = why
            ? `<h3>Why</h3><pre>${escapeHtml(why)}</pre>`
            : "";
        this.render();
    }

    /**
     * Update the lower half with a code-breakdown ("teach") note. Left in place
     * across later steps (rather than cleared on every activation) so it isn't
     * overwritten by the next step's "why" before it can be read.
     */
    showTeach(description: string, text: string): void {
        this.teachHtml = text
            ? `<h3>Code breakdown — ${escapeHtml(description)}</h3><pre>${escapeHtml(text)}</pre>`
            : "";
        this.render();
    }

    private render(): void {
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
            // Only reveal on first creation — calling reveal() with a viewColumn on later
            // updates would snap the panel back into the main window's grid, undoing a
            // user's drag to a second monitor.
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }
        this.panel.webview.html = renderHtml(this.topHtml, this.explainHtml + this.teachHtml);
    }

    dispose(): void {
        this.panel?.dispose();
        this.panel = null;
    }
}

function renderHtml(topHtml: string, bottomHtml: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  html, body {
    height: 100%;
  }
  * {
    box-sizing: border-box;
  }
  body {
    font-family: var(--vscode-font-family);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-size: 1.4em;
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    overflow-wrap: anywhere;
  }
  .pane {
    padding: 32px;
    overflow: auto;
  }
  #top {
    flex: 1 1 60%;
  }
  #bottom {
    flex: 0 0 auto;
    max-height: 40%;
    border-top: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  h1 { font-size: 0.8em; opacity: 0.65; margin: 0 0 1.2em 0; }
  h2 { font-size: 1.1em; margin: 0 0 0.6em 0; }
  h2.warn { color: var(--vscode-errorForeground); }
  h3 { font-size: 0.85em; opacity: 0.8; margin: 0 0 0.6em 0; }
  .instruction { margin: 0 0 0.6em 0; }
  pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 16px;
    border-radius: 6px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    overflow-x: auto;
    font-size: 0.9em;
  }
  pre.code {
    font-family: "Cascadia Code", "Consolas", "Courier New", monospace;
    font-size: 15px;
    line-height: 1.5;
  }
  pre.detail {
    font-size: 0.6em;
    overflow-wrap: anywhere;
  }
  .legend {
    margin-top: 8px;
    font-size: 13px;
    opacity: 0.75;
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
  }
  .legend-item { white-space: nowrap; }
  .hint { opacity: 0.6; font-size: 0.55em; margin-top: 3em; }

  /* Narrower panel (e.g. half a screen, viewed up close rather than from a
     second monitor at a distance) — trim the oversized presentation-mode
     defaults so more fits without excess wrapping/scrolling. */
  @media (max-width: 900px) {
    body { font-size: 1.1em; }
    .pane { padding: 16px; }
    pre { padding: 12px; }
    pre.code { font-size: 13px; }
    .legend { font-size: 12px; gap: 10px; }
  }
</style>
</head>
<body>
  <div id="top" class="pane">
    ${topHtml}
    <p class="hint">Drag this tab to a second monitor to detach it into its own window. Ctrl+Alt+. to advance.</p>
  </div>
  <div id="bottom" class="pane">
    ${bottomHtml}
  </div>
</body>
</html>`;
}
