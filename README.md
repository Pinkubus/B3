# BBB — Brick by Brick

A VS Code extension that forces **you** to perform Copilot's work, one step at a time.

You install a Copilot-instructions file that says: *"do not edit files; write a `.bbb/playbook.md` instead."* Copilot then writes a tiny playbook (one keystroke-chunk per step), and the BBB status bar walks you through it — open this file, go to that line, type this line, run this command — pressing `Ctrl+Alt+.` after each step to verify and advance.

---

## v0.2 — Playbook mode (primary)

### Setup

1. `npm install` then `npm run compile` (or `npm run watch`).
2. Press **F5** to launch the Extension Development Host.
3. In the new window, open a workspace folder.
4. Run **`BBB: Install Copilot instructions into this workspace`** — writes `.github/copilot-instructions.md`.
5. Ask Copilot (chat) to do something. It writes `.bbb/playbook.md` instead of editing files.
6. Run **`BBB: Start playbook lesson`**. The status bar shows step 1.
7. Perform the step and press **`Ctrl+Alt+.`** to verify and advance. If verification fails, the reason flashes in the status bar and you stay on the step.
8. When you hit a `report` step, paste the requested output back to Copilot. Copilot appends more steps; saving the playbook reloads it.

### Step actions

The playbook is a numbered markdown list. Each step has an HTML comment declaring its action, optionally followed by a fenced code block. Supported actions:

| Action | Purpose | Verify |
|---|---|---|
| `edit file="..." line="N" indent="K"` | Type a code chunk at a target line. Paired with `<!-- bbb: explain -->` whose body BBB renders as a comment on the line *below* the typing target *before* prompting. | Document line matches body (indent ≥ K). |
| `terminal` | Run a command in any terminal. | Matched against `onDidStartTerminalShellExecution` log; trusts user if shell integration is off. |
| `report` | Paste output back to Copilot. | Always passes — user signals readiness with the keybinding. |
| `open file="..."` | Navigate to a file. | Active editor URI matches. |
| `goto line="N"` | Move the cursor. | Cursor line matches. |
| `note` | Context only. | Always passes. |

Full format spec is in [resources/copilot-instructions.template.md](resources/copilot-instructions.template.md).

### Commands

| Command | What it does |
|---|---|
| `BBB: Install Copilot instructions into this workspace` | Writes the template to `.github/copilot-instructions.md`. |
| `BBB: Start playbook lesson` | Begins driving the playbook from step 1. |
| `BBB: Verify current step and advance` | Bound to `Ctrl+Alt+.` (Cmd+Alt+. on Mac). |
| `BBB: Open playbook` | Opens `.bbb/playbook.md`. |
| `BBB: Cancel current lesson` | Stops the runner. |

### Settings

| Setting | Default | Description |
|---|---|---|
| `bbb.playbookPath` | `.bbb/playbook.md` | Workspace-relative path BBB watches. |
| `bbb.autoStartOnSave` | `false` | Start a lesson automatically when the playbook is saved. |

---

## v0.1 — Ad-hoc drill (still available)

For drilling on an arbitrary snippet without involving Copilot: **`BBB: Practice edit from clipboard`** runs the original character-by-character drill.

---

## Limitations

- VS Code has no public API to intercept Copilot's edit tools; BBB redirects Copilot via its instructions file. Custom modes or user-edited instructions can override this.
- `onDidStartTerminalShellExecution` requires shell integration. With integration off, terminal steps trust the user.
- Line-offset tracking assumes only BBB-driven edits modify the file. Manual edits between steps can desync line numbers — cancel and restart if that happens.
- Format-on-save can rewrite an `edit` step's exact text and trip verification. Disable formatters for the target language during a lesson.
