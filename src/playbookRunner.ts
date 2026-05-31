import * as vscode from "vscode";
import { parsePlaybook, PlaybookStep } from "./playbookParser";
import {
    handlerFor,
    HandlerContext,
    StepSnapshot,
} from "./handlers";
import { KeybindingResolver } from "./keybindings";
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

    constructor(keybindings: KeybindingResolver) {
        this.keybindings = keybindings;
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
        await this.reload();
        this.attachWatcher(uri);
        await this.advance();
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
        // If we were waiting at the end and new steps showed up, reactivate.
        if (this.finished && added > 0) {
            this.finished = false;
            await this.advance();
        }
        return { added };
    }

    /**
     * Called when the user presses Ctrl+Alt+. — verify the current step, and
     * if it passes, move to the next.
     */
    async advance(): Promise<void> {
        if (!this.playbookUri) {
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
                this.statusBar.show();
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
        this.statusBar.text = `$(debug-step-over) BBB ${this.currentIdx + 1}/${this.steps.length}: ${prompt}`;
        this.statusBar.tooltip = step.description;
        this.statusBar.show();
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

    dispose(): void {
        this.statusBar.dispose();
        this.watcher?.dispose();
        for (const s of this.subs) {
            s.dispose();
        }
        this.subs = [];
    }
}
