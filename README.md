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

The script will:
1. Create `.env` from `.env.example` (never overwrites existing)
2. Prompt for your project path and coder CLI if not set
3. Install dependencies and build the client
4. Offer **background** (systemd user service, starts on boot) or **foreground** mode
   → default is background: `http://localhost:3006`

Run it again anytime — it's idempotent and never touches your project data.

## Configuration

Two files control the dashboard. Neither contains hardcoded paths:

| File | Purpose |
|---|---|
| `.env` | **Your machine-specific overrides** — project path, coder binary, ports. Not tracked in git. See `.env.example` for all available vars. |
| `config.json` | **Structural defaults** — timeouts, backend config. Tracked in git. See `config.schema.json` for full documentation. |

`.env` values override `config.json` values. Every field has a sensible default —
you can start with just `JIRA_PROJECT_DIR` and `JIRA_CODER_BIN`.

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
