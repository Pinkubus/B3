import * as vscode from "vscode";
import * as path from "path";
import { PlaybookStep, EditStep, ReplaceStep, CreateStep, TerminalStep, OpenStep, GotoStep } from "./playbookParser";
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

export type VerifyResult =
    | { ok: true }
    | { ok: false; reason: string; detail?: string; diff?: { actual: string; expected: string } };

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

export function workspaceUriForFile(playbookUri: vscode.Uri, relOrAbs: string): vscode.Uri {
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

/**
 * Resolve the 0-based line index an edit targets. When the step carries an
 * `after`/`before` text anchor, locate that line dynamically so cross-step line
 * drift can never break placement; otherwise fall back to the declared 1-based
 * line plus any tracked offset.
 */
export function resolveEditTargetZero(
    step: EditStep,
    doc: vscode.TextDocument,
    offset: number,
): number {
    const anchor = step.after ?? step.before;
    if (anchor) {
        const want = anchor.trim();
        for (let i = 0; i < doc.lineCount; i++) {
            if (doc.lineAt(i).text.trim() === want) {
                return step.after ? i + 1 : i;
            }
        }
        // Anchor not present yet (file not built this far) — fall back to line number.
    }
    return step.line - 1 + offset;
}

// ---------- edit ----------

export const editHandler: StepHandler<EditStep> = {
    async activate(step, ctx, snapshot) {
        // Only ensure the target line exists — navigation is the user's job (or applyCurrentStep's).
        const uri = workspaceUriForFile(ctx.playbookUri, step.file);
        const doc = await vscode.workspace.openTextDocument(uri);
        const offset = snapshot.lineOffsets[uri.toString()] ?? 0;
        const targetZero = resolveEditTargetZero(step, doc, offset);
        await ensureLineExists(doc, targetZero);
    },

    prompt(step, ctx, snapshot) {
        const uri = workspaceUriForFile(ctx.playbookUri, step.file);
        const offset = snapshot.lineOffsets[uri.toString()] ?? 0;
        const indentNote = step.indent > 0 ? ` (indent ${step.indent})` : "";
        if (step.after) {
            return `Type after \`${truncate(step.after.trim(), 24)}\`${indentNote}: ${step.body}`;
        }
        const displayedLine = step.line + offset;
        return `Type on line ${displayedLine}${indentNote}: ${step.body}`;
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
        const targetZero = resolveEditTargetZero(step, doc, offset);
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
                // Strip the declared indent offset, then also strip any further leading whitespace
                // that the editor or language formatter added (e.g. attribute continuation lines in
                // HTML, hanging indents in Python). Trailing whitespace is also ignored so editors
                // that auto-insert trailing spaces don't cause spurious failures.
                const actualContent = actual.slice(step.indent).trimStart().trimEnd();
                const expectedContent = expectedBody.replace(/^\s*/, "").trimEnd();
                if (actualContent !== expectedContent) {
                    return {
                        ok: false,
                        reason: `expected \`${truncate(expectedContent, 30)}\`, got \`${truncate(actualContent, 30)}\``,
                    };
                }
            } else {
                // Subsequent lines: normalise trailing whitespace only; the playbook body
                // already carries the correct leading whitespace for the target language.
                if (actual.trimEnd() !== expectedBody.trimEnd()) {
                    return {
                        ok: false,
                        reason: `line ${docLineIdx + 1}: expected \`${truncate(expectedBody.trimEnd(), 30)}\`, got \`${truncate(actual.trimEnd(), 30)}\``,
                    };
                }
            }
        }
        // Optional broader code-section assertion.
        if (step.validationSection) {
            const { file: sFile, start, end, expected } = step.validationSection;
            const sUri = workspaceUriForFile(ctx.playbookUri, sFile);
            let sDoc: vscode.TextDocument;
            try {
                sDoc = await vscode.workspace.openTextDocument(sUri);
            } catch {
                return { ok: false, reason: `cannot open ${sFile} for section validation` };
            }
            const sOffset = snapshot.lineOffsets[sUri.toString()] ?? 0;
            const sStartZero = start - 1 + sOffset;
            const sEndZero = end - 1 + sOffset;
            const actualLines: string[] = [];
            for (let i = sStartZero; i <= sEndZero && i < sDoc.lineCount; i++) {
                actualLines.push(sDoc.lineAt(i).text);
            }
            const actualSection = actualLines.join("\n");
            if (actualSection !== expected) {
                const expectedLines = expected.split("\n");
                const actualSplit = actualSection.split("\n");
                let diffIdx = 0;
                while (
                    diffIdx < expectedLines.length &&
                    diffIdx < actualSplit.length &&
                    expectedLines[diffIdx] === actualSplit[diffIdx]
                ) {
                    diffIdx++;
                }
                const hint =
                    diffIdx < expectedLines.length || diffIdx < actualSplit.length
                        ? `line ${start + diffIdx}: expected \`${truncate(expectedLines[diffIdx] ?? "(end)", 30)}\`, got \`${truncate(actualSplit[diffIdx] ?? "(end)", 30)}\``
                        : "length mismatch";
                return { ok: false, reason: `code section mismatch — ${hint} (press Ctrl+Alt+R for details)` };
            }
        }
        return { ok: true };
    },
};

export const terminalHandler: StepHandler<TerminalStep> = {
    prompt(step) {
        const where = step.cwd ? ` in ${step.cwd}` : " in a terminal";
        return `Run${where}:\n${step.body}`;
    },
    async verify(step, ctx, snapshot) {
        const since = ctx.terminalExecutionsSince(snapshot.terminalExecCount);
        if (since.length === 0) {
            // Shell integration off, or user genuinely ran nothing — trust if there's no signal at all,
            // otherwise be strict. We treat "no executions recorded" as "trust the user" rather than block.
            return { ok: true };
        }
        const wanted = step.body.trim();
        const matched = since.some((cmd) => commandsMatch(cmd, wanted));
        if (!matched) {
            const lastCmd = since[since.length - 1];
            return {
                ok: false,
                reason: `last command was \`${truncate(lastCmd, 40)}\`, expected \`${truncate(wanted, 40)}\``,
                detail: `Your command:\n${lastCmd}\n\nExpected:\n${wanted}`,
                diff: { actual: lastCmd, expected: wanted },
            };
        }
        return { ok: true };
    },
};

// ---------- report ----------

export const reportHandler: StepHandler = {
    prompt(step) {
        const desc = step.description ? ` (${step.description})` : "";
        return `Paste output to Copilot${desc}`;
    },
    async verify() {
        return { ok: true };
    },
};

// ---------- open ----------

export const openHandler: StepHandler<OpenStep> = {
    prompt(step, ctx) {
        const shortcut = ctx.keybindings.forCommand("workbench.action.quickOpen");
        return `Open ${step.file} (${shortcut})`;
    },
    async verify(step, ctx) {
        const want = workspaceUriForFile(ctx.playbookUri, step.file).toString();
        // Accept the file being open in ANY visible editor group, not only the
        // focused one — splits and preview tabs shouldn't strand the learner.
        const open =
            vscode.window.activeTextEditor?.document.uri.toString() === want ||
            vscode.window.visibleTextEditors.some((e) => e.document.uri.toString() === want);
        if (!open) {
            return { ok: false, reason: `active editor is not ${step.file}` };
        }
        return { ok: true };
    },
};

// ---------- create ----------

export const createHandler: StepHandler<CreateStep> = {
    async activate(step, ctx) {
        // Scaffold the file (and any parent folders) so the following edit steps
        // always have a real target to type into. Creating an empty file is pure
        // boilerplate, not a teaching moment, so BBB does it for the learner.
        const uri = workspaceUriForFile(ctx.playbookUri, step.file);
        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
            await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        }
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preserveFocus: false });
    },
    prompt(step) {
        return `Create and open ${step.file}`;
    },
    async verify(step, ctx) {
        const uri = workspaceUriForFile(ctx.playbookUri, step.file);
        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            return { ok: false, reason: `${step.file} does not exist yet` };
        }
        return { ok: true };
    },
};

// ---------- replace ----------

export const replaceHandler: StepHandler<ReplaceStep> = {
    prompt(step, ctx, snapshot) {
        const uri = workspaceUriForFile(ctx.playbookUri, step.file);
        const offset = snapshot.lineOffsets[uri.toString()] ?? 0;
        return `Change line ${step.line + offset} to: ${step.newText}`;
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
            return { ok: false, reason: `line ${targetZero + 1} doesn't exist` };
        }
        const actual = doc.lineAt(targetZero).text.trim();
        if (actual === step.newText.trim()) {
            return { ok: true };
        }
        if (actual === step.oldText.trim()) {
            return {
                ok: false,
                reason: `still the old line — change it to \`${truncate(step.newText.trim(), 30)}\``,
            };
        }
        return {
            ok: false,
            reason: `line ${targetZero + 1} is \`${truncate(actual, 22)}\`, expected \`${truncate(step.newText.trim(), 22)}\``,
        };
    },
};

// ---------- goto ----------

export const gotoHandler: StepHandler<GotoStep> = {
    prompt(step, ctx) {
        const shortcut = ctx.keybindings.forCommand("workbench.action.gotoLine");
        return `Go to line ${step.line} (${shortcut}, type ${step.line})`;
    },
    async verify(step) {
        const ed = vscode.window.activeTextEditor;
        if (!ed) {
            return { ok: false, reason: "no active editor" };
        }
        // Allow a small tolerance — auto-format/scroll can nudge the cursor a line
        // or two, and stranding a beginner on an off-by-one nav step is worse than
        // being approximate here.
        if (Math.abs(ed.selection.active.line - (step.line - 1)) > 2) {
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
        case "replace":
            return replaceHandler as StepHandler;
        case "create":
            return createHandler as StepHandler;
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

/** Lenient command comparison so a working terminal step isn't flagged as wrong. */
function commandsMatch(actual: string, wanted: string): boolean {
    const a = actual.trim().toLowerCase();
    const w = wanted.trim().toLowerCase();
    if (!a || !w) {
        return false;
    }
    if (a.includes(w) || w.includes(a)) {
        return true;
    }
    // Same program (first token, ignoring a leading ./) is close enough.
    const prog = (s: string) => s.replace(/^\.\//, "").split(/\s+/)[0];
    return prog(a) === prog(w);
}

function truncate(s: string, n: number): string {
    const flat = s.replace(/\n/g, "\\n");
    return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}
