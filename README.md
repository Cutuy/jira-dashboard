# Jira Dashboard

A lightweight ticket dashboard for AI-assisted development. Define tickets, let an AI
coder clarify and implement them, review the diff, run tests, and close — all from a
single-page app. No database servers, no cloud accounts.

## Quick Start

```bash
git clone <this-repo>
cd jira-dashboard
./bootstrap.sh
```

The script is **interactive**. It will:

1. Check prerequisites (Node.js ≥ 18, npm, git)
2. Ask for the absolute path to your git repo
3. Write `.env` to **`<your-project>/.jira-dashboard/.env`** — one config per project,
   never touches files in the dashboard checkout itself
4. Install dependencies and build the client UI
5. Ask: **background** (systemd user service, starts on boot) or **foreground** (this terminal)
   → default is background, open http://localhost:3006

Run it again anytime for another project — each gets its own `.env` in its own `.jira-dashboard/`.
The script is idempotent and never overwrites existing configs.

### Manual setup

```bash
mkdir -p my-project/.jira-dashboard
cp install/templates/env.template my-project/.jira-dashboard/.env
# edit .env — set JIRA_CODER_BIN
npm install
(cd client && npm install && npm run build)
cd my-project && node ../server.js   # auto-discovers .jira-dashboard/.env from cwd
```

## How config loading works

The dashboard discovers your project automatically — no config file needed in the
dashboard directory itself.

1. **Start from `process.cwd()`** and walk up until it finds `<dir>/.jira-dashboard/.env`
2. Load that `.env` as key=value overrides
3. Load `config.json` (in the dashboard repo) as structural defaults
4. `.env` values win over `config.json` values

This means you can run the server from anywhere inside your project tree —
the dashboard finds the nearest `.jira-dashboard/.env` by walking up.

### Configuration sources

| Where | What | Tracked? |
|---|---|---|
| `<project>/.jira-dashboard/.env` | Machine-specific overrides (paths, ports, API keys) | No — edit per machine |
| `<dashboard>/config.json` | Structural defaults (timeouts, backend) | Yes — ships with repo |
| `<dashboard>/config.schema.json` | Full field documentation with defaults | Yes — IDE intellisense |

## Workflow

1. **Create Ticket** — give it a title, optionally describe what you want
2. **Clarify** — the AI asks questions to understand the task; answer them
3. **Implement** — the AI writes code in a dedicated git worktree
4. **Review** — see the diff, provide feedback, iterate
5. **Ready** — commits are squashed, then either cherry-picked into your
   default branch or pushed as a PR (see `MERGE_STRATEGY`)

Progress streams live via SSE — you see AI reasoning, resource usage, and test
output as it happens.

## Coder Backend

The dashboard works with any CLI tool that can accept a prompt, stream output,
and report token usage. Currently ships with:

- **opencode** (default) — https://opencode.ai
- **dummy** — echoes prompts, used for testing

Add your own backend by implementing `stats()`, `listSessions()`, `buildArgs()`,
and `buildEnv()` in `coder.js`.

### How the coder process is launched

When the dashboard needs to run the coder (suggestions, clarification, implementation):
it spawns the binary as a child process with:

- **Working directory** = `<projectDir>` (your git repo root)
- **Environment** = `process.env` (dashboard's own environment), plus:
  - Variables from `<project>/.env` are injected at startup by `config.js`
  - `VIRTUAL_ENV` and `PATH` are prepended with the project's `.venv/bin/`
    (if using the Python venv helper)
- **Timeout** = configurable per stage in `config.json` → `coder.timeouts`

### Caveats

- **API keys** must be in `<project>/.env` (not `.jira-dashboard/.env`).
  The dashboard injects `<project>/.env` into the child's environment so the
  coder CLI can authenticate. Keys in `.jira-dashboard/.env` are used for
  dashboard config only and are NOT passed to the coder.
- **Python projects** get `VIRTUAL_ENV` and `.venv/bin/` prepended to `PATH`
  automatically. Non-Python projects can ignore this — the venv helper is a
  no-op if the directory doesn't exist.
- **Platform** — the resource monitor reads `/proc/<pid>/stat` (Linux only).
  On macOS/Windows it silently skips resource tracking.

---

## For Maintainers

### Tests

```bash
npm test            # run all
npm run test:config # config loader only
npm run test:prompts # prompt templates only
npm run test:coder  # coder backend only
npm run test:helpers # server helpers only
```

### Pre-push hook

```bash
git config core.hooksPath .githooks
```

Runs `npm test` before every push. Aborts if tests fail.
