---
name: Bug report
about: Something didn't work the way the docs said it should
title: "[bug] "
labels: bug
assignees: ""
---

## What happened

A clear one-paragraph description. What did you do, what did you expect, what happened instead?

## Environment

<!-- Fill in what you can. Delete lines you can't. -->

- **OS**: (Linux distro + version / macOS version / WSL distro)
- **Node**: `node -v` output
- **npm**: `npm -v` output
- **Coder backend**: (opencode / claude code / codex / dummy)
- **Coder version**: `~/.opencode/bin/opencode --version` (or equivalent)
- **Jira Dashboard version**: (the commit/tag you installed)

## Steps to reproduce

1.
2.
3.

## Logs

Paste relevant output. **Redact API keys before posting.**

For the dashboard service:

```bash
journalctl --user -u jira-dashboard-<port>.service -n 200
# or on macOS:
tail -200 ~/Library/Logs/jira-dashboard-<port>.log
```

For the coder backend, paste the run that failed (often visible in the ticket's "Live status" panel).

## Screenshots

If the bug is visual (UI broken, wrong color, layout glitch), attach a screenshot.

## Workaround

Did you find a way around it? Sharing it helps others hit by the same thing.