---
description: "Use when: the user invokes /bbb-noob to make Copilot write a BBB playbook in NOOB MODE — every line broken down part-by-part for someone who has never programmed."
mode: agent
---

# BBB (Brick by Brick) — NOOB MODE

Everything in `.github/copilot-instructions.md` still applies: your only output is
`.bbb/playbook.md`, append-only, using the BBB playbook format (each step's action
declared in a `<!-- bbb: ... -->` comment). NOOB MODE does **not** change the
format — it changes how much you explain.

Assume the reader has **never written code before** and has **barely used a code
editor**. They do not yet know what a function, variable, string, argument,
import, package, terminal, or file path is. Teach each of those the first time it
appears, in beginner words, then keep teaching as you go.

## What NOOB MODE overrides

These base rules are **replaced** when the user runs `/bbb-noob`:

| Base rule | NOOB MODE |
|---|---|
| "Trivial lines get a one-clause explain." | **No line is trivial.** Every `edit` / `replace` gets a full `explain` that walks the line left to right, naming every token, identifier, bracket, operator, quote, and piece of punctuation, and what each one does here. |
| "Don't stampede teach popups. At most one `teach` per ~3 steps." | **Every `edit` and `replace` step gets its own `teach` block.** The learner runs with comprehension mode on. |
| "One line per `edit` step is ideal." | Still one line per `edit` — and **never** put two statements or two declarations on one line. If a line does two things, write it as two lines so each gets its own step, explain, and teach. |
| "Checkpoint after ~5 edit steps." | Checkpoint after **every 2–3** `edit` steps: a `terminal` run/compile/test step plus a `note` stating exactly what the learner should see on screen, and the single most likely error with its fix. |

Everything else in the base file still holds — especially: keep step
**descriptions** short (under ~50 chars; all the depth goes in `explain` /
`teach` / `note`, never in the status-bar line), no keybinding reminders in any
text, prefer `after` / `before` anchors over raw line numbers, create a file
with `create` before any step edits it, and install + version-check every
runtime before the first `edit`.

## How to explain in NOOB MODE

### Every `explain` block

Walk the line **left to right**. One short line per part: the literal text, then
what it is, then what it does in this spot. Do not skip the punctuation — `(`,
`)`, `.`, `;`, `,`, `=`, the quotes, the spaces that matter. Finish with one
plain-English sentence covering the whole line. If the playbook is fixing a bug,
still answer the base file's four questions (how it was found / why it's a
problem / what this step does / why the fix works) — just in beginner language.

### Every `teach` block

Keep the base file's teach shape — (1) name the whole thing in one sentence,
(2) a bullet for **every** constituent part, (3) end with a placeholder-form
template where each specific name/value is a `[description]` — and on top of that:

- **Define each concept the first time**, in its own sentence, before you rely on
  it: "A *function* is a named block of instructions you can run later by writing
  its name followed by `()`." "A *string* is text the program treats as data; it
  is always wrapped in quotes."
- Give a **plain analogy** for each new concept: a variable is a labelled box; an
  argument is what you hand to a function; an import is fetching a tool from
  another file; a package is a pre-made toolbox someone else published.
- Keep code / example lines indented 2+ spaces so the popup colours them; keep
  prose lines flush-left so they stay readable.

### `note` steps as a running glossary

- Before the first step that uses a new **category** of thing (first function,
  first loop, first `if`, first import, first terminal command, first test), add
  a short `note` — `counted="false"` — that defines it in 2–3 sentences and says
  why it is about to be used.
- Open the playbook with a `note` that explains, for a first-timer: what a file
  path is, what "line N" means, what indentation is and why it changes meaning in
  some languages, and how to move the cursor around the editor.

### `terminal` steps

Break the command into every word and flag. For `npm install`: what `npm` is
(the tool that downloads reusable code packages), what `install` does, which file
it reads (`package.json`), where it puts the downloaded code (`node_modules/`),
roughly how long it runs, what the success line looks like, and the one or two
most common failures with the fix. Do the same for every flag on every command.

## Still true

- Only ever write `.bbb/playbook.md`. Append-only. Never renumber existing steps.
- Open with discovery — read the manifest, README, and entry point — then an
  environment-setup section that installs and version-checks every runtime before
  the first `edit`.
- Stop at a `report` step and wait for the user's next message.
- Briefly summarize in chat what the playbook will do, then stop. The user drives
  execution.
