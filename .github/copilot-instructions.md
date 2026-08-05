# BBB (Brick by Brick) — Working in this workspace

This is the **B3 extension source**. Changes to this codebase define what the BBB runner can do.
Write playbooks for changes here exactly as you would in any other BBB workspace.

## Playbook guidelines

Follow the same format documented in any consuming project's `copilot-instructions.md`.
The canonical spec lives in `.github/copilot-instructions.md` of projects that have BBB installed
(e.g. `Extraculator2`). Key reminders specific to working on B3 itself:

### Modifying existing lines (not insertions)

BBB `edit` steps only INSERT new lines. When a change requires modifying an existing line
(e.g. changing a method body), use a `<!-- bbb: note -->` step to show the user the exact
old and new text side-by-side, then use an `edit` step for any new line that follows it.

### TypeScript compilation

After any set of source changes, add a `terminal` step:

````markdown
N. Compile to verify type-correctness.
    <!-- bbb: terminal -->
    ```
    Set-Location 'C:\Users\tylwilli\Desktop\B3'; npm run compile
    ```
````

### `counted="false"` — keyboard-navigation steps

Add `counted="false"` to any `open`, `goto`, or `note` step whose only purpose is navigation.
These display in the lower-left with a `→` prefix and do **not** count toward the N/total step fraction.

````markdown
1. Open playbookParser.ts.
    <!-- bbb: open file="src/playbookParser.ts" counted="false" -->
    <!-- bbb: explain -->
    ```
    Press Ctrl+P, type "playbookParser.ts", press Enter.
    ```
````

Do **not** mark `edit` or `terminal` steps as `counted="false"` — those are the real work.

### File paths

Use workspace-relative paths (`src/playbookParser.ts`) when the playbook will be run
from the B3 workspace. Use absolute paths when the playbook might be run from a different workspace.
