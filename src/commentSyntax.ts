/**
 * Comment-syntax lookup for the languages BBB explanations need to render in.
 * Only line-comment prefixes are supported in v0.2 — block comments add edge
 * cases (nested fences, languages with no line comment, etc.) we don't need yet.
 */
const LINE_COMMENT: Record<string, string> = {
    python: "#",
    ruby: "#",
    shellscript: "#",
    powershell: "#",
    perl: "#",
    yaml: "#",
    toml: "#",
    makefile: "#",
    dockerfile: "#",
    r: "#",
    elixir: "#",

    javascript: "//",
    javascriptreact: "//",
    typescript: "//",
    typescriptreact: "//",
    java: "//",
    c: "//",
    cpp: "//",
    csharp: "//",
    go: "//",
    rust: "//",
    swift: "//",
    kotlin: "//",
    scala: "//",
    php: "//",
    dart: "//",
    groovy: "//",
    objective: "//",

    sql: "--",
    lua: "--",
    haskell: "--",
    ada: "--",

    clojure: ";",
    lisp: ";",
    scheme: ";",

    erlang: "%",
    latex: "%",
    tex: "%",

    vb: "'",
};

/**
 * Returns the line-comment prefix for a VS Code languageId, or `#` as a
 * reasonable fallback (Python-style is the most widely-recognised).
 */
export function commentPrefix(languageId: string): string {
    return LINE_COMMENT[languageId] ?? "#";
}

/**
 * Formats a multi-line explanation as comment lines, indented to match the
 * code chunk it sits below.
 */
export function formatExplanation(
    languageId: string,
    explanation: string,
    indentSpaces: number,
): string[] {
    const prefix = commentPrefix(languageId);
    const pad = " ".repeat(indentSpaces);
    return explanation
        .split(/\r?\n/)
        .map((line) => (line.trim() === "" ? `${pad}${prefix}` : `${pad}${prefix} ${line}`));
}
