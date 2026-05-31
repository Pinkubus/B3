import * as vscode from "vscode";

/**
 * Singleton diagnostic log for BBB. Mirrors to console (visible in the Extension
 * Development Host's Debug Console) and to a VS Code OutputChannel the user can
 * reveal via `BBB: Show diagnostic log`.
 */
class BbbLog {
    private channel: vscode.OutputChannel | null = null;

    init(): vscode.OutputChannel {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel("BBB");
        }
        return this.channel;
    }

    show(preserveFocus = true): void {
        this.init().show(preserveFocus);
    }

    info(msg: string, data?: unknown): void {
        this.write("INFO", msg, data);
    }

    warn(msg: string, data?: unknown): void {
        this.write("WARN", msg, data);
    }

    error(msg: string, err?: unknown): void {
        let detail = "";
        if (err instanceof Error) {
            detail = `\n  ${err.message}\n${err.stack ?? ""}`;
        } else if (err !== undefined) {
            try {
                detail = "\n  " + JSON.stringify(err);
            } catch {
                detail = "\n  " + String(err);
            }
        }
        this.write("ERROR", msg + detail);
    }

    private write(level: string, msg: string, data?: unknown): void {
        const ts = new Date().toISOString().slice(11, 23);
        let line = `[${ts}] ${level} ${msg}`;
        if (data !== undefined) {
            try {
                line += " " + JSON.stringify(data);
            } catch {
                line += " " + String(data);
            }
        }
        // Mirror to console so it also shows in the EDH Debug Console.
        // eslint-disable-next-line no-console
        console.log("[bbb] " + line);
        this.channel?.appendLine(line);
    }
}

export const log = new BbbLog();
