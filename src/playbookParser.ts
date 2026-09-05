/**
 * A parsed step from a `.bbb/playbook.md` file.
 * The runner dispatches each step to a handler by `kind`.
 */
export type PlaybookStep =
    | EditStep
    | ReplaceStep
    | CreateStep
    | TerminalStep
    | ReportStep
    | OpenStep
    | GotoStep
    | NoteStep;

interface BaseStep {
    /** 0-based index in the overall step list. */
    index: number;
    /** Human description shown in the status bar prompt. */
    description: string;
    /** Line in the playbook file where this step starts (for error messages). */
    sourceLine: number;
    /** Why this step matters — shown on demand via Ctrl+Alt+Shift+W. */
    explain: string;
    /** Optional comprehension note shown as a popup right after the user finishes this step. */
    teach?: string;
    /**
     * Whether this step counts toward the N/total status-bar fraction. Nav-only
     * steps (open/goto/note used purely for navigation) set counted="false" so
     * they render with a → prefix and don't inflate the progress denominator.
     * Defaults to true.
     */
    counted: boolean;
}

export interface EditStep extends BaseStep {
    kind: "edit";
    file: string;
    /** 1-based line the user is supposed to type on. */
    line: number;
    /** Required leading-whitespace width (spaces). */
    indent: number;
    /** Exact text to type. May contain `\n` for multi-line chunks (rare). */
    body: string;
    /** Optional broader code-region assertion verified after the specific line(s) pass. */
    validationSection?: ValidationSection;
    /**
     * Optional drift-proof anchor: the exact text of an existing line to insert
     * AFTER. When set, the insertion point is located by searching for this line
     * at verify/apply time, and `line` becomes a fallback only. Eliminates the
     * whole class of cross-step line-number-drift bugs.
     */
    after?: string;
    /** Optional anchor: insert BEFORE the line whose text matches this. */
    before?: string;
}

/** Replace an existing single line with new text (verified before and after). */
export interface ReplaceStep extends BaseStep {
    kind: "replace";
    file: string;
    /** 1-based line whose content will change. */
    line: number;
    /** The exact text the line must currently hold (guards against drift). */
    oldText: string;
    /** The exact text the line must hold after the edit. */
    newText: string;
}

/** Create (and open) a new empty file so later edit steps have somewhere to type. */
export interface CreateStep extends BaseStep {
    kind: "create";
    file: string;
}

/** Specifies a range of lines in a file that must match exactly after an edit step completes. */
export interface ValidationSection {
    /** Workspace-relative or absolute path of the file to check. */
    file: string;
    /** 1-based inclusive start line. */
    start: number;
    /** 1-based inclusive end line. */
    end: number;
    /** Exact expected content of lines start..end joined with "\n". */
    expected: string;
}

export interface TerminalStep extends BaseStep {
    kind: "terminal";
    /** Command line to run. */
    body: string;
    cwd?: string;
}

export interface ReportStep extends BaseStep {
    kind: "report";
}

export interface OpenStep extends BaseStep {
    kind: "open";
    file: string;
}

export interface GotoStep extends BaseStep {
    kind: "goto";
    line: number;
}

export interface NoteStep extends BaseStep {
    kind: "note";
}

export interface ParseResult {
    steps: PlaybookStep[];
    warnings: string[];
}

const NUMBERED_ITEM = /^(\s*)(\d+)\.\s+(.*)$/;
const BBB_COMMENT = /<!--\s*bbb:\s*(\w+)\s*(.*?)\s*-->/;
const ATTR = /(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
const FENCE = /^(\s*)```(\S*)\s*$/;

/**
 * Parse a playbook markdown document into a list of steps.
 * Best-effort: malformed steps are skipped with a warning rather than thrown.
 */
export function parsePlaybook(text: string): ParseResult {
    const lines = text.split(/\r?\n/);
    const warnings: string[] = [];
    const blocks = splitIntoStepBlocks(lines);
    const steps: PlaybookStep[] = [];

    for (const block of blocks) {
        const step = parseStepBlock(block, steps.length, warnings);
        if (step) {
            steps.push(step);
        }
    }
    return { steps, warnings };
}

interface StepBlock {
    sourceLine: number;
    description: string;
    /** Raw body lines after the numbered header (indented under it). */
    bodyLines: string[];
}

function splitIntoStepBlocks(lines: string[]): StepBlock[] {
    const blocks: StepBlock[] = [];
    let current: StepBlock | null = null;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(NUMBERED_ITEM);
        if (m) {
            if (current) {
                blocks.push(current);
            }
            current = {
                sourceLine: i + 1,
                description: m[3].trim(),
                bodyLines: [],
            };
        } else if (current) {
            current.bodyLines.push(lines[i]);
        }
    }
    if (current) {
        blocks.push(current);
    }
    return blocks;
}

interface ExtractedBbbBlock {
    action: string;
    attrs: Record<string, string>;
    body: string | null;
}

/**
 * Walk a step's body lines, collecting bbb-comment / fenced-code pairs.
 * Each comment may optionally be followed by a fenced code block (its body).
 */
function extractBbbBlocks(bodyLines: string[]): ExtractedBbbBlock[] {
    const out: ExtractedBbbBlock[] = [];
    let i = 0;
    while (i < bodyLines.length) {
        const line = bodyLines[i];
        const m = line.match(BBB_COMMENT);
        if (!m) {
            i++;
            continue;
        }
        const block: ExtractedBbbBlock = {
            action: m[1],
            attrs: parseAttrs(m[2]),
            body: null,
        };
        // Look ahead for a fenced code block, skipping blank lines.
        let j = i + 1;
        while (j < bodyLines.length && bodyLines[j].trim() === "") {
            j++;
        }
        if (j < bodyLines.length) {
            const fenceOpen = bodyLines[j].match(FENCE);
            if (fenceOpen) {
                const fenceIndent = fenceOpen[1].length;
                const collected: string[] = [];
                let k = j + 1;
                while (k < bodyLines.length) {
                    const fenceClose = bodyLines[k].match(FENCE);
                    if (fenceClose && fenceClose[1].length === fenceIndent) {
                        break;
                    }
                    // Strip the same indent the fence had, so the body matches the user's expected text.
                    collected.push(bodyLines[k].slice(fenceIndent));
                    k++;
                }
                block.body = collected.join("\n");
                i = k + 1;
                out.push(block);
                continue;
            }
        }
        out.push(block);
        i++;
    }
    return out;
}

function parseAttrs(s: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    let m: RegExpExecArray | null;
    const re = new RegExp(ATTR.source, "g");
    while ((m = re.exec(s)) !== null) {
        attrs[m[1]] = m[2].replace(/\\"/g, '"');
    }
    return attrs;
}

function parseStepBlock(
    block: StepBlock,
    index: number,
    warnings: string[],
): PlaybookStep | null {
    const bbb = extractBbbBlocks(block.bodyLines);
    if (bbb.length === 0) {
        warnings.push(`Line ${block.sourceLine}: step has no <!-- bbb: ... --> action; skipped.`);
        return null;
    }

    // The action is the first block that isn't a modifier block (explain,
    // validate-section, teach) or a replace sub-block (old, new).
    const MODIFIER_ACTIONS = new Set(["explain", "validate-section", "teach", "old", "new"]);
    const actionBlock = bbb.find((b) => !MODIFIER_ACTIONS.has(b.action));
    if (!actionBlock) {
        warnings.push(`Line ${block.sourceLine}: step has only 'explain' but no action; skipped.`);
        return null;
    }
    const explainBlock = bbb.find((b) => b.action === "explain");
    const explain = actionBlock.attrs.explain ?? explainBlock?.body ?? explainBlock?.attrs.text ?? "";
    if (!explain) {
        warnings.push(`Line ${block.sourceLine}: step has no explain — add explain="..." or a <!-- bbb: explain --> block.`);
    }

    const teachBlock = bbb.find((b) => b.action === "teach");
    const teach = teachBlock?.body ?? teachBlock?.attrs.text ?? undefined;

    // A step is nav-only (uncounted) when it carries counted="false".
    const counted = actionBlock.attrs.counted !== "false";

    const base = {
        index,
        description: block.description,
        sourceLine: block.sourceLine,
        explain,
        teach,
        counted,
    };

    switch (actionBlock.action) {
        case "edit": {
            const file = actionBlock.attrs.file;
            const line = Number(actionBlock.attrs.line);
            if (!file || !Number.isInteger(line) || line < 1) {
                warnings.push(
                    `Line ${block.sourceLine}: 'edit' requires file="..." and line="N" (1-based).`,
                );
                return null;
            }
            if (actionBlock.body === null) {
                warnings.push(`Line ${block.sourceLine}: 'edit' requires a fenced code block body.`);
                return null;
            }
            const indent = actionBlock.attrs.indent ? Number(actionBlock.attrs.indent) : 0;
            // Parse the optional validate-section block.
            const sectionBlock = bbb.find((b) => b.action === "validate-section");
            let validationSection: ValidationSection | undefined;
            if (sectionBlock?.body != null) {
                const sFile = sectionBlock.attrs.file ?? file;
                const sStart = Number(sectionBlock.attrs.start);
                const sEnd = Number(sectionBlock.attrs.end);
                if (Number.isInteger(sStart) && Number.isInteger(sEnd) && sStart >= 1 && sEnd >= sStart) {
                    validationSection = { file: sFile, start: sStart, end: sEnd, expected: sectionBlock.body };
                } else {
                    warnings.push(
                        `Line ${block.sourceLine}: 'validate-section' requires start="N" end="M" (1-based, end ≥ start); ignored.`,
                    );
                }
            }
            return {
                ...base,
                kind: "edit",
                file,
                line,
                indent: Number.isFinite(indent) ? indent : 0,
                body: actionBlock.body,
                validationSection,
                after: actionBlock.attrs.after,
                before: actionBlock.attrs.before,
            };
        }
        case "replace": {
            const file = actionBlock.attrs.file;
            const line = Number(actionBlock.attrs.line);
            if (!file || !Number.isInteger(line) || line < 1) {
                warnings.push(
                    `Line ${block.sourceLine}: 'replace' requires file="..." and line="N" (1-based).`,
                );
                return null;
            }
            const oldBlock = bbb.find((b) => b.action === "old");
            const newBlock = bbb.find((b) => b.action === "new");
            if (oldBlock?.body == null || newBlock?.body == null) {
                warnings.push(
                    `Line ${block.sourceLine}: 'replace' requires an <!-- bbb: old --> and <!-- bbb: new --> fenced block.`,
                );
                return null;
            }
            return {
                ...base,
                kind: "replace",
                file,
                line,
                oldText: oldBlock.body,
                newText: newBlock.body,
            };
        }
        case "create": {
            const file = actionBlock.attrs.file;
            if (!file) {
                warnings.push(`Line ${block.sourceLine}: 'create' requires file="...".`);
                return null;
            }
            return { ...base, kind: "create", file };
        }
        case "terminal": {
            if (actionBlock.body === null) {
                warnings.push(`Line ${block.sourceLine}: 'terminal' requires a fenced code block body.`);
                return null;
            }
            return {
                ...base,
                kind: "terminal",
                body: actionBlock.body.trim(),
                cwd: actionBlock.attrs.cwd,
            };
        }
        case "report":
            return { ...base, kind: "report" };
        case "open": {
            const file = actionBlock.attrs.file;
            if (!file) {
                warnings.push(`Line ${block.sourceLine}: 'open' requires file="...".`);
                return null;
            }
            return { ...base, kind: "open", file };
        }
        case "goto": {
            const line = Number(actionBlock.attrs.line);
            if (!Number.isInteger(line) || line < 1) {
                warnings.push(`Line ${block.sourceLine}: 'goto' requires line="N" (1-based).`);
                return null;
            }
            return { ...base, kind: "goto", line };
        }
        case "note":
            return { ...base, kind: "note" };
        default:
            warnings.push(
                `Line ${block.sourceLine}: unknown action '${actionBlock.action}'; skipped.`,
            );
            return null;
    }
}
