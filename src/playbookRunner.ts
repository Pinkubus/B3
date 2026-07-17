import * as vscode from "vscode";
import { parsePlaybook, PlaybookStep } from "./playbookParser";
import {
    handlerFor,
    HandlerContext,
    StepSnapshot,
    workspaceUriForFile,
} from "./handlers";
import { KeybindingResolver } from "./keybindings";
import { TeachView } from "./teachView";
import { log } from "./log";

/**
 * Drives a playbook lesson: shows one status-bar prompt at a time, advances
 * when the user presses the resume keybinding (verified against document/terminal state),
 * and reloads on disk when Copilot appends more steps.
 */
export class PlaybookRunner {
    private statusBar: vscode.StatusBarItem;
    private steps: PlaybookStep[] = [];
    private currentIdx: number = -1;
    private playbookUri: vscode.Uri | null = null;
    private lineOffsets = new Map<string, number>();
    private terminalLog: string[] = [];
    private currentSnapshot: StepSnapshot | null = null;
    private watcher: vscode.FileSystemWatcher | null = null;
    private subs: vscode.Disposable[] = [];
    private keybindings: KeybindingResolver;
    private finished: boolean = false;
    private pages: string[] = [];
    private currentPage: number = 0;
    private instructionsVisible: boolean = true;
    private teachView = new TeachView();
    private globalState: vscode.Memento;
    private comprehensionEnabled: boolean;

    /** globalState key persisting whether comprehension popups are shown. */
    private static readonly COMPREHENSION_KEY = "bbb.comprehensionEnabled";

    /** Target max for the total visible status-bar text (prefix + message). */
    private static readonly PAGE_LENGTH = 60;

    constructor(keybindings: KeybindingResolver, globalState: vscode.Memento) {
        this.keybindings = keybindings;
        this.globalState = globalState;
        this.comprehensionEnabled = globalState.get<boolean>(
            PlaybookRunner.COMPREHENSION_KEY,
            true,
        );
        this.statusBar = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            10_000,
        );
        this.statusBar.command = "bbb.resume";

        // Subscribe to terminal shell-execution events when available (VS Code >= 1.93).
        const api = vscode.window as unknown as {
            onDidStartTerminalShellExecution?: vscode.Event<{
                execution: { commandLine?: { value: string } | string };
            }>;
        };
        if (typeof api.onDidStartTerminalShellExecution === "function") {
            this.subs.push(
                api.onDidStartTerminalShellExecution((e) => {
                    const cl = e.execution.commandLine;
                    const value = typeof cl === "string" ? cl : cl?.value ?? "";
                    if (value) {
                        this.terminalLog.push(value);
                        log.info("terminal exec observed", { value });
                    }
                }),
            );
            log.info("onDidStartTerminalShellExecution subscribed");
        } else {
            log.warn("onDidStartTerminalShellExecution not available; terminal steps will trust the user");
        }
    }

    /** Start a fresh lesson from the given playbook URI. */
    async start(uri: vscode.Uri): Promise<void> {
        log.info("runner.start", { uri: uri.toString() });
        this.playbookUri = uri;
        this.lineOffsets.clear();
        this.currentIdx = -1;
        this.finished = false;
        this.pages = [];
        this.currentPage = 0;
        this.currentSnapshot = null;
        await this.reload();
        this.attachWatcher(uri);
        await this.startFirstStep();
    }

    /**
     * After (re)loading, skip past any leading `edit` steps whose content is
     * already present in the target files, then activate the first step that
     * still needs doing. Lets a partially-applied playbook resume where it left off.
     */
    private async startFirstStep(): Promise<void> {
        let idx = 0;
        while (idx < this.steps.length) {
            const step = this.steps[idx];
            if (step.kind !== "edit") {
                break;
            }
            const result = await handlerFor(step).verify(step, this.context(), this.takeSnapshot());
            if (!result.ok) {
                break;
            }
            log.info("startup: skipping already-complete step", { idx, kind: step.kind });
            idx++;
        }
        if (idx >= this.steps.length) {
            this.currentIdx = this.steps.length;
            this.finished = true;
            this.statusBar.text = "$(check) BBB lesson complete";
            this.statusBar.tooltip = "All steps were already applied. Edit the playbook and save to add more.";
            if (this.instructionsVisible) {
                this.statusBar.show();
            }
            log.info("startup: all steps already complete");
            return;
        }
        this.currentIdx = idx;
        await this.activateCurrent();
    }

    /** Re-parse the playbook from disk (preserves progress). */
    async reload(): Promise<{ added: number }> {
        if (!this.playbookUri) {
            return { added: 0 };
        }
        const bytes = await vscode.workspace.fs.readFile(this.playbookUri);
        const text = new TextDecoder("utf-8").decode(bytes);
        const { steps, warnings } = parsePlaybook(text);
        const prevCount = this.steps.length;
        this.steps = steps;
        const added = steps.length - prevCount;
        log.info("playbook parsed", { total: steps.length, added, warnings: warnings.length });
        for (const w of warnings) {
            log.warn(`parse: ${w}`);
        }
        // If an active step's content changed, refresh its displayed prompt.
        if (this.currentIdx >= 0 && this.currentIdx < this.steps.length) {
            const step = this.steps[this.currentIdx];
            const handler = handlerFor(step);
            const snap = this.currentSnapshot ?? this.takeSnapshot();
            const refreshedPrompt = handler.prompt(step, this.context(), snap);
            this.pages = PlaybookRunner.splitIntoPages(refreshedPrompt, this.promptPageMax());
            this.currentPage = 0;
            this.updateStatusBar();
        }
        // If we were waiting at the end and new steps showed up, reactivate.
        if (this.finished && added > 0) {
            this.finished = false;
            await this.advance();
        }
        return { added };
    }

    /**
     * Called when the user presses Ctrl+Alt+. — advance through pages first,
     * then verify the current step and move to the next.
     */
    async advance(): Promise<void> {
        if (!this.playbookUri) {
            return;
        }

        // If there are more pages for the current step, show the next page.
        if (this.pages.length > 1 && this.currentPage < this.pages.length - 1) {
            this.currentPage++;
            this.updateStatusBar();
            return;
        }

        // If there is a current step, verify it first.
        if (this.currentIdx >= 0 && this.currentIdx < this.steps.length) {
            const step = this.steps[this.currentIdx];
            const handler = handlerFor(step);
            const snapshot = this.currentSnapshot ?? this.takeSnapshot();
            const result = await handler.verify(step, this.context(), snapshot);
            log.info("verify", { idx: this.currentIdx, kind: step.kind, result });
            if (!result.ok) {
                vscode.window.setStatusBarMessage(`BBB: ${result.reason}`, 4000);
                return;
            }
            // The user just finished this step — show its comprehension popup, if any.
            if (step.teach && step.teach.trim()) {
                await this.showTeach(step);
            }
        }

        // Advance.
        this.currentIdx++;
        if (this.currentIdx >= this.steps.length) {
            // Try one reload in case Copilot just appended more.
            const { added } = await this.reload();
            if (added <= 0) {
                this.finished = true;
                this.statusBar.text = "$(check) BBB lesson complete";
                this.statusBar.tooltip = "Waiting for more steps. Edit the playbook and save to continue.";
                if (this.instructionsVisible) {
                    this.statusBar.show();
                }
                return;
            }
        }

        await this.activateCurrent();
    }

    private async activateCurrent(): Promise<void> {
        const step = this.steps[this.currentIdx];
        const handler = handlerFor(step);
        const snapshot = this.takeSnapshot();
        this.currentSnapshot = snapshot;
        log.info("activate step", { idx: this.currentIdx, kind: step.kind, sourceLine: step.sourceLine });
        try {
            await handler.activate?.(step, this.context(), snapshot);
        } catch (err) {
            log.error(`activate failed for step ${step.index + 1}`, err);
        }
        const prompt = handler.prompt(step, this.context(), snapshot);
        this.pages = PlaybookRunner.splitIntoPages(prompt, this.promptPageMax());
        this.currentPage = 0;
        this.updateStatusBar();
    }

    /** Available chars for the message portion given the fixed prefix rendered in the status bar. */
    private promptPageMax(): number {
        // $(debug-step-over) renders as a single icon glyph, not 18 chars.
        const raw = `$(debug-step-over) BBB ${this.currentIdx + 1}/${this.steps.length}: `;
        const visiblePrefix = raw.length - "$(debug-step-over)".length + 1;
        return Math.max(30, PlaybookRunner.PAGE_LENGTH - visiblePrefix);
    }

    private updateStatusBar(): void {
        if (!this.instructionsVisible) {
            return;
        }
        const step = this.steps[this.currentIdx];
        const page = this.pages[this.currentPage];
        const pageTag = this.pages.length > 1 ? ` (${this.currentPage + 1}/${this.pages.length})` : "";
        this.statusBar.text = `$(debug-step-over) BBB ${this.currentIdx + 1}/${this.steps.length}: ${page}${pageTag}`;
        this.statusBar.tooltip = step.description;
        this.statusBar.show();
    }

    private static splitIntoPages(text: string, max: number): string[] {
        // Status-bar items are single-line: collapse newlines so multi-line
        // bodies don't blow past the visible edge.
        text = text.replace(/\r?\n/g, " ⏎ ").replace(/\s{2,}/g, " ").trim();
        if (text.length <= max) {
            return [text];
        }
        const pages: string[] = [];
        let remaining = text;
        while (remaining.length > max) {
            let splitAt = remaining.lastIndexOf(" ", max);
            if (splitAt <= 0) {
                splitAt = max;
            }
            pages.push(remaining.slice(0, splitAt).trimEnd());
            remaining = remaining.slice(splitAt).trimStart();
        }
        if (remaining.length > 0) {
            pages.push(remaining);
        }
        return pages;
    }

    private takeSnapshot(): StepSnapshot {
        return {
            terminalExecCount: this.terminalLog.length,
            lineOffsets: Object.fromEntries(this.lineOffsets),
        };
    }

    private context(): HandlerContext {
        return {
            playbookUri: this.playbookUri!,
            keybindings: this.keybindings,
            getLineOffset: (f) => this.lineOffsets.get(f) ?? 0,
            addLineOffset: (f, d) => this.lineOffsets.set(f, (this.lineOffsets.get(f) ?? 0) + d),
            snapshotTerminalExecutions: () => this.terminalLog.length,
            terminalExecutionsSince: (s) => this.terminalLog.slice(s),
        };
    }

    private attachWatcher(uri: vscode.Uri): void {
        this.watcher?.dispose();
        const pattern = new vscode.RelativePattern(
            vscode.Uri.joinPath(uri, ".."),
            uri.path.split("/").pop() ?? "playbook.md",
        );
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.subs.push(
            this.watcher.onDidChange(async () => {
                await this.reload();
            }),
        );
    }

    /**
     * Apply the current edit step automatically — opens the file, scrolls to the
     * target line so the user can see where the edit lands, **inserts** the
     * expected text (pushing existing lines down rather than overwriting them),
     * verifies the result, then advances. If the insertion doesn't produce the
     * expected code (line number drifted, surrounding block wrong), it rolls the
     * file back and warns instead of leaving broken code behind.
     */
    async applyCurrentStep(): Promise<void> {
        if (this.currentIdx < 0 || this.currentIdx >= this.steps.length) {
            return;
        }
        const step = this.steps[this.currentIdx];
        if (step.kind !== "edit") {
            vscode.window.setStatusBarMessage("BBB: auto-apply only works for edit steps", 3000);
            return;
        }
        const snap = this.currentSnapshot ?? this.takeSnapshot();
        const handler = handlerFor(step);

        // Ensure the target line exists (activate no longer navigates).
        try {
            await handler.activate?.(step, this.context(), snap);
        } catch (err) {
            log.error("applyCurrentStep: activate failed", err);
        }

        const uri = workspaceUriForFile(this.playbookUri!, step.file);
        const offset = snap.lineOffsets[uri.toString()] ?? 0;
        const targetZero = step.line - 1 + offset;
        const doc = await vscode.workspace.openTextDocument(uri);

        // Open the file and navigate to the target line for auto-apply.
        const applyEditor = await vscode.window.showTextDocument(doc, { preserveFocus: false });
        applyEditor.selection = new vscode.Selection(targetZero, step.indent, targetZero, step.indent);
        applyEditor.revealRange(
            new vscode.Range(targetZero, 0, targetZero, 0),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );

        // Verify-before: if the step's content is already present, don't insert a
        // duplicate — just move on.
        const pre = await handler.verify(step, this.context(), snap);
        if (pre.ok) {
            log.info("applyCurrentStep: already satisfied; advancing", { idx: this.currentIdx });
            await this.advance();
            return;
        }

        // Build the lines to insert: first line carries the required indent,
        // the rest are verbatim (they already include their own indentation).
        const bodyLines = step.body.split(/\r?\n/);
        const textLines = bodyLines.map((l, i) =>
            i === 0 ? " ".repeat(step.indent) + l.replace(/^\s*/, "") : l,
        );

        // Snapshot the original so we can roll back if placement is wrong.
        const originalText = doc.getText();

        const wsEdit = new vscode.WorkspaceEdit();
        if (targetZero <= doc.lineCount - 1) {
            // Insert BEFORE the current line at targetZero, shifting it (and
            // everything below) down. This never overwrites existing code.
            wsEdit.insert(uri, new vscode.Position(targetZero, 0), textLines.join("\n") + "\n");
        } else {
            // Target is past the end of file: pad with blank lines, then append.
            const lastLine = doc.lineCount - 1;
            const lastLineEnd = new vscode.Position(lastLine, doc.lineAt(lastLine).text.length);
            const pad = "\n".repeat(targetZero - doc.lineCount + 1);
            wsEdit.insert(uri, lastLineEnd, pad + textLines.join("\n"));
        }
        await vscode.workspace.applyEdit(wsEdit);

        // Verify-after: confirm the line(s) and the surrounding code block are correct.
        const post = await handler.verify(step, this.context(), snap);
        if (!post.ok) {
            // Roll the file back to its exact prior contents — leave nothing broken.
            const fresh = await vscode.workspace.openTextDocument(uri);
            const fullRange = new vscode.Range(
                new vscode.Position(0, 0),
                fresh.lineAt(fresh.lineCount - 1).range.end,
            );
            const undo = new vscode.WorkspaceEdit();
            undo.replace(uri, fullRange, originalText);
            await vscode.workspace.applyEdit(undo);
            log.warn("applyCurrentStep: placement failed, rolled back", { idx: this.currentIdx, reason: post.reason });
            void vscode.window.showWarningMessage(
                `BBB: couldn't place that edit safely — ${post.reason}. Nothing was changed; check the target line number in the playbook.`,
                { modal: true },
                "OK",
            );
            return;
        }

        // advance() re-verifies (passes), shows the teach note, and moves on.
        await this.advance();
    }

    /** Show why the current step's verification is failing (shown as a modal). */
    async showValidationReason(): Promise<void> {
        if (this.currentIdx < 0 || this.currentIdx >= this.steps.length) {
            void vscode.window.showInformationMessage("BBB: no active step.");
            return;
        }
        const step = this.steps[this.currentIdx];
        const handler = handlerFor(step);
        const snap = this.currentSnapshot ?? this.takeSnapshot();
        const result = await handler.verify(step, this.context(), snap);
        if (result.ok) {
            void vscode.window.showInformationMessage(
                "BBB: step is already satisfied — press Ctrl+Alt+. to advance.",
            );
            return;
        }
        const buttons: string[] = result.diff ? ["Show Diff", "OK"] : ["OK"];
        const pick = await vscode.window.showWarningMessage(
            "BBB: Cannot advance",
            { modal: true, detail: result.detail ?? result.reason },
            ...buttons,
        );
        if (pick === "Show Diff" && result.diff) {
            const { actual, expected } = result.diff;
            const [actualDoc, expectedDoc] = await Promise.all([
                vscode.workspace.openTextDocument({ content: actual, language: "shellscript" }),
                vscode.workspace.openTextDocument({ content: expected, language: "shellscript" }),
            ]);
            await vscode.commands.executeCommand(
                "vscode.diff",
                actualDoc.uri,
                expectedDoc.uri,
                "Terminal diff: Yours ↔ Expected",
            );
        }
    }

    /**
     * Comprehension-mode popup shown right after the user completes a step that
     * carries a `teach` note. Explains what they just wrote.
     */
    private async showTeach(step: PlaybookStep): Promise<void> {
        if (!this.comprehensionEnabled) {
            return;
        }
        const text = (step.teach ?? "").trim();
        if (!text) {
            return;
        }
        log.info("teach popup", { idx: this.currentIdx });
        this.teachView.show(step.description, text);
    }

    /** Toggle comprehension mode on/off and remember it across sessions. */
    toggleComprehension(): void {
        this.comprehensionEnabled = !this.comprehensionEnabled;
        void this.globalState.update(
            PlaybookRunner.COMPREHENSION_KEY,
            this.comprehensionEnabled,
        );
        if (!this.comprehensionEnabled) {
            this.teachView.dispose();
        } else if (this.currentIdx >= 0 && this.currentIdx < this.steps.length) {
            // Re-show the note for the current step so the effect is visible immediately.
            const step = this.steps[this.currentIdx];
            if (step.teach && step.teach.trim()) {
                this.teachView.show(step.description, step.teach.trim());
            }
        }
        vscode.window.setStatusBarMessage(
            `BBB: comprehension mode ${this.comprehensionEnabled ? "ON" : "OFF"}`,
            3000,
        );
        log.info("runner.toggleComprehension", { enabled: this.comprehensionEnabled });
    }

    /** Show the explain/why for the current step in a modal popup. */
    async showWhy(): Promise<void> {
        if (this.currentIdx < 0 || this.currentIdx >= this.steps.length) {
            void vscode.window.showInformationMessage("BBB: no active step.");
            return;
        }
        const step = this.steps[this.currentIdx];
        const why = step.explain.trim();
        if (!why) {
            void vscode.window.showInformationMessage("BBB: no explanation recorded for this step.");
            return;
        }
        await vscode.window.showInformationMessage(
            `Step ${this.currentIdx + 1} — Why: ${why}`,
            { modal: true },
            "OK",
        );
    }

    /** Skip the current step without verifying it. */
    async skipStep(): Promise<void> {
        if (!this.playbookUri) {
            return;
        }
        this.pages = [];
        this.currentPage = 0;
        this.currentIdx++;
        if (this.currentIdx >= this.steps.length) {
            const { added } = await this.reload();
            if (added <= 0) {
                this.finished = true;
                this.statusBar.text = "$(check) BBB lesson complete";
                this.statusBar.tooltip = "Waiting for more steps. Edit the playbook and save to continue.";
                if (this.instructionsVisible) {
                    this.statusBar.show();
                }
                return;
            }
        }
        log.info("runner.skipStep", { idx: this.currentIdx });
        await this.activateCurrent();
    }

    /** Stop the active playbook lesson and hide the status bar. */
    stop(): void {
        this.watcher?.dispose();
        this.watcher = null;
        this.playbookUri = null;
        this.steps = [];
        this.currentIdx = -1;
        this.finished = false;
        this.pages = [];
        this.currentPage = 0;
        this.lineOffsets.clear();
        this.statusBar.hide();
        log.info("runner.stop");
    }

    /** Go back one step (re-shows its prompt without re-running activate). */
    async rewind(): Promise<void> {
        if (!this.playbookUri) {
            return;
        }
        // If we're mid-page, go back to the first page of the current step first.
        if (this.currentPage > 0) {
            this.currentPage = 0;
            this.updateStatusBar();
            return;
        }
        if (this.currentIdx <= 0) {
            vscode.window.setStatusBarMessage("BBB: already at the first step", 3000);
            return;
        }
        this.currentIdx--;
        this.finished = false;
        const step = this.steps[this.currentIdx];
        const handler = handlerFor(step);
        const snapshot = this.takeSnapshot();
        this.currentSnapshot = snapshot;
        const prompt = handler.prompt(step, this.context(), snapshot);
        this.pages = PlaybookRunner.splitIntoPages(prompt, this.promptPageMax());
        this.currentPage = 0;
        log.info("runner.rewind", { idx: this.currentIdx });
        this.updateStatusBar();
    }

    /** Toggle visibility of the status-bar instruction text. */
    toggleInstructions(): void {
        this.instructionsVisible = !this.instructionsVisible;
        if (this.instructionsVisible) {
            if (this.currentIdx >= 0 && this.currentIdx < this.steps.length) {
                this.updateStatusBar();
            } else if (this.finished) {
                this.statusBar.show();
            }
        } else {
            this.statusBar.hide();
        }
        log.info("runner.toggleInstructions", { visible: this.instructionsVisible });
    }

    dispose(): void {
        this.statusBar.dispose();
        this.watcher?.dispose();
        this.teachView.dispose();
        for (const s of this.subs) {
            s.dispose();
        }
        this.subs = [];
    }
}
