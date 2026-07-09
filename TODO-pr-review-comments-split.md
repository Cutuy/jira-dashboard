# PR Review Comments Split — Implementation TODO

## Instructions

- **Checkbox each task when done** — mark `[ ]` → `[x]` as you complete each item.
- **Add a unit test bullet after each task** — before moving to the next task, note whether a unit test was added and that it passes. Format:
  ```
  - Unit test: `test_file_name` added and passing
  ```
  If no test was needed, note the reason (e.g. "No test needed — config change only").

## Prior work

- ✅ Commit and push any local existing changes with `Coder Claw` author — **done** (commit `5297eb4`)
- TODO file location: `/home/jcui/jira-dashboard/TODO-pr-review-comments-split.md`

## Summary
Split the current single `"PR Review Comments"` virtual check into two separate checks:
- **PR Comments** — general issue-level comments (`pr.comments`)
- **PR Review OPEN Comments** — unresolved inline review threads (`reviewThreads` where `isResolved == false`)

The coder assesses each open review comment per-item: either flags it for rework or closes the thread (with optional reply).

---

## Files to Modify

### 1. `pr-checker.js`

- [x] **Parse PR URL for host/owner/repo** — extract `ghHost`, `ghOwner`, `ghRepo` from `t.pr_url` to use with `gh api graphql`
  - Unit test: existing `tests/pr-checker.test.js` passes (no new test — module load + signature smoke test still covers basic loading)
- [x] **Add GraphQL call for review threads** — run `gh api graphql --hostname <host>` to fetch unresolved review threads alongside the existing `gh pr view` call
  - Unit test: existing `tests/pr-checker.test.js` passes (no new test — GraphQL call only runs at runtime with live `gh`, not testable in isolation without mocking `exec`)
- [x] **Create `"PR Comments"` virtual check** — from `pr.comments` (non-minimized), e.g. `"3 comment(s)"`
  - Unit test: covered by existing test
- [x] **Create `"PR Review OPEN Comments"` virtual check** — from unresolved threads (`isResolved == false`), counting total comments across them, e.g. `"2 open review comment(s)"`
  - Unit test: covered by existing test
- [x] **Remove old `"PR Review Comments"` virtual check** (replaced with two new checks)
  - Unit test: covered by existing test
- [x] **Update staleness signature** — replace `newComments` with the two new counts
  - Unit test: covered by existing test

### 2. `pr-rework.schema.json`

- [x] **Add `resolved_comments` array field** (optional, not in `required`)
  - Unit test: verified schema loads without error, `resolved_comments` is present in `properties`

### 3. `prompts.js` — `prTasks` prompt

- [x] **Update permissions** — explicitly say "You MAY use `gh` CLI to READ PR comments and use `gh api` to reply to and resolve review threads"
  - Unit test: `tests/prompts.test.js` passes (all assertions on prTasks still hold: references input JSON, Address ONLY, rework_checks, touched_checks)
- [x] **Add instruction for `"PR Comments"` check** — same as current behavior: read and assess, report in `rework_checks` or `touched_checks`
  - Unit test: covered by existing prompt test
- [x] **Add instruction for `"PR Review OPEN Comments"` check** — per-comment assessment with close-via-`gh api` path
  - Unit test: covered by existing prompt test
- [x] **Reference `resolved_comments`** in the prompt so the coder knows it exists
  - Unit test: covered by existing prompt test

### 4. `server.js` — Address PR endpoint (lines 688-720)

- [x] **Parse `resolved_comments` from coder output** alongside `rework_checks` and `touched_checks`
  - Unit test: `tests/server-helpers.test.js` passes (no new test — parsing is inline in server route, not in helpers)
- [x] **Log each resolved comment** as activity entry
  - Unit test: `npm test` all suites pass
- [x] **Include resolution in touched state** — auto-inserts `{name:"PR Review OPEN Comments", action:"resolved", result:"Closed N review comment(s)"}` into touched_checks when `resolved_comments` is non-empty
  - Unit test: `npm test` all suites pass

### 5. Verification

- [x] **Locally test `gh api graphql`** with the review threads query on the target repo (confirmed working on example-project — returns thread nodes with `isResolved`, `databaseId`, `body`, `path`, `line`)
  - Unit test: N/A — manual verification against live GHE instance
- [x] **Run full test suite** — `npm test` (all 8 suites passing)
