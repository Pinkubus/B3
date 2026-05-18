import * as vscode from "vscode";
import { Step } from "./lessonEngine";

/**
 * Drives the user through a sequence of steps:
 *  - shows the current step in the status bar
 *  - listens to editor events to detect completion
 *  - reverts incorrect typing when strict mode is on
 *
 * We intentionally do NOT try to intercept raw keystrokes (VS Code does not expose
 * a public API to do this for built-in/other-extension commands). Instead we observe
 * the resulting state change: cursor moves, active editor changes, text inserted, etc.
 */
export class StepExecutor implements vscode.Disposable {
    private idx = 0;
    private statusItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];
    private suppressChangeListener = false;
    private completedDeferred = new Deferred<void>();

    constructor(
        private readonly steps: Step[],
        private readonly strict: boolean,
    ) {
        this.statusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            10_000,
        );
        this.statusItem.command = "bbb.cancelLesson";
    }

    public async run(): Promise<void> {
        if (this.steps.length === 0) {
            return;
        }
        this.statusItem.show();
        this.attachListeners();
        this.renderCurrent();
        // Re-evaluate immediately in case the user is already in the target state.
        this.checkCurrent();
        return this.completedDeferred.promise;
    }

    public dispose(): void {
        this.statusItem.dispose();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }

    public cancel(): void {
        this.completedDeferred.resolve();
        this.dispose();
    }

    // ---------- rendering ----------

    private renderCurrent(): void {
        const step = this.steps[this.idx];
        const progress = `${this.idx + 1}/${this.steps.length}`;
        this.statusItem.text = `$(mortar-board) BBB ${progress}: ${step.hint}`;
        this.statusItem.tooltip = `Click to cancel the BBB lesson.\nStep ${progress}`;
    }

    private advance(): void {
        this.idx++;
        if (this.idx >= this.steps.length) {
            this.statusItem.text = "$(check) BBB lesson complete!";
            void vscode.window.showInformationMessage("BBB: lesson complete — nice work.");
            setTimeout(() => this.cancel(), 1500);
            return;
        }
        this.renderCurrent();
        // The new step may already be satisfied (e.g. editor already focused).
        this.checkCurrent();
    }

    // ---------- event wiring ----------

    private attachListeners(): void {
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => this.checkCurrent()),
            vscode.window.onDidChangeTextEditorSelection(() => this.checkCurrent()),
            vscode.window.onDidChangeWindowState(() => this.checkCurrent()),
            vscode.workspace.onDidChangeTextDocument((e) => this.onDocChange(e)),
        );
    }

    private onDocChange(e: vscode.TextDocumentChangeEvent): void {
        if (this.suppressChangeListener) {
            return;
        }
        const step = this.steps[this.idx];
        const active = vscode.window.activeTextEditor;
        if (!active || e.document !== active.document) {
            return;
        }

        switch (step.kind) {
            case "typeChar":
                this.handleTypeChar(e, step);
                break;
            case "pressEnter":
                this.handlePressEnter(e, step);
                break;
            case "expectIndent":
                // Indent changes flow through text changes; just re-check.
                this.checkCurrent();
                break;
            default:
                break;
        }
    }

    private handleTypeChar(
        e: vscode.TextDocumentChangeEvent,
        step: Extract<Step, { kind: "typeChar" }>,
    ): void {
        // Look for a single-character insertion at the expected position.
        for (const change of e.contentChanges) {
            if (!change.range.isEmpty || change.text.length === 0) {
                // Deletion or multi-char paste — count as wrong if strict.
                this.handleWrongInput(e, change);
                continue;
            }
            const expectedPos = new vscode.Position(step.line - 1, step.column);
            if (!change.range.start.isEqual(expectedPos)) {
                this.handleWrongInput(e, change);
                continue;
            }
            if (change.text === step.char) {
                this.advance();
                return;
            }
            this.handleWrongInput(e, change);
        }
    }

    private handlePressEnter(
        e: vscode.TextDocumentChangeEvent,
        step: Extract<Step, { kind: "pressEnter" }>,
    ): void {
        for (const change of e.contentChanges) {
            // Newline insertions may include auto-indent whitespace; accept any change that contains \n.
            if (change.text.includes("\n")) {
                this.advance();
                return;
            }
        }
    }

    private handleWrongInput(
        e: vscode.TextDocumentChangeEvent,
        change: vscode.TextDocumentContentChangeEvent,
    ): void {
        if (!this.strict) {
            void vscode.window.setStatusBarMessage("BBB: that wasn't the expected key", 1500);
            return;
        }
        // Revert: compute the range of the inserted text and delete it.
        const insertedStart = change.range.start;
        const insertedEnd = insertedStart.translate(0, change.text.length);
        const edit = new vscode.WorkspaceEdit();
        edit.delete(e.document.uri, new vscode.Range(insertedStart, insertedEnd));
        this.suppressChangeListener = true;
        void vscode.workspace.applyEdit(edit).then(() => {
            this.suppressChangeListener = false;
            void vscode.window.setStatusBarMessage(
                "BBB: wrong key — reverted. Try again.",
                1500,
            );
        });
    }

    // ---------- state checks (for non-typing steps) ----------

    private checkCurrent(): void {
        const step = this.steps[this.idx];
        switch (step.kind) {
            case "focusEditor":
                if (vscode.window.activeTextEditor && vscode.window.state.focused) {
                    this.advance();
                }
                break;
            case "openFile":
                if (
                    vscode.window.activeTextEditor?.document.uri.toString() ===
                    step.uri.toString()
                ) {
                    this.advance();
                }
                break;
            case "gotoLine": {
                const ed = vscode.window.activeTextEditor;
                if (ed && ed.selection.active.line === step.line - 1) {
                    this.advance();
                }
                break;
            }
            case "expectIndent": {
                const ed = vscode.window.activeTextEditor;
                if (!ed) {
                    break;
                }
                const lineText = ed.document.lineAt(step.line - 1).text;
                const leading = lineText.match(/^(\s*)/)?.[1] ?? "";
                if (leading.length >= step.spaces) {
                    this.advance();
                }
                break;
            }
            default:
                break;
        }
    }
}

class Deferred<T> {
    public promise: Promise<T>;
    public resolve!: (value: T) => void;
    public reject!: (err: unknown) => void;
    constructor() {
        this.promise = new Promise<T>((res, rej) => {
            this.resolve = res;
            this.reject = rej;
        });
    }
}
