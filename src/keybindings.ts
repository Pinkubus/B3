/**
 * Built-in defaults for VS Code keybindings on Windows/Linux.
 * Used as a fallback when we cannot read the user's keybindings.json.
 * Only commands referenced by the lesson engine need entries here.
 */
const DEFAULT_KEYBINDINGS_WIN_LINUX: Record<string, string> = {
    "workbench.action.gotoLine": "Ctrl+G",
    "workbench.action.quickOpen": "Ctrl+P",
    "workbench.action.focusActiveEditorGroup": "Ctrl+1",
    "workbench.action.nextEditor": "Ctrl+PageDown",
    "workbench.action.previousEditor": "Ctrl+PageUp",
    "workbench.action.chat.open": "Ctrl+Alt+I",
    "workbench.action.closeSidebar": "Ctrl+B",
    "workbench.action.closePanel": "Ctrl+J",
};

const DEFAULT_KEYBINDINGS_MAC: Record<string, string> = {
    "workbench.action.gotoLine": "Cmd+G", // actually Ctrl+G on mac too in vscode, but kept for completeness
    "workbench.action.quickOpen": "Cmd+P",
    "workbench.action.focusActiveEditorGroup": "Cmd+1",
    "workbench.action.nextEditor": "Cmd+Option+Right",
    "workbench.action.previousEditor": "Cmd+Option+Left",
    "workbench.action.chat.open": "Cmd+Ctrl+I",
    "workbench.action.closeSidebar": "Cmd+B",
    "workbench.action.closePanel": "Cmd+J",
};

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

interface UserKeybinding {
    key?: string;
    command?: string;
    when?: string;
}

/**
 * Resolves the keyboard shortcut for a given VS Code command id.
 * Reads the user's keybindings.json (overrides win) and falls back to built-in defaults.
 *
 * Note: VS Code does not expose a public API to query command -> keybinding,
 * so we read the user customisations file directly. This is best-effort.
 */
export class KeybindingResolver {
    private userOverrides: Record<string, string> = {};
    private readonly defaults: Record<string, string>;

    constructor() {
        this.defaults =
            process.platform === "darwin"
                ? DEFAULT_KEYBINDINGS_MAC
                : DEFAULT_KEYBINDINGS_WIN_LINUX;
        this.loadUserKeybindings();
    }

    public refresh(): void {
        this.userOverrides = {};
        this.loadUserKeybindings();
    }

    public forCommand(commandId: string): string {
        return this.userOverrides[commandId] ?? this.defaults[commandId] ?? "(unbound)";
    }

    private loadUserKeybindings(): void {
        const file = this.userKeybindingsPath();
        if (!file || !fs.existsSync(file)) {
            return;
        }
        try {
            const raw = fs.readFileSync(file, "utf8");
            const stripped = stripJsonComments(raw);
            const parsed: UserKeybinding[] = JSON.parse(stripped || "[]");
            for (const entry of parsed) {
                if (!entry.command || !entry.key) {
                    continue;
                }
                // Skip negative bindings (e.g. "-editor.action.foo") and when-clauses we can't evaluate.
                if (entry.command.startsWith("-")) {
                    continue;
                }
                this.userOverrides[entry.command] = humanize(entry.key);
            }
        } catch {
            // Ignore malformed file; defaults still apply.
        }
    }

    private userKeybindingsPath(): string | undefined {
        const home = os.homedir();
        if (process.platform === "win32") {
            return path.join(home, "AppData", "Roaming", "Code", "User", "keybindings.json");
        }
        if (process.platform === "darwin") {
            return path.join(home, "Library", "Application Support", "Code", "User", "keybindings.json");
        }
        return path.join(home, ".config", "Code", "User", "keybindings.json");
    }
}

function humanize(key: string): string {
    // VS Code stores keys like "ctrl+shift+p" — capitalise for display.
    return key
        .split(/\s+/)
        .map((chord) =>
            chord
                .split("+")
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join("+"),
        )
        .join(" ");
}

/**
 * Very small JSON-with-comments stripper sufficient for keybindings.json.
 * Removes // line comments and /* block *\/ comments outside strings.
 */
function stripJsonComments(input: string): string {
    let out = "";
    let i = 0;
    let inString = false;
    let stringChar = "";
    while (i < input.length) {
        const c = input[i];
        const next = input[i + 1];
        if (inString) {
            out += c;
            if (c === "\\" && i + 1 < input.length) {
                out += input[i + 1];
                i += 2;
                continue;
            }
            if (c === stringChar) {
                inString = false;
            }
            i++;
            continue;
        }
        if (c === '"' || c === "'") {
            inString = true;
            stringChar = c;
            out += c;
            i++;
            continue;
        }
        if (c === "/" && next === "/") {
            while (i < input.length && input[i] !== "\n") {
                i++;
            }
            continue;
        }
        if (c === "/" && next === "*") {
            i += 2;
            while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
                i++;
            }
            i += 2;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}
