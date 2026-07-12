# Per-Ticket `base_branch` Support

## Overview

Tickets can now carry an optional `base_branch` field that overrides the
configured `config.branchDefault` for all per-ticket git operations.
This enables stacked PRs — creating a PR on top of another PR branch.

## Usage

```sh
curl -X POST http://localhost:3006/api/tickets \
  -H 'Content-Type: application/json' \
  -d '{"title":"Stacked feature", "base_branch":"feature/parent-pr-branch"}'
```

The worktree will be based off `feature/parent-pr-branch`, rebase/ready
operations will target it, and `gh pr create --base` will be set automatically.

## Implementation status

### Fixed (phase 1 — April 2026)

| Area | What changed |
|------|-------------|
| DB schema | `base_branch TEXT` column + `createTicket` default |
| `POST /api/tickets` | Accepts optional `base_branch` |
| Worktree acquire | `worktree-manager.js` — all paths use `ticket.base_branch \|\| config.branchDefault` |
| Worktree release | Same fallback |
| `freshDefaultBase` | Accepts `baseBranch` param (2nd arg) |
| Rebase | Uses `ticket.base_branch \|\| config.branchDefault` for target, freshDefaultBase, error msgs |
| Ready / cherry-pick | Uses `readyBaseBranch = ticket.base_branch \|\| config.branchDefault` for all git operations |
| PR creation | `gh pr create --base <base_branch>` when set |
| Auto-clarify | Server-side `runClarify` triggered on ticket creation (UI no longer double-triggers) |

### Remaining (phase 2 — this doc)

| # | Priority | File:Line | Issue | Fix |
|---|----------|-----------|-------|-----|
| 1 | HIGH | `git-utils.js:31-46` | `resolveDiffBase` hardcodes `config.branchDefault` | Add `baseBranch` param (defaults to config.branchDefault) |
| 2 | HIGH | `server.js:1400` | Diff endpoint calls `resolveDiffBase(ticket.worktree_path)` without `ticket.base_branch` | Pass `ticket.base_branch` |
| 3 | HIGH | `server.js:232` | Implement post-coding summary calls `resolveDiffBase(worktreePath)` | Pass `ticket.base_branch` (ticket in scope at line 216) |
| 4 | HIGH | `git-utils.js:73-81` | `getBranchStaleness` hardcodes `config.branchDefault` | Add `baseBranch` param |
| 5 | HIGH | `server.js:338` | `getTicketResponse` calls `getBranchStaleness(t.worktree_path)` | Pass `t.base_branch` |
| 6 | LOW | `server.js:80` | `` `Default branch: ${config.branchDefault}` `` | `` `Default branch: ${ticket.base_branch \|\| config.branchDefault}` `` |
| 7 | LOW | `server.js:1080` | `` `Rebased onto ${config.branchDefault}: ${newSha}` `` | Use `rebaseBranch` (already computed) |
| 8 | LOW | `server.js:1101` | `` `Default branch: ${config.branchDefault}` `` | `` `Target branch: ${ticket.base_branch \|\| config.branchDefault}` `` |
| 9 | LOW | `server.js:1156` | `` `Rebased onto ${config.branchDefault}: ${newSha}` `` | Use actual rebase target |
| 10 | LOW | `server.js:1412` | `` `(commits already in ${config.branchDefault}...)` `` | `` `(commits already in ${ticket.base_branch \|\| config.branchDefault}...)` `` |
| 11 | LOW | `server.js:1414` | `` `No diff ahead of ${config.branchDefault}` `` | `` `No diff ahead of ${ticket.base_branch \|\| config.branchDefault}` `` |

## Test plan

### `tests/git-utils.test.js` (new)

| # | Test | What it covers |
|---|------|----------------|
| 1 | `resolveDiffBase` with null/undefined `baseBranch` falls back to config default | Backward compat |
| 2 | `resolveDiffBase` with custom `baseBranch` uses that branch | New feature |
| 3 | `getBranchStaleness` with custom `baseBranch` runs against that branch | New feature |
| 4 | `getBranchStaleness` falls back to config default when param is null | Backward compat |

### Existing tests (must still pass)

| File | Tests |
|------|-------|
| `tests/pr-checker.test.js` | 4 new runClarify callback tests |
| `tests/run-clarify-wrapper.test.js` | 4 wrapper pattern tests |
| `tests/server-helpers.test.js` | 10 helper tests |
| `tests/worktree-pool.test.js` | Pool operations |
| `tests/worktree-manager.test.js` | acquire/release lifecycle |
