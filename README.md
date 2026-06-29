# Jira Dashboard

A lightweight ticket dashboard for AI-assisted development. Define tickets, let an AI
coder clarify and implement them, review the diff, run tests, and close — all from a
single-page app. No database servers, no cloud accounts.

## Quick Start

```bash
git clone <this-repo>
cd jira-dashboard

# 1. Point at YOUR project and your AI coder
cp .env.example .env
# Edit .env — at minimum set:
#   JIRA_PROJECT_DIR=/path/to/your/repo
#   JIRA_CODER_BIN=/path/to/your/coder-cli

# 2. Optionally tell the dashboard about your project
#    Edit config.json → project.name = "My Project"

# 3. Install & build
npm install
cd client && npm install && npm run build && cd ..

# 4. Start
npm start
```

Open http://localhost:3006. You'll see an empty board. Click **Create Ticket** to
start a new ticket — the AI will ask clarifying questions, implement code in an
isolated git worktree, and run tests.

## What You Configure

| File | What goes there |
|---|---|
| `.env` | **Your machine-specific values** — project path, coder binary path, remote hostname, ports. Gitignored. |
| `config.json` | **Structural defaults** — project name, timeouts. Tracked in git. |

`.env` values override `config.json` values. Everything has a sensible default so
you can start with just `JIRA_PROJECT_DIR` and `JIRA_CODER_BIN`.

### Minimal `.env`

```
JIRA_PROJECT_DIR=/home/me/my-project
JIRA_CODER_BIN=/home/me/bin/opencode
```

### All available env vars (see `.env.example`)

| Var | What | Default |
|---|---|---|
| `PORT` | Dashboard port | `3006` |
| `JIRA_PROJECT_DIR` | Your project's root | `process.cwd()` |
| `JIRA_PROJECT_NAME` | Display name in header | `"project"` |
| `JIRA_CODER_BIN` | Path to your AI coder CLI | `"opencode"` |
| `JIRA_CODER_TYPE` | Coder backend | `"opencode"` |
| `JIRA_DATA_DIR` | Separate database directory | `<dashboard>/data/` |
| `REMOTE_HOST` | SSH host for VSCode/Cursor links | `"example-claw"` |
| `GIT_DEFAULT_BRANCH` | Your repo's main branch | `"main"` |
| `MERGE_STRATEGY` | How to close tickets: `cherry-pick` or `pr` | `"cherry-pick"` |
| `EXPLORER_URL` | URL template for diff file links | GitHub blob URL |

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
