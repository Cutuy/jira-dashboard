# Jira Dashboard

A local kanban board for working with AI coding agents. Add a task, answer
clarifying questions, and review the agent's changes and test results. Each
task uses a separate Git worktree.

![Ticket flow from backlog to done](docs/demo.gif)

![Architecture](docs/architecture.svg)

## Quick start

### Windows

Install [Git for Windows](https://gitforwindows.org/) and
[Node.js 24.x, version 24.18 or later](https://nodejs.org/en/download).
Start PowerShell and run:

```powershell
git clone https://github.com/TheEugen/jira-dashboard.git
cd jira-dashboard
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -ProjectDir 'C:\work\my-project'
```

Point `-ProjectDir` at a Git checkout with at least one commit. Setup builds
the client, writes settings under that checkout's `.jira-dashboard` directory,
and starts the dashboard at **http://127.0.0.1:3006**. Keep the PowerShell window
open while you use it. Press Ctrl+C to stop.

The default `dummy` adapter lets you open the board without an AI account. To
run the agent workflow, install and authenticate a coding CLI, then add
`-Coder codex`, `-Coder claude`, or `-Coder opencode` on first setup. Use
`-CoderBin` if the CLI needs an explicit executable path. Use `-Port` to choose
another port, `-Branch` to choose a local base branch, and `-Worktrees` to
pre-create a worktree pool.

To launch again, add `-Mode Start` to the command above. Use `-Mode Setup` to
rebuild or provision without launching. Repeat setup preserves the existing
`<project>/.jira-dashboard/.env`. Edit that file to change a saved setting.
Keep `.jira-dashboard/` and `.worktrees/` in your project's Git ignore list.
On Windows, `JIRA_TEST_CMD` runs with Command Prompt syntax.

### Linux and macOS

You'll need Git, Node.js 24.18 or later in the 24.x series, npm, and a configured
coding CLI: OpenCode, Claude Code, or Codex.

```bash
git clone https://github.com/TheEugen/jira-dashboard.git
cd jira-dashboard
./bootstrap.sh
```

The setup script asks for your project repository, coding CLI, and port. It
builds the client and installs a background service using systemd on Linux or
launchd on macOS. Open the local URL it prints; the default port is 3006.

To track another project, run setup again with a different port.

## Workflow

Tasks move through backlog, clarification, implementation, and review. You can
follow progress, inspect changes and test output, and leave feedback before
accepting changes or opening a pull request. The board also works on mobile.

| Stage | What happens | Desktop |
| --- | --- | --- |
| Backlog | Add a task. | ![Backlog](docs/screenshots/desktop-home.png) |
| Clarification | Answer the agent's questions. | ![Clarification](docs/screenshots/desktop-clarification.png) |
| Implementation | Follow changes in a separate worktree. | ![Implementation](docs/screenshots/desktop-implementation.png) |
| Review | Inspect the diff and test results, then give feedback or accept. | ![Review](docs/screenshots/desktop-review.png) |
| Done | Accepted changes are applied and the task closes. | ![Done](docs/screenshots/desktop-done.png) |

| Mobile board | Mobile ticket |
| --- | --- |
| ![Mobile home](docs/screenshots/mobile-home.png) | ![Mobile ticket](docs/screenshots/mobile-ticket.png) |

## Configuration

| File | Purpose |
| --- | --- |
| `<project>/.jira-dashboard/.env` | Dashboard settings, including the port and coding CLI |
| `<project>/.env` | Environment variables and API keys passed to the coding CLI |
| `config.json` | Defaults for timeouts, worktrees, and test commands |

Set `test.command_override` in `config.json` to use your project's test command.
The default runs Python tests. Keep credentials out of version control.

Adapters for OpenCode, Claude Code, and Codex live in [`coder/`](coder/).
A dummy adapter is available for testing without a coding service.

## Development

```bash
npm ci
npm test
cd client
npm ci
npm test
npm run build
```

Run `npm.cmd run test:windows` from the dashboard root on Windows for the
PowerShell setup and end-to-end test. It uses a temporary Git checkout and a
stub coder.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributions,
the [roadmap](docs/todo.md) for planned work, and the
[runbook](docs/sre/runbook.md) for operations.

## License

[MIT](LICENSE)
