# Jira Dashboard — Vision

A Jira kanban board for agentic engineers.

Single-page dashboard where you define tickets, an AI coder clarifies and implements
them, and you review the diff, run tests, and close — all locally, no cloud deps.

## Goals

- Zero-config setup for a new project: one install script, one `.env` edit
- Works with any AI coding CLI (opencode, claude code, codex, etc.)
- Runs on any OS (Linux systemd, macOS launchd, Windows schtasks)
- Fail-loud, token-aware, editor-agnostic

## Guiding Principles

- Token-aware, fail-visible, no hidden state
- Editor-agnostic, user owns their data, no telemetry
