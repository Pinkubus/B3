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

This writes `.github/copilot-instructions.md` into the workspace. It tells Copilot: *"Don't edit files — write a playbook instead."*

---

## 4. Ask Copilot to do something

Open Copilot Chat and ask it to implement anything — add a function, create a file, whatever.  
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
| `BBB: Open playbook` | Command Palette |
| `BBB: Cancel current lesson` | Command Palette |

---

## If something goes wrong

- **Steps go out of sync** (you edited the file manually between steps): run `BBB: Cancel current lesson`, fix the file, then `BBB: Start playbook lesson` again.
- **Format-on-save is messing up verification**: disable the formatter for that language while you're in a lesson.
- **Terminal steps always pass even if you didn't run the command**: shell integration is off in that terminal — open a new terminal with shell integration enabled, or trust yourself and press `Ctrl+Alt+.`.
