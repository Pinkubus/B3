# BBB (Brick by Brick) — Working with this user

**STOP before doing anything else. You must NOT edit files or run commands autonomously. Your only output is a playbook at `.bbb/playbook.md` that the user executes step by step.**

This workspace has the **BBB extension** installed. The user is learning by performing every edit themselves.

## How to work

1. When the user asks you to do something that would normally involve editing files or running commands:
   - **Do not call `edit_file`, `create_file`, `apply_patch`, or similar tools** on any file except `.bbb/playbook.md`.
   - **Do not call terminal tools, browser tools, or any other execution tools.**
   - **You may read files directly** (file-reading/search tools) to gather context, confirm content, and get accurate line numbers — reading is not editing. Only write a `terminal` step (e.g. `cat src/app.py`) plus a `report` step, then stop, for things you genuinely can't get by reading files yourself.
   - Instead, **append steps to `.bbb/playbook.md`**. Use `create_file` / `replace_string_in_file` only on that single playbook file.
2. Keep each step tiny — one line of code per `edit` step is ideal. The user types it themselves.
3. Stop writing more steps when you reach a point where you need information you don't have that reading files can't provide (e.g. command output, behavior verification). Write a `terminal` step to gather it and a `report` step asking the user to paste output back. Then stop and wait for the user's next message.
4. After the user pastes new information, continue by **appending** more steps to the playbook. Never rewrite earlier steps; the runner tracks progress by index.
5. Briefly summarize in chat what the playbook will do, then stop. The user drives execution.

## When the user asks you to just do it / pull the data now

If the user explicitly asks you to run something, create files, or fetch live
information directly rather than waiting for them, you may do so — reading
files and running non-destructive/informational commands (scripts, API
calls, discovery) is allowed. Still mirror every meaningful action into
`.bbb/playbook.md` as the equivalent step(s), append-only, so the playbook
remains a complete, accurate walkthrough the user can replay or learn from
later. **Never handle secrets yourself**: don't read `.env`/token files,
don't type real secrets into commands, and don't ask the user to paste them
in chat — write those as a step for the user to do themselves, then wait.

## Playbook format

The file is a numbered markdown list. Each list item is one step. The action is declared in an HTML comment, followed (if applicable) by a fenced code block holding the body. Indent the comment + fence under the list item.

### `edit` — type a code chunk at a specific line

````markdown
1. Add a hello function.
    <!-- bbb: edit file="src/app.py" line="1" indent="0" -->
    ```python
    def hello():
    ```
    <!-- bbb: explain -->
    ```
    Defines a new function called hello.
    The body goes on the next line.
    ```
````

- `file` (required): workspace-relative path.
- **Prefer `after` / `before` anchors over raw line numbers.** They make placement drift-proof: BBB finds the anchor line at run time and inserts relative to it, so earlier inserts can never push a later step's target out of alignment.
  - `after="<exact existing line text>"` — insert immediately **after** the line whose text matches. Use the last line of the chunk you just added in the previous step as the anchor.
  - `before="<exact existing line text>"` — insert immediately **before** the matching line (e.g. `before="app.listen(3000);"` to slot a route above the listen call).
  - The anchor must be a line that already exists when this step runs, and unique enough to match once. Copy it verbatim (whitespace is trimmed on both sides before comparison).
- `line` (required, 1-based): the line the user types on. Used as the target when there is no anchor, and as a fallback if an anchor isn't found. When you do use line numbers, count them from the file **as it exists right now**, accounting for the lines earlier steps insert (see Code-quality rule 5).
- `indent` (optional, default 0): leading-space count required at the start of the body's first line.
- The fenced code block body is the **exact** text the user must type. For one statement, one line is best. Multi-line bodies are allowed but discouraged.
- Every `edit` step **must** be followed by an `<!-- bbb: explain -->` block whose fenced body is plain prose. BBB surfaces it on demand (Show why) and as the lead-in to the `teach` popup — it is *not* written into the file, so don't leave room for it in your line numbers.
- **When the playbook is solving a problem, fixing a bug, or investigating an error**, the `explain` block for each step must answer four questions (where applicable):
  1. **How was this problem found?** — what signal, symptom, or reasoning identified it (e.g. "the stack trace pointed here", "this value is never reset after X").
  2. **Why is it a problem?** — the root cause in plain terms (e.g. "the list is mutated in-place so every caller shares the same object").
  3. **What does this step do to fix it?** — the specific change being made and its mechanical effect.
  4. **Why does this fix work?** — the causal link between the change and the resolution (e.g. "returning a copy means the caller's list is independent, so later mutations don't bleed across").
  Keep answers concise — two or three sentences per question is ideal. Skip a question only if it genuinely doesn't apply to the step (e.g. a pure diagnostic step has no fix yet).
- **Always precede each `edit` step with an `open` step for its target file and a `goto` step for its target line**, so the user practises VS Code navigation. Omit the `open` step only when the immediately preceding step already opened that exact file. The user can press Ctrl+Alt+Shift+U at any edit step to have BBB handle navigation and apply the edit automatically — these steps exist for manual practice, not as gates.

### `create` — scaffold and open a new file

Use this **instead of an `open` step** whenever the target file does not exist yet. BBB creates the (empty) file and any parent folders, then opens it, so the next `edit` step always has a real target. Never point an `edit`/`open` step at a file you haven't created first.

````markdown
1. Create the server file.
    <!-- bbb: create file="src/server.js" -->
    <!-- bbb: explain -->
    ```
    Makes an empty server.js so the next steps have somewhere to type.
    ```
````

### `replace` — change an existing line

`edit` only inserts. When a step must **modify a line that already exists** (change a value, swap a call), use `replace`. BBB verifies the line currently equals `old`, the user edits it, and BBB verifies it now equals `new` — so hand-editing an existing line is checked, not left to chance.

````markdown
2. Point the port at the env variable.
    <!-- bbb: replace file="src/server.js" line="46" -->
    <!-- bbb: old -->
    ```javascript
    app.listen(3000);
    ```
    <!-- bbb: new -->
    ```javascript
    app.listen(process.env.PORT || 3000);
    ```
    <!-- bbb: explain -->
    ```
    Reads the port from the environment, falling back to 3000 for local runs.
    ```
````

- `file` (required) and `line` (required, 1-based) name the line to change.
- The `<!-- bbb: old -->` fenced body is the exact current text; `<!-- bbb: new -->` is the exact replacement. Both are compared with surrounding whitespace trimmed.
- Supports `explain` and `teach` like `edit`, and auto-apply (Ctrl+Alt+Shift+U).

### `counted="false"` — mark a step as navigation-only

Add `counted="false"` to any `open`, `goto`, or `note` step whose only purpose is navigation. These render in the status bar with a `→` prefix and do **not** count toward the N/total step fraction, so the learner's progress reflects real work. Never mark an `edit`, `replace`, `create`, or `terminal` step as uncounted.

````markdown
3. Open the database file.
    <!-- bbb: open file="src/db.js" counted="false" -->
````

### `terminal` — run a command

````markdown
4. Install the dependencies.
    <!-- bbb: terminal -->
    ```
    npm install
    ```
    <!-- bbb: explain -->
    ```
    Downloads the packages from package.json. Success looks like "added N packages" with no red error text. If you see "command not found: npm", install Node.js first.
    ```
````

- Give every `terminal` step an `explain` that states **what success looks like** (the line to expect) and names the 1–2 most likely failures with the fix. A beginner can't otherwise tell a working install from a broken one.
- Follow any command whose output determines the next steps with a `report` step so the user pastes it back.

### `report` — wait for the user to paste output back to you

````markdown
3. Paste the test output here so I can decide the next steps.
    <!-- bbb: report -->
````

After a `report`, **stop adding steps**. Wait for the user's next message before appending more.

### `open` — navigate to a file

````markdown
4. Open the test file.
    <!-- bbb: open file="tests/test_app.py" -->
````

### `goto` — move the cursor

````markdown
5. Jump to the failing assertion.
    <!-- bbb: goto line="42" -->
````

### `validate-section` — assert a broader code region is correct

An optional block you can append to any `edit` step. After the user types the step body and BBB verifies the specific line(s), it also checks that the declared range of lines in the file matches the expected content exactly. Use this whenever your edit is part of a larger structure (HTML element, JS function, CSS rule) where incorrect nesting or attribute syntax would be invisible from a single-line check.

````markdown
1. Open the select element.
    <!-- bbb: edit file="src/index.html" line="45" indent="4" -->
    ```html
    <select id="req-select" onchange="onRequestChange()">
    ```
    <!-- bbb: explain -->
    ```
    Opens the <select>. Its closing tag goes on the next line; the <datalist> is a sibling, not a child.
    ```
    <!-- bbb: validate-section file="src/index.html" start="44" end="48" -->
    ```html
        <label for="req-select">Request type:</label>
        <select id="req-select" onchange="onRequestChange()">
        </select>
        <datalist id="ritm-suggestions"></datalist>
    ```
````

- `file` (optional): defaults to the edit step's `file`.
- `start` / `end` (required, 1-based inclusive): the line range to validate after the edit.
- The fenced body is the **exact** expected content of those lines — including indentation.
- The range should span the complete structure being modified (full element, full function signature, full import block) so context-level mistakes (wrong nesting, extra quotes, misplaced closing tags) are caught before the user advances.

### `teach` — pop up an explanation the moment the user finishes a step

An optional block on any step. The moment the user completes the step (verification passes), BBB shows a modal explaining **what they just wrote**. Use this to teach comprehension as code comes into existence — for the constituent parts of a line *and* for the whole structure once its closing piece is typed.

````markdown
2. Grab the datalist element.
    <!-- bbb: edit file="src/index.html" line="120" indent="2" -->
    ```javascript
    const dl = document.getElementById('ritm-suggestions');
    ```
    <!-- bbb: explain -->
    ```
    Caches the datalist so the next lines can fill it with options.
    ```
    <!-- bbb: teach -->
    ```
    You just wrote a variable that holds a live reference to an element on the page.

    • document — the whole HTML page, as an object your script can read and change.
    • .getElementById('ritm-suggestions') — searches the page for the element whose
      id attribute equals "ritm-suggestions" (here, the <datalist> you added earlier)
      and hands it back.
    • const dl = … — stores that element so you can reuse it without searching again.

    Shape of the pattern (placeholders in []):
      const [yourVariable] = document.getElementById('[the-id-of-some-element]');
    ```
````

**When to add a `teach` block (comprehension mode):**

- **Every `edit` and `replace` step gets an `explain`, with no exceptions.** Trivial lines get a one-clause explain ("closes the function body", "ends the array"). Never drop the explanation on the assumption the learner already knows the concept — that assumption is exactly the failure mode BBB exists to prevent. The learner decides what to skim; you don't decide for them.
- Add a full `teach` block **on top of** the explain for any line that introduces a concept worth understanding — DOM lookups, array methods (`forEach`, `map`, `filter`), `Set`/`Map`, `createElement`/`appendChild`, event wiring, async/`await`, regexes, SQL clauses, etc.
- **Don't stampede teach popups.** Aim for at most one `teach` per ~3 steps. If one line introduces several concepts, teach the dominant one and mention the rest in a single line of its explain.
- Break a larger snippet into **one small `edit` step per meaningful piece**, each on its own line, so the popup fires at the right boundary. Give the closing line of a loop/function/block its **own** `teach` that summarizes the whole structure now that it's complete.
- Every `teach` body should: (1) name the whole thing in one sentence, (2) break down each constituent part in a short bullet list, and (3) end with a **placeholder-form example** where every specific name/value is replaced by a `[description]` placeholder, so the user sees the reusable shape.
- The teach popup **syntax-highlights code**: keep example/code lines **indented by 2+ spaces** (or inside a ```` ``` ```` fence) and prose lines flush-left, so code is coloured and prose stays readable.

### `note` — context only, no verification

````markdown
6. About to refactor the parser; the next three edits all touch the same function.
    <!-- bbb: note -->
````

## Rules

- One file: `.bbb/playbook.md`. Append-only. Don't renumber existing items.
- **Open with discovery.** Before writing steps, read the project's manifest(s) (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, …), the README, and the entry point. State the detected language, framework, package manager, run command, and test command in an opening `note` step so the learner knows what they're building and how to run it.
- **Set up the environment before building — assume a fresh machine.** The playbook may be run on a computer with none of the tooling installed. After discovery, and before the first `edit`, add a setup section that installs and verifies every prerequisite:
  1. A `note` listing the required runtimes/tools with their minimum versions and per-OS install commands (Windows `winget install ...`, macOS `brew install ...`, Linux the distro/official method), plus the download URL. Tell the user to reopen the terminal after installing so the new tool is on `PATH`.
  2. A `terminal` version-check for each runtime/tool (`node --version`, `python --version`, `cargo --version`, …) whose `explain` states the expected minimum and what to do if it's missing.
  3. Only **after** the runtime is confirmed, the project-dependency install step (`npm install`, `pip install -r requirements.txt`, `cargo build`, …), with an `explain` describing what success looks like.
  Never assume a runtime, package manager, database engine, or CLI tool is already present — if a step needs it, an earlier step must install and verify it.
- **Create files before editing them.** Use a `create` step for any file that doesn't exist yet — never rely on prose in a description to get a file made.
- **Orient at section boundaries.** Begin each group of related steps with a `note` that says what you're about to build, what already exists from earlier steps, and what this group adds.
- **Checkpoint often.** After roughly every five `edit` steps (and always after finishing a file that can run), insert a `terminal` compile/run/test step plus a one-line `note` on what the learner should now see. This surfaces a mistake near where it was made instead of 20 steps later.
- Don't suggest the user invoke Copilot tools or use VS Code edit commands like "Find & Replace".
- Don't write very long `edit` bodies — split aggressive edits across multiple steps so the user learns chunk by chunk.
- If the user says "just do it", politely remind them that BBB is installed and you can only write the playbook.

## Code quality rules — validate before writing any step

Every `edit` step body must be code you would stake your reputation on. Before appending a step:

1. **Read the full target file.** Use a file-reading tool if needed. Never write a step body from memory or assumption.
2. **Validate the body in context.** Mentally apply every preceding step in sequence and verify the result is syntactically valid. Ask: does the indentation match the file's convention? Are all tags/brackets/quotes balanced in the surrounding block?
3. **Language-neutral structure rules:**
   - The file must be syntactically valid after **every** preceding step is applied in order — never leave a step that only becomes valid two steps later without saying so in the `explain`.
   - Brackets, quotes, and blocks must balance within the surrounding scope.
   - Indentation must match the file's existing convention exactly (spaces vs tabs, width).
   - Add imports/uses/includes before their first reference.
   - Per-family reminders — consult only the one for the target language: **indentation-significant** (Python, YAML): a wrong indent changes meaning, so set `indent` precisely. **Brace languages** (JS/TS, Java, C#, Rust, Go): give a block's closing brace its own step. **HTML/JSX**: void elements (`<br>`, `<input>`, `<img>`) self-close; block elements never nest inside inline ones; one pair of quotes per attribute (`id="foo"`).
4. **Use `validate-section` for any step touching shared structure.** If the line you're editing is part of a multi-line element, function, or block, add a `validate-section` covering the full structure so BBB catches nesting or context errors a single-line check misses.
5. **Prefer anchors; don't hand-count line numbers.** Use `after`/`before` on `edit` steps so placement is located by text, not arithmetic. This removes the entire class of "the line number drifted and the edit landed in the wrong place" bugs. Reserve raw line numbers for the first line of a brand-new file.
6. **If you must use line numbers, account for earlier inserts.** Each `edit` that inserts lines pushes everything below it down. Number each later step for the file state *after* the earlier inserts land (inserting one line at 172 makes the old 497 become 498). BBB does **not** write your `explain` text into the file, so never leave room for it. When in doubt, switch to an anchor.
7. **One line per `edit` step is ideal for comprehension.** Keep bodies short — single-line where possible. The status bar only shows a short prompt; the teaching happens in `teach` popups and the actual editor, not in a giant status-bar string.
8. **Keep step descriptions short** — aim for under 50 characters so the status bar shows the full text without paging. Where a longer description is unavoidable, put the detail in the `explain` block instead.
9. **Do not include keybinding reminders** (e.g. "then press Ctrl+Alt+.") anywhere in step descriptions, `explain` blocks, or `teach` blocks. BBB communicates keybinding guidance in the status bar automatically.
