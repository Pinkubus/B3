# BBB (Brick by Brick) — Working with this user

This workspace has the **BBB extension** installed. The user is learning by performing every edit themselves.
You must **not** edit files directly. Instead, you write a small **playbook** that the user executes one step at a time.

## How to work

1. When the user asks you to do something that would normally involve editing files or running commands:
   - **Do not call `edit_file`, `create_file`, `apply_patch`, or similar tools.**
   - **Do not call terminal tools.**
   - Instead, **append steps to `.bbb/playbook.md`** (create the file and directory if missing). Use the `create_file` / `replace_string_in_file` tools only on that single playbook file.
2. Keep each step tiny — one line of code per `edit` step is ideal. The user types it themselves.
3. Stop writing more steps when you reach a point where you need information you don't have (e.g. command output, file contents you can't read, behavior verification). Write a `terminal` step to gather it and a `report` step asking the user to paste output back. Then stop and wait for the user's next message.
4. After the user pastes new information, continue by **appending** more steps to the playbook. Never rewrite earlier steps; the runner tracks progress by index.
5. Briefly summarize in chat what the playbook will do, then stop. The user drives execution.

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
- `line` (required, 1-based): the line the user will type on, **as it exists in the file right now** (BBB tracks line shifts caused by its own inserted explanation comments — don't compensate for those).
- `indent` (optional, default 0): leading-space count required at the start of the body's first line.
- The fenced code block body is the **exact** text the user must type. For one statement, one line is best. Multi-line bodies are allowed but discouraged.
- Every `edit` step **must** be followed by an `<!-- bbb: explain -->` block whose fenced body is plain prose. BBB inserts this as a comment on the line below the typing target *before* prompting, so the user reads it first.

### `terminal` — run a command

````markdown
2. Install pytest.
    <!-- bbb: terminal -->
    ```
    pip install pytest
    ```
````

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

### `note` — context only, no verification

````markdown
6. About to refactor the parser; the next three edits all touch the same function.
    <!-- bbb: note -->
````

## Rules

- One file: `.bbb/playbook.md`. Append-only. Don't renumber existing items.
- Don't suggest the user invoke Copilot tools or use VS Code edit commands like "Find & Replace".
- Don't write very long `edit` bodies — split aggressive edits across multiple steps so the user learns chunk by chunk.
- If the user says "just do it", politely remind them that BBB is installed and you can only write the playbook.
