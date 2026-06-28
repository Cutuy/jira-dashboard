# Jira Dashboard

A Jira-like ticket dashboard for managing AI-assisted development workflows.

## Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env — set JIRA_PROJECT_DIR to your project path
# Edit config.json — set project.name to your project name

# 2. Install
npm install

# 3. Run tests
npm test

# 4. Start
npm start
```

## Configuration

Two config files, no hardcoded paths:

### `.env` — paths & overrides (key=value)

```
PORT=3006
JIRA_PROJECT_DIR=/path/to/your/project
JIRA_WORKTREES_DIR=/path/to/your/project/.worktrees
JIRA_CODER_BIN=/path/to/opencode
JIRA_CODER_TYPE=opencode
JIRA_VENV_DIR=.venv
JIRA_PYTHONPATH=src
JIRA_TEST_CMD=
```

### `config.json` — structural settings

```json
{
  "port": 3006,
  "project": {
    "name": "your-project-name",
    "path": "/path/to/your/project"
  },
  "coder": {
    "type": "opencode",
    "bin": "/path/to/opencode",
    "timeouts": {
      "clarify": 180000,
      "implement": 600000
    }
  }
}
```

`.env` values override `config.json` values when both set.

## Coder Backends

The dashboard abstracts the AI coding tool behind a common interface (`coder.js`).

- **opencode** — default backend, uses the opencode CLI
- **dummy** — test backend, echoes prompts (for unit testing)

To add a new backend, add a handler object to `coder.js` with:
- `stats()` — returns `{ cost, input, output }`
- `listSessions()` — returns session list text
- `buildArgs(prompt, sessionId, title)` — CLI arguments array
- `buildEnv()` — environment variables

## Pre-push Hook

```bash
git config core.hooksPath .githooks
```

Runs `npm test` before every push. Push is aborted if tests fail.

## Testing

```bash
npm test            # run all
npm run test:config # config loader only
npm run test:prompts # prompt templates only
npm run test:coder  # coder backend only
npm run test:helpers # server helpers only
npm run prepush     # pre-push hook dry-run
```
