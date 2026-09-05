# BBB — Brick by Brick

A VS Code extension that forces **you** to perform Copilot's work, one step at a time.

You install a Copilot-instructions file that says: *"do not edit files; write a `.bbb/playbook.md` instead."* Copilot then writes a tiny playbook (one keystroke-chunk per step), and the BBB status bar walks you through it — open this file, go to that line, type this line, run this command — pressing `Ctrl+Alt+.` after each step to verify and advance.

---

## v0.2 — Playbook mode (primary)

### Setup

1. `npm install` then `npm run compile` (or `npm run watch`).
2. Press **F5** to launch the Extension Development Host.
3. In the new window, open a workspace folder.
4. Run **`BBB: Install Copilot instructions into this workspace`** — writes `.github/copilot-instructions.md` and `.github/prompts/bbb.prompt.md`.
5. Type `/bbb` in Copilot Chat and ask it to do something. It writes `.bbb/playbook.md` instead of editing files.
6. Run **`BBB: Start playbook lesson`**. The status bar shows step 1.
7. Perform the step and press **`Ctrl+Alt+.`** to verify and advance. If verification fails, the reason flashes in the status bar and you stay on the step.
8. When you hit a `report` step, paste the requested output back to Copilot. Copilot appends more steps; saving the playbook reloads it.

### Step actions

The playbook is a numbered markdown list. Each step has an HTML comment declaring its action, optionally followed by a fenced code block. Supported actions:

| Action | Purpose | Verify |
|---|---|---|
| `edit file="..." line="N" indent="K"` | Type a code chunk at a target line (or after/before a text `anchor`). Paired with `<!-- bbb: explain -->`. | Document line matches body (indent ≥ K). |
| `replace file="..." line="N"` | Change an existing line. Carries `<!-- bbb: old -->` and `<!-- bbb: new -->` blocks. | Line equals `new` (and was `old` before). |
| `create file="..."` | Scaffold and open a new empty file (plus parent folders) so later edits have a target. | File exists. |
| `terminal` | Run a command in any terminal. | Lenient match against `onDidStartTerminalShellExecution` log; trusts user if shell integration is off. |
| `report` | Paste output back to Copilot. | Always passes — user signals readiness with the keybinding. |
| `open file="..."` | Navigate to a file. | File open in any visible editor group. |
| `goto line="N"` | Move the cursor. | Cursor within ±2 lines of N. |
| `validate-section start="N" end="M"` | (Modifier on `edit`) assert a broader line range matches after the edit. | Range matches exactly. |
| `teach` | (Modifier) pop up a "what you just wrote" explanation when the step completes. | — |
| `note` | Context only. Add `counted="false"` on nav-only steps. | Always passes. |

Full format spec is in [resources/copilot-instructions.template.md](resources/copilot-instructions.template.md).

### Commands

| Command | Shortcut |
|---|---|
| `BBB: Install Copilot instructions into this workspace` | Command Palette |
| `BBB: Start playbook lesson` | Command Palette |
| `BBB: Verify current step and advance` | `Ctrl+Alt+.` |
| `BBB: Go back one step` | `Ctrl+Alt+,` |
| `BBB: Skip current step` | `Ctrl+Alt+\` |
| `BBB: Apply current step for me` | `Ctrl+Alt+Shift+U` |
| `BBB: Show why (explain current step)` | `Ctrl+Alt+Shift+W` |
| `BBB: Show why this step can't advance` | `Ctrl+Alt+R` |
| `BBB: Toggle comprehension mode` | `Ctrl+Alt+C` |
| `BBB: Toggle presentation mode (other-screen window)` | `Ctrl+Alt+M` |
| `BBB: Explain the highlighted selection` | `Alt+Shift+Y` |
| `BBB: Toggle instruction text` | `Alt+Z` |
| `BBB: Open playbook` | Command Palette |
| `BBB: Cancel current lesson` | Command Palette |

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
- Line-number targets assume only BBB-driven edits modify the file. Manual edits between steps can desync them — prefer `after`/`before` anchors (drift-proof), or cancel and restart if numbers desync.
- Format-on-save can rewrite an `edit` step's exact text and trip verification. Disable formatters for the target language during a lesson.
