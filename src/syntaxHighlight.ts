/**
 * Small multi-language (JS/Python) syntax tokenizer shared by any webview that
 * needs VS Code–style colorized code without a real language server.
 */

export const SYNTAX_COLORS = {
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

export function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(color: string, text: string): string {
    return `<span style="color:${color}">${escapeHtml(text)}</span>`;
}

/** Tokenise a line of code and return HTML with per-token colour spans. */
export function highlightLine(code: string): string {
    let out = "";
    let nextIsFuncName = false;
    // Re-create the regex per call so lastIndex state never leaks.
    const re = new RegExp(TOKEN_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
        const g = m.groups!;
        const text = m[0];
        if (g.comment !== undefined) {
            out += span(SYNTAX_COLORS.comment, text);
            nextIsFuncName = false;
        } else if (g.string !== undefined) {
            out += span(SYNTAX_COLORS.string, text);
            nextIsFuncName = false;
        } else if (g.number !== undefined) {
            out += span(SYNTAX_COLORS.number, text);
            nextIsFuncName = false;
        } else if (g.ident !== undefined) {
            // Peek past whitespace for a '(' to spot a function call/name.
            const rest = code.slice(re.lastIndex);
            const followedByParen = /^\s*\(/.test(rest);
            if (nextIsFuncName || followedByParen) {
                out += span(SYNTAX_COLORS.funcname, text);
                nextIsFuncName = false;
            } else if (KEYWORDS.has(text)) {
                out += span(SYNTAX_COLORS.keyword, text);
                nextIsFuncName = text === "def" || text === "function";
            } else if (BUILTINS.has(text)) {
                out += span(SYNTAX_COLORS.builtin, text);
                nextIsFuncName = false;
            } else {
                out += span(SYNTAX_COLORS.ident, text);
                nextIsFuncName = false;
            }
        } else if (g.op !== undefined) {
            out += span(SYNTAX_COLORS.op, text);
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

/** Highlight a (possibly multi-line) code block, one line at a time. */
export function highlightBlock(code: string): string {
    return code.replace(/\r\n/g, "\n").split("\n").map(highlightLine).join("\n");
}

/** A small legend explaining what each syntax color represents. */
export function colorLegendHtml(): string {
    const entries: [string, string][] = [
        [SYNTAX_COLORS.keyword, "keyword"],
        [SYNTAX_COLORS.builtin, "built-in"],
        [SYNTAX_COLORS.funcname, "function name"],
        [SYNTAX_COLORS.string, "string"],
        [SYNTAX_COLORS.number, "number"],
        [SYNTAX_COLORS.comment, "comment"],
        [SYNTAX_COLORS.ident, "identifier"],
        [SYNTAX_COLORS.op, "operator"],
    ];
    const items = entries
        .map(([color, label]) => `<span class="legend-item"><span style="color:${color}">\u25A0</span> ${label}</span>`)
        .join("");
    return `<div class="legend">${items}</div>`;
}
