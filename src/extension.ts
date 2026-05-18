import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { KeybindingResolver } from "./keybindings";
import { buildLesson, TargetEdit } from "./lessonEngine";
import { StepExecutor } from "./stepExecutor";
import { PlaybookRunner } from "./playbookRunner";

let activeLesson: StepExecutor | undefined;
let runner: PlaybookRunner | undefined;
const kb = new KeybindingResolver();

export function activate(context: vscode.ExtensionContext): void {
    runner = new PlaybookRunner(kb);
    context.subscriptions.push(
        { dispose: () => runner?.dispose() },
        vscode.commands.registerCommand("bbb.startPlaybook", () => startPlaybook()),
        vscode.commands.registerCommand("bbb.resume", () => runner?.advance()),
        vscode.commands.registerCommand("bbb.openPlaybook", () => openPlaybook()),
        vscode.commands.registerCommand("bbb.installCopilotInstructions", () =>
            installCopilotInstructions(context),
        ),
        vscode.commands.registerCommand("bbb.cancelLesson", () => cancelLesson()),
        vscode.commands.registerCommand("bbb.practiceEdit", () => practiceEdit()),
        vscode.commands.registerCommand("bbb.practiceFromClipboard", () =>
            practiceEdit({ fromClipboard: true }),
        ),
    );

    if (vscode.workspace.getConfiguration("bbb").get<boolean>("autoStartOnSave", false)) {
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (matchesPlaybookPath(doc.uri)) {
                    void runner?.start(doc.uri);
                }
            }),
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
    kb.refresh();
    await runner?.start(uri);
}

async function openPlaybook(): Promise<void> {
    const uri = playbookUriForActiveWorkspace();
    if (!uri) {
        void vscode.window.showErrorMessage("BBB: open a workspace folder first.");
        return;
    }
    await vscode.window.showTextDocument(uri);
}

async function installCopilotInstructions(context: vscode.ExtensionContext): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage("BBB: open a workspace folder first.");
        return;
    }
    const templatePath = path.join(
        context.extensionPath,
        "resources",
        "copilot-instructions.template.md",
    );
    let template: string;
    try {
        template = fs.readFileSync(templatePath, "utf8");
    } catch (err) {
        void vscode.window.showErrorMessage(`BBB: cannot read template: ${err}`);
        return;
    }
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
    await vscode.window.showTextDocument(targetFile);
    void vscode.window.showInformationMessage(
        "BBB: Copilot instructions installed. Ask Copilot to do something — it will write a playbook for you to perform.",
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
    kb.refresh();

    const target: TargetEdit = {
        uri: editor.document.uri,
        startLine: Number(lineStr),
        text,
    };
    const steps = buildLesson(target, kb);
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
