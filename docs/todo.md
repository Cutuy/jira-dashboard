# Todo

## Bugs

- Theme toggle "auto" doesn't follow system preference. Manual dark/light work.
- Copy link (in ticket) doesn't work in some browsers.

## Portability

- Test runner is Python-only (`python -m project.test`). Broken for JS/Go/Rust.
- Client UI hardcodes `"main"` in user-facing strings (App.tsx:918,1438).
- Resource monitor is Linux-only (`/proc/pid/stat`, page size, clk_tck).
- VSCode/Cursor URI schemes only. Other editors get dead links.
- Python venv assumptions (`VIRTUAL_ENV`, `PATH` prepend) irrelevant for non-Python projects.
- `better-sqlite3` native module version must match Node.js exactly.
- No first-run experience: empty DB, no config validation, silent failures.

## Coder Backends

- Only opencode is implemented. Need backends for claude code, codex, Amazon Q, etc.

## Platform Support

- Only Linux systemd for auto-start. Need macOS launchd plist, Windows schtasks.
- No Docker / containerized setup (native module needs C++ build tools).

## Features

- Tighten coder runtime env — launch coder CLI from the worktree dir so each ticket session runs in its own sandbox.
- Reuse worktrees for tickets in large repos (instead of creating new worktree each time).
- Custom GitHub instance URL support (for self-hosted GitHub Enterprise).
- Branch naming prefix configurable (currently hardcoded to `feature/`).
- Default `projectDir` should not fall back to `process.cwd()`.
- Port conflict: if configured port is in use at startup, auto-increment or use ephemeral port instead of crashing with EADDRINUSE.
