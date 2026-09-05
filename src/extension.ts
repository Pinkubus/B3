import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { KeybindingResolver } from "./keybindings";
import { buildLesson, TargetEdit } from "./lessonEngine";
import { StepExecutor } from "./stepExecutor";
import { PlaybookRunner } from "./playbookRunner";
import { log } from "./log";

let activeLesson: StepExecutor | undefined;
let runner: PlaybookRunner | undefined;
let kb: KeybindingResolver | undefined;

export function activate(context: vscode.ExtensionContext): void {
    const channel = log.init();
    context.subscriptions.push(channel);
    log.info("activate() called", {
        extensionPath: context.extensionPath,
        vscodeVersion: vscode.version,
        nodeVersion: process.versions.node,
        platform: process.platform,
        workspaceFolders: vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [],
    });

    try {
        kb = new KeybindingResolver();
        log.info("KeybindingResolver constructed");
    } catch (err) {
        log.error("KeybindingResolver constructor threw", err);
        // Fall through with a stub so activation still completes; commands that need kb will guard.
    }

    try {
        runner = new PlaybookRunner(kb ?? new KeybindingResolver(), context.globalState);
        log.info("PlaybookRunner constructed");
    } catch (err) {
        log.error("PlaybookRunner constructor threw", err);
        void vscode.window.showErrorMessage(
            "BBB failed to start. Run `BBB: Show diagnostic log` for details.",
        );
        return;
    }

    try {
        context.subscriptions.push(
            { dispose: () => runner?.dispose() },
            vscode.commands.registerCommand("bbb.showLog", () => log.show(false)),
            vscode.commands.registerCommand("bbb.startPlaybook", () => guard("startPlaybook", startPlaybook)),
            vscode.commands.registerCommand("bbb.resume", () => guard("resume", () => runner?.advance())),
            vscode.commands.registerCommand("bbb.openPlaybook", () => guard("openPlaybook", openPlaybook)),
            vscode.commands.registerCommand("bbb.installCopilotInstructions", () =>
                guard("installCopilotInstructions", () => installCopilotInstructions(context)),
            ),
            vscode.commands.registerCommand("bbb.cancelLesson", () => guard("cancelLesson", cancelLesson)),
            vscode.commands.registerCommand("bbb.practiceEdit", () => guard("practiceEdit", () => practiceEdit())),
            vscode.commands.registerCommand("bbb.practiceFromClipboard", () =>
                guard("practiceFromClipboard", () => practiceEdit({ fromClipboard: true })),
            ),
            vscode.commands.registerCommand("bbb.stopLesson", () => guard("stopLesson", () => runner?.stop())),
            vscode.commands.registerCommand("bbb.rewind", () => guard("rewind", () => runner?.rewind())),
            vscode.commands.registerCommand("bbb.toggleInstructions", () =>
                guard("toggleInstructions", () => runner?.toggleInstructions()),
            ),
            vscode.commands.registerCommand("bbb.skipStep", () => guard("skipStep", () => runner?.skipStep())),
            vscode.commands.registerCommand("bbb.showWhy", () => guard("showWhy", () => runner?.showWhy())),
            vscode.commands.registerCommand("bbb.applyStep", () => guard("applyStep", () => runner?.applyCurrentStep())),
            vscode.commands.registerCommand("bbb.showValidationReason", () => guard("showValidationReason", () => runner?.showValidationReason())),
            vscode.commands.registerCommand("bbb.toggleComprehension", () => guard("toggleComprehension", () => runner?.toggleComprehension())),
            vscode.commands.registerCommand("bbb.togglePresentationMode", () => guard("togglePresentationMode", () => runner?.togglePresentationMode())),
            vscode.commands.registerCommand("bbb.explainSelection", () => guard("explainSelection", explainSelection)),
        );
        log.info("commands registered");
    } catch (err) {
        log.error("command registration threw", err);
        void vscode.window.showErrorMessage(
            "BBB command registration failed. Run `BBB: Show diagnostic log` for details.",
        );
        return;
    }

    try {
        if (vscode.workspace.getConfiguration("bbb").get<boolean>("autoStartOnSave", false)) {
            context.subscriptions.push(
                vscode.workspace.onDidSaveTextDocument((doc) => {
                    if (matchesPlaybookPath(doc.uri)) {
                        log.info("autoStartOnSave triggered", { uri: doc.uri.toString() });
                        void runner?.start(doc.uri);
                    }
                }),
            );
            log.info("autoStartOnSave watcher attached");
        }
    } catch (err) {
        log.error("autoStartOnSave setup threw", err);
    }

    // Auto-install Copilot instructions and the /bbb prompt on first activation
    // in any workspace that doesn't have them yet. Without these, Copilot edits
    // files directly and BBB has nothing to drive. Controlled by
    // `bbb.autoInstallInstructions` (default true) so users who don't want this
    // can opt out.
    try {
        if (vscode.workspace.getConfiguration("bbb").get<boolean>("autoInstallInstructions", true)) {
            void ensureCopilotCustomizations(context);
        }
    } catch (err) {
        log.error("auto-install Copilot customizations check threw", err);
    }

    log.info("activate() complete");
    // Reveal the log on activation so first-run problems are obvious.
    log.show(true);
}

async function guard(name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
    log.info(`command:${name} invoked`);
    try {
        await fn();
        log.info(`command:${name} ok`);
    } catch (err) {
        log.error(`command:${name} threw`, err);
        void vscode.window.showErrorMessage(
            `BBB: ${name} failed — see "BBB" output channel for details.`,
        );
    }
}

export function deactivate(): void {
    cancelLesson();
    runner?.dispose();
    runner = undefined;
}

function playbookUriForActiveWorkspace(): vscode.Uri | null {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return null;
    }
    const rel = vscode.workspace
        .getConfiguration("bbb")
        .get<string>("playbookPath", ".bbb/playbook.md");
    return vscode.Uri.joinPath(folder.uri, rel);
}

function matchesPlaybookPath(uri: vscode.Uri): boolean {
    const expected = playbookUriForActiveWorkspace();
    return expected !== null && uri.toString() === expected.toString();
}

async function startPlaybook(): Promise<void> {
    const uri = playbookUriForActiveWorkspace();
    if (!uri) {
        void vscode.window.showErrorMessage("BBB: open a workspace folder first.");
        return;
    }
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        const pick = await vscode.window.showInformationMessage(
            `BBB: no playbook at ${vscode.workspace.asRelativePath(uri)}. Ask Copilot to write one, then run this command again.`,
            "Open empty playbook",
        );
        if (pick === "Open empty playbook") {
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode("# BBB playbook\n\n"));
            await vscode.window.showTextDocument(uri);
        }
        return;
    }
    kb?.refresh();
    await runner?.start(uri);
}

/**
 * Ask Copilot (inline chat) to explain the current selection: what the whole
 * thing does and what each constituent part does. Mirrors pressing Ctrl+I and
 * typing the question.
 */
async function explainSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
        void vscode.window.showInformationMessage(
            "BBB: highlight some code first, then press Alt+Shift+Y.",
        );
        return;
    }
    const question =
        "What is this? Explain what the entire highlighted selection does, then break down what each of its constituent parts does.";
    if (runner?.presentationModeActive) {
        // Inline chat renders as an in-editor overlay with no API to redirect its
        // output elsewhere, so route through the dockable Chat panel instead —
        // the user can drag that to the second monitor alongside the BBB panel.
        await vscode.commands.executeCommand("workbench.action.chat.open", question);
        return;
    }
    try {
        await vscode.commands.executeCommand("inlineChat.start", {
            message: question,
            autoSend: true,
        });
    } catch (err) {
        log.warn("inlineChat.start with message failed; falling back", err);
        try {
            await vscode.commands.executeCommand("inlineChat.start");
        } catch {
            await vscode.commands.executeCommand("workbench.action.chat.open", question);
        }
    }
}

async function openPlaybook(): Promise<void> {
    const uri = playbookUriForActiveWorkspace();
    if (!uri) {
        void vscode.window.showErrorMessage("BBB: open a workspace folder first.");
        return;
    }
    await vscode.window.showTextDocument(uri);
}

const BBB_INSTRUCTIONS_MARKER = "# BBB (Brick by Brick) — Working with this user";

async function ensureCopilotCustomizations(context: vscode.ExtensionContext): Promise<void> {
    await ensureCopilotInstructions(context);
    await ensureBbbPrompt(context);
}

/**
 * Silent install used on activation. No prompts, no toasts, no editor opening.
 * - If the file is missing, write the template.
 * - If the file exists but doesn't contain our marker, append it.
 * - If the marker is already present, do nothing.
 */
async function ensureCopilotInstructions(context: vscode.ExtensionContext): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }
    const template = readInstructionsTemplate(context);
    if (!template) {
        return;
    }
    const targetDir = vscode.Uri.joinPath(folder.uri, ".github");
    const targetFile = vscode.Uri.joinPath(targetDir, "copilot-instructions.md");

    let existing: string | null = null;
    try {
        existing = new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(targetFile));
    } catch {
        // missing — fall through to create
    }

    if (existing === null) {
        await vscode.workspace.fs.createDirectory(targetDir);
        await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(template));
        log.info("auto-installed copilot instructions", { uri: targetFile.toString() });
        return;
    }

    if (existing.includes(BBB_INSTRUCTIONS_MARKER)) {
        log.info("copilot instructions already contain BBB section; nothing to do");
        return;
    }

    const combined = existing.replace(/\s+$/, "") + "\n\n" + template;
    await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(combined));
    log.info("auto-appended BBB section to existing copilot instructions", {
        uri: targetFile.toString(),
    });
}

function readInstructionsTemplate(context: vscode.ExtensionContext): string | null {
    const templatePath = path.join(
        context.extensionPath,
        "resources",
        "copilot-instructions.template.md",
    );
    try {
        return fs.readFileSync(templatePath, "utf8");
    } catch (err) {
        log.error("cannot read instructions template", err);
        return null;
    }
}

function readPromptTemplate(context: vscode.ExtensionContext): string | null {
    const templatePath = path.join(context.extensionPath, "resources", "bbb.prompt.md");
    try {
        return fs.readFileSync(templatePath, "utf8");
    } catch (err) {
        log.error("cannot read /bbb prompt template", err);
        return null;
    }
}

async function ensureBbbPrompt(context: vscode.ExtensionContext): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return;
    }
    const template = readPromptTemplate(context);
    if (!template) {
        return;
    }
    const targetDir = vscode.Uri.joinPath(folder.uri, ".github", "prompts");
    const targetFile = vscode.Uri.joinPath(targetDir, "bbb.prompt.md");
    try {
        await vscode.workspace.fs.stat(targetFile);
        log.info("/bbb prompt already installed; nothing to do", { uri: targetFile.toString() });
        return;
    } catch {
        // missing — fall through to create
    }
    await vscode.workspace.fs.createDirectory(targetDir);
    await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(template));
    log.info("auto-installed /bbb prompt", { uri: targetFile.toString() });
}

async function installCopilotInstructions(context: vscode.ExtensionContext): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage("BBB: open a workspace folder first.");
        return;
    }
    const template = readInstructionsTemplate(context);
    if (!template) {
        void vscode.window.showErrorMessage("BBB: cannot read template — see BBB output.");
        return;
    }
    const promptTemplate = readPromptTemplate(context);
    const targetDir = vscode.Uri.joinPath(folder.uri, ".github");
    const targetFile = vscode.Uri.joinPath(targetDir, "copilot-instructions.md");
    let exists = false;
    try {
        await vscode.workspace.fs.stat(targetFile);
        exists = true;
    } catch {
        // not present
    }
    if (exists) {
        const pick = await vscode.window.showWarningMessage(
            "BBB: .github/copilot-instructions.md already exists. Append BBB section?",
            "Append",
            "Open existing",
            "Cancel",
        );
        if (pick === "Cancel" || pick === undefined) {
            return;
        }
        if (pick === "Open existing") {
            await vscode.window.showTextDocument(targetFile);
            return;
        }
        const existing = new TextDecoder("utf-8").decode(
            await vscode.workspace.fs.readFile(targetFile),
        );
        const combined = existing.replace(/\s+$/, "") + "\n\n" + template;
        await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(combined));
    } else {
        await vscode.workspace.fs.createDirectory(targetDir);
        await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(template));
    }
    if (promptTemplate) {
        await ensureBbbPrompt(context);
    }
    await vscode.window.showTextDocument(targetFile);
    void vscode.window.showInformationMessage(
        "BBB: Copilot instructions installed. Use /bbb in Copilot Chat to write a playbook for you to perform.",
    );
}

// ---------- v0.1 ad-hoc drill (kept for quick practice) ----------

async function practiceEdit(opts: { fromClipboard?: boolean } = {}): Promise<void> {
    if (activeLesson) {
        const pick = await vscode.window.showWarningMessage(
            "A BBB lesson is already in progress. Cancel it?",
            "Cancel current lesson",
            "Keep it",
        );
        if (pick !== "Cancel current lesson") {
            return;
        }
        cancelLesson();
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        void vscode.window.showErrorMessage(
            "BBB: open a file first — the lesson needs a target editor.",
        );
        return;
    }

    let text: string | undefined;
    if (opts.fromClipboard) {
        text = await vscode.env.clipboard.readText();
        if (!text) {
            void vscode.window.showErrorMessage("BBB: clipboard is empty.");
            return;
        }
    } else {
        text = await vscode.window.showInputBox({
            prompt: "Paste the code you want to practice typing",
            placeHolder: "e.g. def hello():\\n    print('hi')",
            ignoreFocusOut: true,
        });
        if (!text) {
            return;
        }
        // showInputBox doesn't allow real newlines — let the user use literal \n.
        text = text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    }

    const lineStr = await vscode.window.showInputBox({
        prompt: `Target start line (1-based). Current cursor is at line ${editor.selection.active.line + 1}.`,
        value: String(editor.selection.active.line + 1),
        validateInput: (v) =>
            /^\d+$/.test(v) && Number(v) >= 1 ? undefined : "Enter a positive integer",
    });
    if (!lineStr) {
        return;
    }

    // Refresh user keybindings each lesson — cheap, and picks up live changes.
    kb?.refresh();

    const target: TargetEdit = {
        uri: editor.document.uri,
        startLine: Number(lineStr),
        text,
    };
    const steps = buildLesson(target, kb ?? new KeybindingResolver());
    activeLesson = new StepExecutor(steps, strictModeEnabled());
    try {
        await activeLesson.run();
    } finally {
        activeLesson = undefined;
    }
}

function cancelLesson(): void {
    activeLesson?.cancel();
    activeLesson = undefined;
}

function strictModeEnabled(): boolean {
    return vscode.workspace.getConfiguration("bbb").get<boolean>("strictTyping", true);
}
