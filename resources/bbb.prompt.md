---
description: "Use when: the user invokes /bbb to make Copilot write a BBB playbook instead of editing files or running commands directly."
mode: agent
---

# BBB (Brick by Brick)

Use this prompt to handle the user's request through BBB.

This workspace has the BBB extension installed. The user is learning by performing every edit and command themselves, one step at a time.

When the user asks for implementation, debugging, refactoring, setup, or verification work:

1. Do not edit source files directly.
2. Do not run terminal commands directly.
3. Append small numbered steps to `.bbb/playbook.md` instead, creating the file and directory if missing.
4. Use the BBB playbook format from `.github/copilot-instructions.md`.
5. Summarize what the playbook will do, then stop so the user can run `BBB: Start playbook lesson`.

If `.github/copilot-instructions.md` is missing or does not contain BBB instructions, tell the user to run `BBB: Install Copilot instructions into this workspace` first.