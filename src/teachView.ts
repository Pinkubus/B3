import * as vscode from "vscode";

/**
 * A reusable webview panel that shows the comprehension ("teach") note for the
 * step the user just finished. Code inside the note is syntax-highlighted with
 * the same palette as DoubleChecker's flashcards.py, but the panel itself is
 * styled to read like a plain message window.
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

// ── syntax palette (mirrors flashcards.py) ──────────────────────────────────

const COLORS = {
    keyword: "#569cd6",
    builtin: "#4ec9b0",
    string: "#ce9178",
    comment: "#6a9955",
    number: "#b5cea8",
    funcname: "#dcdcaa",
    ident: "#9cdcfe",
    op: "#c586c0",
    plain: "#f2f5f8",
};

const KEYWORDS = new Set([
    // JavaScript
    "await", "async", "break", "case", "catch", "class", "const", "continue",
    "default", "delete", "do", "else", "export", "extends", "finally", "for",
    "function", "if", "import", "in", "instanceof", "let", "new", "of", "return",
    "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while",
    "yield", "true", "false", "null", "undefined",
    // Python extras
    "and", "as", "assert", "def", "elif", "except", "from", "global", "is",
    "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "True", "False",
    "with",
]);

const BUILTINS = new Set([
    "document", "window", "console", "Set", "Map", "Array", "Object", "String",
    "Number", "Boolean", "JSON", "Math", "Promise", "Element", "Node",
    "querySelector", "querySelectorAll", "getElementById", "getElementsByClassName",
    "createElement", "appendChild", "addEventListener", "forEach", "map", "filter",
    "push", "has", "add", "includes",
    // Python builtins that may appear
    "print", "len", "range", "list", "dict", "set", "int", "str", "float", "bool",
    "enumerate", "zip", "sorted", "open",
]);

const TOKEN_RE =
    /(?<comment>\/\/[^\n]*|#[^\n]*)|(?<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(?<number>\b\d+(?:\.\d+)?\b)|(?<ident>[A-Za-z_$][\w$]*)|(?<op>=>|===|!==|==|!=|>=|<=|->|:=|[-+*/%=<>!&|.]+)|(?<other>[\s\S])/g;

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(color: string, text: string): string {
    return `<span style="color:${color}">${escapeHtml(text)}</span>`;
}

/** Tokenise a line of code and return HTML with per-token colour spans. */
function highlight(code: string): string {
    let out = "";
    let nextIsFuncName = false;
    // Re-create the regex per call so lastIndex state never leaks.
    const re = new RegExp(TOKEN_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
        const g = m.groups!;
        const text = m[0];
        if (g.comment !== undefined) {
            out += span(COLORS.comment, text);
            nextIsFuncName = false;
        } else if (g.string !== undefined) {
            out += span(COLORS.string, text);
            nextIsFuncName = false;
        } else if (g.number !== undefined) {
            out += span(COLORS.number, text);
            nextIsFuncName = false;
        } else if (g.ident !== undefined) {
            // Peek past whitespace for a '(' to spot a function call/name.
            const rest = code.slice(re.lastIndex);
            const followedByParen = /^\s*\(/.test(rest);
            if (nextIsFuncName || followedByParen) {
                out += span(COLORS.funcname, text);
                nextIsFuncName = false;
            } else if (KEYWORDS.has(text)) {
                out += span(COLORS.keyword, text);
                nextIsFuncName = text === "def" || text === "function";
            } else if (BUILTINS.has(text)) {
                out += span(COLORS.builtin, text);
                nextIsFuncName = false;
            } else {
                out += span(COLORS.ident, text);
                nextIsFuncName = false;
            }
        } else if (g.op !== undefined) {
            out += span(COLORS.op, text);
            nextIsFuncName = false;
        } else {
            out += escapeHtml(text);
            if (text.trim()) {
                nextIsFuncName = false;
            }
        }
    }
    return out;
}

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
            html.push(`<pre class="code">${codeBuffer.map(highlight).join("\n")}</pre>`);
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
