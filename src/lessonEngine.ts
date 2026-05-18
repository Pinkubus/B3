import * as vscode from "vscode";
import { KeybindingResolver } from "./keybindings";

/**
 * A single user-facing action they need to perform to advance the lesson.
 * The executor watches editor state to detect completion automatically
 * (we cannot reliably intercept raw keystrokes from other extensions/VS Code itself).
 */
export type Step =
    | { kind: "focusEditor"; hint: string }
    | { kind: "openFile"; uri: vscode.Uri; hint: string }
    | { kind: "gotoLine"; line: number; hint: string } // 1-based
    | { kind: "expectIndent"; line: number; spaces: number; hint: string }
    | { kind: "typeChar"; line: number; column: number; char: string; hint: string } // 0-based positions
    | { kind: "pressEnter"; line: number; hint: string };

export interface TargetEdit {
    uri: vscode.Uri;
    /** 1-based line number where insertion begins. */
    startLine: number;
    /** Text to insert. May contain \n. Leading whitespace on each line is treated as indentation. */
    text: string;
}

/**
 * Expand a TargetEdit into the ordered list of steps the user must perform.
 */
export function buildLesson(edit: TargetEdit, kb: KeybindingResolver): Step[] {
    const steps: Step[] = [];

    steps.push({
        kind: "focusEditor",
        hint: `Focus the editor — press ${kb.forCommand("workbench.action.focusActiveEditorGroup")}`,
    });

    steps.push({
        kind: "openFile",
        uri: edit.uri,
        hint: `Open ${vscode.workspace.asRelativePath(edit.uri)} — press ${kb.forCommand("workbench.action.quickOpen")} and type the filename`,
    });

    steps.push({
        kind: "gotoLine",
        line: edit.startLine,
        hint: `Go to line ${edit.startLine} — press ${kb.forCommand("workbench.action.gotoLine")} then type ${edit.startLine}`,
    });

    const lines = edit.text.split(/\r?\n/);
    let currentLine = edit.startLine;

    for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li];
        const indentMatch = lineText.match(/^(\s*)/);
        const indentSpaces = indentMatch ? indentMatch[1].length : 0;
        const body = lineText.slice(indentSpaces);

        if (indentSpaces > 0) {
            steps.push({
                kind: "expectIndent",
                line: currentLine,
                spaces: indentSpaces,
                hint: `Indent ${indentSpaces} space${indentSpaces === 1 ? "" : "s"} (press Tab as needed)`,
            });
        }

        for (let ci = 0; ci < body.length; ci++) {
            const ch = body[ci];
            steps.push({
                kind: "typeChar",
                line: currentLine,
                column: indentSpaces + ci,
                char: ch,
                hint: `Type: ${displayChar(ch)}`,
            });
        }

        if (li < lines.length - 1) {
            steps.push({
                kind: "pressEnter",
                line: currentLine,
                hint: "Press Enter for a new line",
            });
            currentLine++;
        }
    }

    return steps;
}

function displayChar(ch: string): string {
    if (ch === " ") {
        return "␣ (space)";
    }
    if (ch === "\t") {
        return "⇥ (tab)";
    }
    return `'${ch}'`;
}
