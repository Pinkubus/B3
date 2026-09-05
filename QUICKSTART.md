# BBB — Quick Start

BBB (Brick by Brick) makes you type every edit yourself, one step at a time, while Copilot plans the work. This file covers the minimum you need to get running.

---

## 1. Build the extension

In the B3 folder, run once:

```
npm install
npm run compile
```

> After that, `npm run watch` keeps it rebuilt automatically as you edit the source.

---

## 2. Launch it

Press **F5** inside VS Code with the B3 folder open.  
A second VS Code window opens — the **Extension Development Host**. Do your work in there.

---

## 3. Set up a workspace to drill in

In the Extension Development Host window:

1. Open (or create) any folder you want to practice in.
2. Open the **Command Palette** (`Ctrl+Shift+P`) and run:  
   **`BBB: Install Copilot instructions into this workspace`**

This writes `.github/copilot-instructions.md` and `.github/prompts/bbb.prompt.md` into the workspace. The prompt makes `/bbb` available in Copilot Chat, and the instructions tell Copilot: *"Don't edit files — write a playbook instead."*

---

## 4. Ask Copilot to do something

Open Copilot Chat and type `/bbb`, then ask it to implement anything — add a function, create a file, whatever.  
Instead of editing files directly, it will write (or append to) **`.bbb/playbook.md`** with numbered steps.

---

## 5. Run the lesson

Open the Command Palette and run:  
**`BBB: Start playbook lesson`**

The status bar at the bottom shows the first step.

---

## 6. Work through the steps

1. Read the step in the status bar.
2. Do what it says — type the code, run the command, paste the output back to Copilot.
3. Press **`Ctrl+Alt+.`** (Mac: `Cmd+Alt+.`) to verify and advance.
   - If verification passes, you move to the next step.
   - If it fails, the reason flashes in the status bar and you stay on the current step.

When you hit a **`report`** step, paste the requested output back to Copilot in chat. Copilot appends more steps to the playbook, and saving the file reloads the lesson automatically.

---

## Commands at a glance

| Command | Shortcut / where |
|---|---|
| `BBB: Start playbook lesson` | Command Palette |
| `BBB: Verify current step and advance` | `Ctrl+Alt+.` |
| `BBB: Go back one step` | `Ctrl+Alt+,` |
| `BBB: Skip current step` | `Ctrl+Alt+\` |
| `BBB: Apply current step for me` | `Ctrl+Alt+Shift+U` |
| `BBB: Show why (explain current step)` | `Ctrl+Alt+Shift+W` |
| `BBB: Show why this step can't advance` | `Ctrl+Alt+R` |
| `BBB: Toggle comprehension mode` | `Ctrl+Alt+C` |
| `BBB: Toggle presentation mode (other-screen window)` | `Ctrl+Alt+M` |
| `BBB: Explain the highlighted selection` | `Alt+Shift+Y` (editor focus) |
| `BBB: Open playbook` | Command Palette |
| `BBB: Cancel current lesson` | Command Palette |

---

## Presentation mode (second monitor)

Press **`Ctrl+Alt+M`** to toggle presentation mode. When on, the status bar
shrinks to a compact position indicator and the full, untruncated
instructions for the current step render instead in a separate **"BBB —
Instructions"** panel. Drag that panel's tab out to a second monitor to
detach it into its own window — it keeps updating in place as you press
`Ctrl+Alt+.` to advance, so the editor stays on one screen and the
instructions stay on the other.

While presentation mode is on, `BBB: Show why this step can't advance` also
renders into that panel instead of a modal, and `BBB: Explain the
highlighted selection` opens VS Code's Chat panel (also dockable to a second
monitor) instead of the in-editor inline chat overlay.


---

## If something goes wrong

- **Steps go out of sync** (you edited the file manually between steps): run `BBB: Cancel current lesson`, fix the file, then `BBB: Start playbook lesson` again.
- **Format-on-save is messing up verification**: disable the formatter for that language while you're in a lesson.
- **Terminal steps always pass even if you didn't run the command**: shell integration is off in that terminal — open a new terminal with shell integration enabled, or trust yourself and press `Ctrl+Alt+.`.
