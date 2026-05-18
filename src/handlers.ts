import * as vscode from "vscode";
import * as path from "path";
import { PlaybookStep, EditStep, TerminalStep, OpenStep, GotoStep } from "./playbookParser";
import { formatExplanation } from "./commentSyntax";
import { KeybindingResolver } from "./keybindings";

/**
 * Context the runner passes to each handler. Lets handlers read/update shared
 * state (line-offset accumulator, terminal-exec history) without depending on
 * the runner class directly.
 */
export interface HandlerContext {
    playbookUri: vscode.Uri;
    keybindings: KeybindingResolver;
    /** Lines BBB has inserted into a target file (keyed by absolute URI string). */
    getLineOffset(file: string): number;
    addLineOffset(file: string, delta: number): void;
    /** Snapshot the current terminal-exec count so verify() can ask "since when?" */
    snapshotTerminalExecutions(): number;
    /** All terminal command lines recorded since the given snapshot. */
    terminalExecutionsSince(snapshot: number): string[];
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export interface StepHandler<S extends PlaybookStep = PlaybookStep> {
    /** Optional setup before the prompt is shown (e.g. edit step inserts the explanation). */
    activate?(step: S, ctx: HandlerContext, snapshot: StepSnapshot): Promise<void> | void;
    /** Status-bar message shown while the step is active. */
    prompt(step: S, ctx: HandlerContext, snapshot: StepSnapshot): string;
    /** Called when the user presses Ctrl+Alt+. */
    verify(step: S, ctx: HandlerContext, snapshot: StepSnapshot): Promise<VerifyResult>;
}

/**
 * Captured at the moment a step activates so the step's prompt + verify see
 * a stable view of the world even if activate() mutates shared state
 * (e.g. inserting an explanation bumps the line offset for *future* steps,
 * not this one).
 */
export interface StepSnapshot {
    terminalExecCount: number;
    /** Per-file line offsets as they were when this step started. */
    lineOffsets: Record<string, number>;
}

// ---------- helpers ----------

function workspaceUriForFile(playbookUri: vscode.Uri, relOrAbs: string): vscode.Uri {
    if (path.isAbsolute(relOrAbs)) {
        return vscode.Uri.file(relOrAbs);
    }
    // Resolve relative to the workspace folder that contains the playbook.
    const folder = vscode.workspace.getWorkspaceFolder(playbookUri);
    const base = folder?.uri ?? vscode.Uri.file(path.dirname(playbookUri.fsPath));
    return vscode.Uri.joinPath(base, relOrAbs);
}

async function ensureLineExists(doc: vscode.TextDocument, zeroBasedLine: number): Promise<void> {
    if (doc.lineCount > zeroBasedLine) {
        return;
    }
    const needed = zeroBasedLine + 1 - doc.lineCount;
    const edit = new vscode.WorkspaceEdit();
    const endPos = new vscode.Position(doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length);
    edit.insert(doc.uri, endPos, "\n".repeat(needed));
    await vscode.workspace.applyEdit(edit);
}

// ---------- edit ----------

export const editHandler: StepHandler<EditStep> = {
    async activate(step, ctx, snapshot) {
        if (!step.explain) {
            return;
        }
        const uri = workspaceUriForFile(ctx.playbookUri, step.file);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preserveFocus: false });

        const offset = snapshot.lineOffsets[uri.toString()] ?? 0;
        const targetZero = step.line - 1 + offset;

        // Make sure the typing line exists; the comment goes on the line *below* it.
        await ensureLineExists(doc, targetZero);

        const commentLines = formatExplanation(doc.languageId, step.explain, step.indent);
        // Insert at end of the typing line, prefixed with \n, so the comment occupies
        // line targetZero+1, targetZero+2, ... and any existing content shifts down.
        const insertPos = new vscode.Position(targetZero, doc.lineAt(targetZero).text.length);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, insertPos, "\n" + commentLines.join("\n"));
        await vscode.workspace.applyEdit(edit);
        ctx.addLineOffset(uri.toString(), commentLines.length);

        // Put the cursor at the start of the typing line, indented appropriately.
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === uri.toString()) {
            const col = step.indent;
            editor.selection = new vscode.Selection(targetZero, col, targetZero, col);
            editor.revealRange(
                new vscode.Range(targetZero, 0, targetZero + commentLines.length, 0),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport,
            );
        }
    },

    prompt(step, ctx, snapshot) {
        const uri = workspaceUriForFile(ctx.playbookUri, step.file);
        const offset = snapshot.lineOffsets[uri.toString()] ?? 0;
        const displayedLine = step.line + offset;
        const indentNote = step.indent > 0 ? ` (indent ${step.indent})` : "";
        return `Type on line ${displayedLine}${indentNote}: ${truncate(step.body, 40)} — read the comment below first, then Ctrl+Alt+.`;
    },

    async verify(step, ctx, snapshot) {
        const uri = workspaceUriForFile(ctx.playbookUri, step.file);
        let doc: vscode.TextDocument;
        try {
            doc = await vscode.workspace.openTextDocument(uri);
        } catch {
            return { ok: false, reason: `cannot open ${step.file}` };
        }
        const offset = snapshot.lineOffsets[uri.toString()] ?? 0;
        const targetZero = step.line - 1 + offset;
        if (targetZero >= doc.lineCount) {
            return { ok: false, reason: `line ${targetZero + 1} doesn't exist yet` };
        }

        const bodyLines = step.body.split(/\r?\n/);
        for (let i = 0; i < bodyLines.length; i++) {
            const docLineIdx = targetZero + i;
            if (docLineIdx >= doc.lineCount) {
                return { ok: false, reason: `missing line ${docLineIdx + 1}` };
            }
            const actual = doc.lineAt(docLineIdx).text;
            const expectedBody = bodyLines[i];
            // Check indent on the first line of the chunk; allow >= required.
            if (i === 0) {
                const leading = actual.match(/^(\s*)/)?.[1].length ?? 0;
                if (leading < step.indent) {
                    return {
                        ok: false,
                        reason: `indent should be at least ${step.indent} space${step.indent === 1 ? "" : "s"}, got ${leading}`,
                    };
                }
                // Compare what comes after the indent against expectedBody (also trimmed of its own leading ws).
                const actualAfterIndent = actual.slice(step.indent);
                if (actualAfterIndent !== expectedBody.replace(/^\s*/, "")) {
                    return {
                        ok: false,
                        reason: `expected \`${truncate(expectedBody, 30)}\`, got \`${truncate(actualAfterIndent, 30)}\``,
                    };
                }
            } else {
                if (actual !== expectedBody) {
                    return {
                        ok: false,
                        reason: `line ${docLineIdx + 1}: expected \`${truncate(expectedBody, 30)}\`, got \`${truncate(actual, 30)}\``,
                    };
                }
            }
        }
        return { ok: true };
    },
};

// ---------- terminal ----------

export const terminalHandler: StepHandler<TerminalStep> = {
    prompt(step) {
        return `Run in a terminal: ${truncate(step.body, 60)} — then Ctrl+Alt+.`;
    },
    async verify(step, ctx, snapshot) {
        const since = ctx.terminalExecutionsSince(snapshot.terminalExecCount);
        if (since.length === 0) {
            // Shell integration off, or user genuinely ran nothing — trust if there's no signal at all,
            // otherwise be strict. We treat "no executions recorded" as "trust the user" rather than block.
            return { ok: true };
        }
        const wanted = step.body.trim();
        const matched = since.some((cmd) => cmd.includes(wanted) || wanted.includes(cmd));
        if (!matched) {
            return {
                ok: false,
                reason: `last command was \`${truncate(since[since.length - 1], 40)}\`, expected something like \`${truncate(wanted, 40)}\``,
            };
        }
        return { ok: true };
    },
};

// ---------- report ----------

export const reportHandler: StepHandler = {
    prompt(step) {
        const desc = step.description ? ` (${step.description})` : "";
        return `Paste output back to Copilot${desc} — then Ctrl+Alt+. once it has appended more steps.`;
    },
    async verify() {
        return { ok: true };
    },
};

// ---------- open ----------

export const openHandler: StepHandler<OpenStep> = {
    prompt(step, ctx) {
        const shortcut = ctx.keybindings.forCommand("workbench.action.quickOpen");
        return `Open ${step.file} (try ${shortcut}) — then Ctrl+Alt+.`;
    },
    async verify(step, ctx) {
        const want = workspaceUriForFile(ctx.playbookUri, step.file).toString();
        const got = vscode.window.activeTextEditor?.document.uri.toString();
        if (got !== want) {
            return { ok: false, reason: `active editor is not ${step.file}` };
        }
        return { ok: true };
    },
};

// ---------- goto ----------

export const gotoHandler: StepHandler<GotoStep> = {
    prompt(step, ctx) {
        const shortcut = ctx.keybindings.forCommand("workbench.action.gotoLine");
        return `Go to line ${step.line} (try ${shortcut} then type ${step.line}) — then Ctrl+Alt+.`;
    },
    async verify(step) {
        const ed = vscode.window.activeTextEditor;
        if (!ed) {
            return { ok: false, reason: "no active editor" };
        }
        if (ed.selection.active.line !== step.line - 1) {
            return {
                ok: false,
                reason: `cursor is on line ${ed.selection.active.line + 1}, not ${step.line}`,
            };
        }
        return { ok: true };
    },
};

// ---------- note ----------

export const noteHandler: StepHandler = {
    prompt(step) {
        return step.description || "(note) — Ctrl+Alt+. to continue";
    },
    async verify() {
        return { ok: true };
    },
};

// ---------- dispatch ----------

export function handlerFor(step: PlaybookStep): StepHandler {
    switch (step.kind) {
        case "edit":
            return editHandler as StepHandler;
        case "terminal":
            return terminalHandler as StepHandler;
        case "report":
            return reportHandler;
        case "open":
            return openHandler as StepHandler;
        case "goto":
            return gotoHandler as StepHandler;
        case "note":
            return noteHandler;
    }
}

function truncate(s: string, n: number): string {
    const flat = s.replace(/\n/g, "\\n");
    return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}
