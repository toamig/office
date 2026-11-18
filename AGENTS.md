# Office: instructions for the agent

Office is the owner's own desktop app and main work environment: every project, agent session,
repo, branch, worktree, note and notification in one window, on top of the Brain. This repo holds
the code. The notes (spec, decisions, open items) live in the Brain, at
`E:/Projects/Knowledge/Brain/Office/` (its own repo, `brain-office`).

---

## Source of truth

**Read first:** `E:/Projects/Knowledge/Brain/Office/_index.md`, then `Office/Spec.md`.

The spec owns the features, the design, the build order (M0 to M5), the settled choices and the
open questions. Before any implementation or design change:

1. Read the spec section for the area you are touching.
2. Do not contradict a settled choice (spec section 9) without the owner agreeing, then record
   the change in the Brain.
3. Build only the current milestone. Each milestone must be usable on its own before the next
   one starts.

## Stack and conventions

- Electron, TypeScript and React; electron-vite and electron-builder; `node-pty` and `xterm.js`
  for terminals; SQLite for the local index; `git` and `gh` as command-line tools.
- Agents are driven through their official command-line tools (`claude`, `codex`) with the
  owner's own logins. Never store or ask for a password, token or API key.
- The UE5 C++ conventions do NOT apply here, and neither do the multi-tenant SaaS notes.
- Files are UTF-8 without BOM, with LF endings. Commit messages never carry a `Co-Authored-By`
  trailer. Both rules are in `Common/Conventions.md` in the Brain.

## Editing scope

You may create, edit and delete files for Office in `E:/Projects/Office/`, and update its notes in
`E:/Projects/Knowledge/Brain/Office/`. Commit note changes in that folder (it is its own repo);
the Brain's automatic sync pushes them. Stage only the files you changed.
